import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { GoogleGenAI, Type } from '@google/genai';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import {
  createUserAssessment,
  deleteUserAssessment,
  listUserAssessments,
} from './src/db/assessments.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '4mb' }));

// Shared Gemini client strictly on server-side with required telemetry header
function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Simple in-memory cache (15-min TTL) so repeated site/comparison switches are fast
const siteCache = new Map<string, { expiresAt: number; data: unknown }>();
const CACHE_TTL_MS = 15 * 60 * 1000;

async function fetchJsonWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 12000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'TerraSight-SiteIntelligence/1.0',
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}: ${errText.slice(0, 140)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 1. Nominatim Geocoding Proxy
app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    return res.status(400).json({ error: 'Search query parameter q is required.' });
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&addressdetails=1&q=${encodeURIComponent(
      q
    )}`;
    const results = await fetchJsonWithTimeout(url, {}, 9000);
    const mapped = (Array.isArray(results) ? results : []).map((item: any) => ({
      displayName: item.display_name,
      lat: Number(item.lat),
      lng: Number(item.lon),
      region:
        item.address?.city ||
        item.address?.town ||
        item.address?.state_district ||
        item.address?.state ||
        item.address?.country ||
        'Global',
    }));
    res.json({ results: mapped });
  } catch (err: any) {
    res.status(502).json({ error: err?.message || 'Failed to query Nominatim geocoding service.' });
  }
});

// 2. Nominatim Reverse Geocoding Proxy
app.get('/api/reverse-geocode', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Valid numeric lat and lng query parameters are required.' });
  }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=13`;
    const data = await fetchJsonWithTimeout(url, {}, 8000);
    const label =
      data?.address?.suburb ||
      data?.address?.neighbourhood ||
      data?.address?.city ||
      data?.address?.town ||
      data?.address?.county ||
      data?.display_name?.split(',').slice(0, 2).join(', ') ||
      `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const region = data?.address?.state || data?.address?.country || 'Selected Coordinates';
    res.json({ label, region, displayName: data?.display_name || label });
  } catch {
    res.json({
      label: `Site (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      region: 'Custom Coordinates',
      displayName: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    });
  }
});

// 3. Multi-Source Public Geospatial Telemetry Aggregator
app.post('/api/analyze-site', async (req, res) => {
  const {
    lat,
    lng,
    label = 'Selected Parcel',
    region = 'Custom Region',
    projectType = 'residential_township',
    areaHectares = 35,
    horizonYear = 2050,
  } = req.body ?? {};

  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng) || numLat < -90 || numLat > 90 || numLng < -180 || numLng > 180) {
    return res.status(400).json({ error: 'Valid latitude and longitude coordinates are required.' });
  }

  const cacheKey = `${numLat.toFixed(3)}_${numLng.toFixed(3)}_${horizonYear}`;
  const cached = siteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const payload = structuredClone(cached.data) as any;
    payload.query = {
      lat: numLat,
      lng: numLng,
      label,
      region,
      projectType,
      areaHectares: Number(areaHectares) || 35,
      horizonYear: horizonYear === 2035 ? 2035 : 2050,
    };
    return res.json(payload);
  }

  // Build 5x5 elevation sampling grid (~3.3 km span around parcel)
  const gridOffsets = [-0.015, -0.0075, 0, 0.0075, 0.015];
  const gridCoords: Array<{ lat: number; lng: number }> = [];
  for (const dLat of gridOffsets) {
    for (const dLng of gridOffsets) {
      gridCoords.push({
        lat: +(numLat + dLat).toFixed(5),
        lng: +(numLng + dLng).toFixed(5),
      });
    }
  }
  const elevUrl = `https://api.open-meteo.com/v1/elevation?latitude=${gridCoords
    .map((p) => p.lat)
    .join(',')}&longitude=${gridCoords.map((p) => p.lng).join(',')}`;

  // CMIP6 Climate Change windows: Historical 2000-2004 vs Future (2031-2035 or 2045-2049)
  const futureStart = horizonYear === 2035 ? '2031-01-01' : '2045-01-01';
  const futureEnd = horizonYear === 2035 ? '2035-12-31' : '2049-12-31';
  const climateHistUrl = `https://climate-api.open-meteo.com/v1/climate?latitude=${numLat}&longitude=${numLng}&start_date=2000-01-01&end_date=2004-12-31&models=CMCC_CM2_VHR4&daily=temperature_2m_max,precipitation_sum&timezone=GMT`;
  const climateFutureUrl = `https://climate-api.open-meteo.com/v1/climate?latitude=${numLat}&longitude=${numLng}&start_date=${futureStart}&end_date=${futureEnd}&models=CMCC_CM2_VHR4&daily=temperature_2m_max,precipitation_sum&timezone=GMT`;

  const airQualityUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${numLat}&longitude=${numLng}&current=pm10,pm2_5,us_aqi,european_aqi,nitrogen_dioxide,ozone,dust,uv_index,aerosol_optical_depth`;

  const floodUrl = `https://flood-api.open-meteo.com/v1/flood?latitude=${numLat}&longitude=${numLng}&daily=river_discharge,river_discharge_mean,river_discharge_max&past_days=30&forecast_days=30`;

  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${numLat}&longitude=${numLng}&current=temperature_2m,relative_humidity_2m,wind_speed_10m&hourly=soil_moisture_0_to_1cm,soil_temperature_0cm&daily=et0_fao_evapotranspiration,shortwave_radiation_sum&forecast_days=3&timezone=auto`;

  const nasaUrl = `https://power.larc.nasa.gov/api/temporal/climatology/point?latitude=${numLat}&longitude=${numLng}&parameters=ALLSKY_SFC_SW_DWN,T2M,PRECTOTCORR&community=RE&format=JSON`;

  const overpassQuery = `[out:json][timeout:8];(way["leisure"~"park|garden|nature_reserve"](around:1800,${numLat},${numLng});way["landuse"~"forest|grass|meadow|recreation_ground"](around:1800,${numLat},${numLng});way["natural"~"wood|grassland|scrub|water|wetland"](around:1800,${numLat},${numLng});way["waterway"~"river|canal|stream"](around:1800,${numLat},${numLng});way["landuse"~"residential|commercial|industrial|retail"](around:1800,${numLat},${numLng}););out tags center 180;`;

  const fetchOverpass = () =>
    Promise.any([
      fetchJsonWithTimeout(
        'https://overpass-api.de/api/interpreter',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(overpassQuery)}`,
        },
        8500
      ),
      fetchJsonWithTimeout(
        'https://overpass.kumi.systems/api/interpreter',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(overpassQuery)}`,
        },
        8500
      ),
    ]);

  const [elevRes, climHistRes, climFutRes, aqRes, floodRes, forecastRes, nasaRes, osmRes] =
    await Promise.allSettled([
      fetchJsonWithTimeout(elevUrl, {}, 10000),
      fetchJsonWithTimeout(climateHistUrl, {}, 12000),
      fetchJsonWithTimeout(climateFutureUrl, {}, 12000),
      fetchJsonWithTimeout(airQualityUrl, {}, 10000),
      fetchJsonWithTimeout(floodUrl, {}, 10000),
      fetchJsonWithTimeout(forecastUrl, {}, 10000),
      fetchJsonWithTimeout(nasaUrl, {}, 12000),
      fetchOverpass(),
    ]);

  // Parse Elevation
  const sources: Array<{ name: string; ok: boolean; detail: string }> = [];
  let elevationPayload = {
    centerMeters: null as number | null,
    minMeters: null as number | null,
    maxMeters: null as number | null,
    reliefMeters: null as number | null,
    estimatedSlopePct: null as number | null,
    grid: [] as Array<{ lat: number; lng: number; elevation: number }>,
  };

  if (elevRes.status === 'fulfilled' && Array.isArray(elevRes.value?.elevation)) {
    const vals: number[] = elevRes.value.elevation.map(Number).filter(Number.isFinite);
    const grid = gridCoords
      .map((c, idx) => ({ lat: c.lat, lng: c.lng, elevation: Number(elevRes.value.elevation[idx]) }))
      .filter((p) => Number.isFinite(p.elevation));
    if (vals.length > 0) {
      const minM = Math.min(...vals);
      const maxM = Math.max(...vals);
      const relief = +(maxM - minM).toFixed(1);
      // Estimate typical local slope across ~3300m diagonal
      const estimatedSlopePct = +((relief / 1650) * 100).toFixed(2);
      elevationPayload = {
        centerMeters: vals[12] ?? vals[0],
        minMeters: minM,
        maxMeters: maxM,
        reliefMeters: relief,
        estimatedSlopePct,
        grid,
      };
      sources.push({ name: 'Copernicus DEM 90m', ok: true, detail: `${vals.length} terrain probes` });
    } else {
      sources.push({ name: 'Copernicus DEM 90m', ok: false, detail: 'Empty array' });
    }
  } else {
    sources.push({ name: 'Copernicus DEM 90m', ok: false, detail: 'Unavailable' });
  }

  // Parse Climate CMIP6
  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  let climatePayload = {
    historicalMeanMaxC: null as number | null,
    futureMeanMaxC: null as number | null,
    tempDeltaC: null as number | null,
    historicalExtremeHeatDaysPerYr: null as number | null,
    futureExtremeHeatDaysPerYr: null as number | null,
    historicalAnnualPrecipMm: null as number | null,
    futureAnnualPrecipMm: null as number | null,
    precipChangePct: null as number | null,
    monthlySeries: [] as Array<{
      month: string;
      historicalMaxC: number;
      futureMaxC: number;
      historicalPrecipMm: number;
      futurePrecipMm: number;
    }>,
    modelUsed: 'CMCC_CM2_VHR4 (CMIP6 HighResMIP)',
  };

  if (
    climHistRes.status === 'fulfilled' &&
    climFutRes.status === 'fulfilled' &&
    Array.isArray(climHistRes.value?.daily?.time) &&
    Array.isArray(climFutRes.value?.daily?.time)
  ) {
    const aggregateWindow = (daily: any) => {
      const times: string[] = daily.time;
      const temps: Array<number | null> = daily.temperature_2m_max || [];
      const precips: Array<number | null> = daily.precipitation_sum || [];
      const monthTemps = Array.from({ length: 12 }, () => [] as number[]);
      const monthPrecip = Array.from({ length: 12 }, () => 0);
      let tempSum = 0;
      let tempCount = 0;
      let precipSum = 0;
      let extremeDays = 0;

      for (let i = 0; i < times.length; i++) {
        const m = Number(times[i].slice(5, 7)) - 1;
        const rawT = temps[i];
        const rawP = precips[i];
        if (rawT !== null && rawT !== undefined && Number.isFinite(Number(rawT)) && m >= 0 && m < 12) {
          const t = Number(rawT);
          monthTemps[m].push(t);
          tempSum += t;
          tempCount++;
          if (t >= 40) extremeDays++;
        }
        if (rawP !== null && rawP !== undefined && Number.isFinite(Number(rawP)) && m >= 0 && m < 12) {
          const p = Number(rawP);
          monthPrecip[m] += p;
          precipSum += p;
        }
      }
      const years = Math.max(1, tempCount / 365.25);
      return {
        meanMaxC: tempCount > 0 ? +(tempSum / tempCount).toFixed(2) : 0,
        extremeDaysPerYr: Math.round(extremeDays / years),
        annualPrecipMm: Math.round(precipSum / years),
        monthlyMeanMax: monthTemps.map((arr) =>
          arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0
        ),
        monthlyMeanPrecip: monthPrecip.map((sum) => Math.round(sum / years)),
      };
    };

    const hist = aggregateWindow(climHistRes.value.daily);
    const fut = aggregateWindow(climFutRes.value.daily);
    const precipChangePct =
      hist.annualPrecipMm > 0
        ? +(((fut.annualPrecipMm - hist.annualPrecipMm) / hist.annualPrecipMm) * 100).toFixed(1)
        : 0;

    climatePayload = {
      historicalMeanMaxC: hist.meanMaxC,
      futureMeanMaxC: fut.meanMaxC,
      tempDeltaC: +(fut.meanMaxC - hist.meanMaxC).toFixed(2),
      historicalExtremeHeatDaysPerYr: hist.extremeDaysPerYr,
      futureExtremeHeatDaysPerYr: fut.extremeDaysPerYr,
      historicalAnnualPrecipMm: hist.annualPrecipMm,
      futureAnnualPrecipMm: fut.annualPrecipMm,
      precipChangePct,
      monthlySeries: MONTH_LABELS.map((month, idx) => ({
        month,
        historicalMaxC: hist.monthlyMeanMax[idx],
        futureMaxC: fut.monthlyMeanMax[idx],
        historicalPrecipMm: hist.monthlyMeanPrecip[idx],
        futurePrecipMm: fut.monthlyMeanPrecip[idx],
      })),
      modelUsed: 'CMCC_CM2_VHR4 (CMIP6 HighResMIP)',
    };
    sources.push({ name: 'Open-Meteo CMIP6', ok: true, detail: `2000–04 vs ${horizonYear}` });
  } else {
    sources.push({ name: 'Open-Meteo CMIP6', ok: false, detail: 'Projection fetch failed' });
  }

  // Parse Air Quality
  let aqPayload = {
    usAqi: null as number | null,
    europeanAqi: null as number | null,
    pm25: null as number | null,
    pm10: null as number | null,
    no2: null as number | null,
    ozone: null as number | null,
    dust: null as number | null,
    uvIndex: null as number | null,
    aerosolOpticalDepth: null as number | null,
  };
  if (aqRes.status === 'fulfilled' && aqRes.value?.current) {
    const c = aqRes.value.current;
    aqPayload = {
      usAqi: c.us_aqi ?? null,
      europeanAqi: c.european_aqi ?? null,
      pm25: c.pm2_5 ?? null,
      pm10: c.pm10 ?? null,
      no2: c.nitrogen_dioxide ?? null,
      ozone: c.ozone ?? null,
      dust: c.dust ?? null,
      uvIndex: c.uv_index ?? null,
      aerosolOpticalDepth: c.aerosol_optical_depth ?? null,
    };
    sources.push({ name: 'Copernicus CAMS Air', ok: true, detail: `PM2.5 ${c.pm2_5 ?? '--'} µg/m³` });
  } else {
    sources.push({ name: 'Copernicus CAMS Air', ok: false, detail: 'Unavailable' });
  }

  // Parse GloFAS Flood
  let floodPayload = {
    currentDischargeM3s: null as number | null,
    meanDischargeM3s: null as number | null,
    max60DayDischargeM3s: null as number | null,
    peakToMeanRatio: null as number | null,
  };
  if (floodRes.status === 'fulfilled' && floodRes.value?.daily) {
    const d = floodRes.value.daily;
    const discharges: number[] = (d.river_discharge || []).map(Number).filter(Number.isFinite);
    const means: number[] = (d.river_discharge_mean || []).map(Number).filter(Number.isFinite);
    const maxes: number[] = (d.river_discharge_max || []).map(Number).filter(Number.isFinite);
    const current = discharges.length ? discharges[Math.floor(discharges.length / 2)] : null;
    const meanVal = means.length ? means.reduce((a, b) => a + b, 0) / means.length : null;
    const maxVal = maxes.length ? Math.max(...maxes) : discharges.length ? Math.max(...discharges) : null;
    floodPayload = {
      currentDischargeM3s: current !== null ? +current.toFixed(2) : null,
      meanDischargeM3s: meanVal !== null ? +meanVal.toFixed(2) : null,
      max60DayDischargeM3s: maxVal !== null ? +maxVal.toFixed(2) : null,
      peakToMeanRatio:
        maxVal !== null && meanVal !== null && meanVal > 0.05 ? +(maxVal / meanVal).toFixed(2) : 1.0,
    };
    sources.push({ name: 'GloFAS Hydrology', ok: true, detail: `Peak ${floodPayload.max60DayDischargeM3s ?? 0} m³/s` });
  } else {
    sources.push({ name: 'GloFAS Hydrology', ok: false, detail: 'Unavailable' });
  }

  // Parse Current Conditions & Soil Moisture
  let currentPayload = {
    temperatureC: null as number | null,
    humidityPct: null as number | null,
    windSpeedKmh: null as number | null,
    soilMoistureM3m3: null as number | null,
    soilTempC: null as number | null,
    evapotranspirationMmDay: null as number | null,
    shortwaveRadiationMjM2: null as number | null,
  };
  if (forecastRes.status === 'fulfilled' && forecastRes.value?.current) {
    const f = forecastRes.value;
    const smArr: number[] = (f.hourly?.soil_moisture_0_to_1cm || []).map(Number).filter(Number.isFinite);
    const stArr: number[] = (f.hourly?.soil_temperature_0cm || []).map(Number).filter(Number.isFinite);
    const etArr: number[] = (f.daily?.et0_fao_evapotranspiration || []).map(Number).filter(Number.isFinite);
    const swArr: number[] = (f.daily?.shortwave_radiation_sum || []).map(Number).filter(Number.isFinite);
    currentPayload = {
      temperatureC: f.current.temperature_2m ?? null,
      humidityPct: f.current.relative_humidity_2m ?? null,
      windSpeedKmh: f.current.wind_speed_10m ?? null,
      soilMoistureM3m3: smArr.length ? +smArr[0].toFixed(3) : null,
      soilTempC: stArr.length ? +stArr[0].toFixed(1) : null,
      evapotranspirationMmDay: etArr.length ? +etArr[0].toFixed(2) : null,
      shortwaveRadiationMjM2: swArr.length ? +swArr[0].toFixed(1) : null,
    };
    sources.push({ name: 'Open-Meteo Surface', ok: true, detail: `${currentPayload.temperatureC ?? '--'} °C live` });
  } else {
    sources.push({ name: 'Open-Meteo Surface', ok: false, detail: 'Unavailable' });
  }

  // Parse NASA POWER
  let nasaPayload = {
    solarIrradianceKwhM2Day: null as number | null,
    climatologyTempC: null as number | null,
    climatologyPrecipMmDay: null as number | null,
  };
  if (nasaRes.status === 'fulfilled' && nasaRes.value?.properties?.parameter) {
    const p = nasaRes.value.properties.parameter;
    const sw = p.ALLSKY_SFC_SW_DWN?.ANN;
    const t2m = p.T2M?.ANN;
    const pr = p.PRECTOTCORR?.ANN;
    nasaPayload = {
      solarIrradianceKwhM2Day: typeof sw === 'number' && sw > -900 ? +sw.toFixed(2) : null,
      climatologyTempC: typeof t2m === 'number' && t2m > -900 ? +t2m.toFixed(1) : null,
      climatologyPrecipMmDay: typeof pr === 'number' && pr > -900 ? +pr.toFixed(2) : null,
    };
    sources.push({
      name: 'NASA POWER',
      ok: true,
      detail: `${nasaPayload.solarIrradianceKwhM2Day ?? '--'} kWh/m²/d`,
    });
  } else {
    sources.push({ name: 'NASA POWER', ok: false, detail: 'Unavailable' });
  }

  // Parse OSM Overpass 2 km Buffer
  let landUsePayload = {
    greenFeaturesCount: 0,
    waterFeaturesCount: 0,
    urbanBuiltCount: 0,
    industrialCount: 0,
    nearestWaterKm: null as number | null,
    nearestGreenKm: null as number | null,
    sampleFeatures: [] as Array<{
      name: string;
      kind: 'green' | 'water' | 'urban' | 'industrial';
      lat: number;
      lng: number;
    }>,
  };

  if (osmRes.status === 'fulfilled' && Array.isArray(osmRes.value?.elements)) {
    const els = osmRes.value.elements;
    let nearestWater: number | null = null;
    let nearestGreen: number | null = null;

    for (const el of els) {
      const tags = el.tags || {};
      const cLat = el.center?.lat ?? el.lat;
      const cLng = el.center?.lon ?? el.lon;
      const dist = Number.isFinite(cLat) && Number.isFinite(cLng) ? haversineKm(numLat, numLng, cLat, cLng) : null;

      let kind: 'green' | 'water' | 'urban' | 'industrial' | null = null;
      if (
        tags.natural === 'water' ||
        tags.natural === 'wetland' ||
        ['river', 'canal', 'stream'].includes(tags.waterway)
      ) {
        landUsePayload.waterFeaturesCount++;
        kind = 'water';
        if (dist !== null && (nearestWater === null || dist < nearestWater)) nearestWater = dist;
      } else if (
        ['park', 'garden', 'nature_reserve'].includes(tags.leisure) ||
        ['forest', 'grass', 'meadow', 'recreation_ground'].includes(tags.landuse) ||
        ['wood', 'grassland', 'scrub'].includes(tags.natural)
      ) {
        landUsePayload.greenFeaturesCount++;
        kind = 'green';
        if (dist !== null && (nearestGreen === null || dist < nearestGreen)) nearestGreen = dist;
      } else if (tags.landuse === 'industrial') {
        landUsePayload.industrialCount++;
        kind = 'industrial';
      } else if (['residential', 'commercial', 'retail'].includes(tags.landuse)) {
        landUsePayload.urbanBuiltCount++;
        kind = 'urban';
      }

      if (kind && Number.isFinite(cLat) && Number.isFinite(cLng) && landUsePayload.sampleFeatures.length < 36) {
        landUsePayload.sampleFeatures.push({
          name: tags.name || tags.landuse || tags.natural || tags.leisure || tags.waterway || kind,
          kind,
          lat: cLat,
          lng: cLng,
        });
      }
    }
    landUsePayload.nearestWaterKm = nearestWater !== null ? +nearestWater.toFixed(2) : null;
    landUsePayload.nearestGreenKm = nearestGreen !== null ? +nearestGreen.toFixed(2) : null;
    sources.push({ name: 'OpenStreetMap 2km', ok: true, detail: `${els.length} spatial polygons` });
  } else {
    sources.push({ name: 'OpenStreetMap 2km', ok: false, detail: 'Overpass timeout/busy' });
  }

  const telemetry = {
    query: {
      lat: numLat,
      lng: numLng,
      label,
      region,
      projectType,
      areaHectares: Number(areaHectares) || 35,
      horizonYear: horizonYear === 2035 ? 2035 : 2050,
    },
    fetchedAt: new Date().toISOString(),
    sources,
    climate: climatePayload,
    elevation: elevationPayload,
    airQuality: aqPayload,
    flood: floodPayload,
    currentConditions: currentPayload,
    nasaPower: nasaPayload,
    landUse2Km: landUsePayload,
  };

  siteCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, data: telemetry });
  res.json(telemetry);
});

// 4. Gemini AI Preventive Synthesis Brief (Structured JSON)
app.post('/api/ai/brief', async (req, res) => {
  const { assessment } = req.body ?? {};
  if (!assessment?.telemetry) {
    return res.status(400).json({ error: 'Site assessment telemetry is required.' });
  }

  try {
    const ai = getGeminiClient();
    const t = assessment.telemetry;
    const c = assessment.costProjection;

    const promptPayload = {
      location: t.query.label,
      region: t.query.region,
      coordinates: { lat: t.query.lat, lng: t.query.lng },
      projectType: t.query.projectType,
      areaHectares: t.query.areaHectares,
      horizonYear: t.query.horizonYear,
      overallSuitability: assessment.overallSuitability,
      overallVerdict: assessment.overallVerdict,
      climate: {
        tempDeltaC: t.climate.tempDeltaC,
        futureExtremeHeatDaysPerYr: t.climate.futureExtremeHeatDaysPerYr,
        precipChangePct: t.climate.precipChangePct,
      },
      elevation: {
        centerMeters: t.elevation.centerMeters,
        reliefMeters: t.elevation.reliefMeters,
        slopePct: t.elevation.estimatedSlopePct,
      },
      airQuality: {
        usAqi: t.airQuality.usAqi,
        pm25: t.airQuality.pm25,
        dust: t.airQuality.dust,
      },
      flood: t.flood,
      nasaSolarKwhM2Day: t.nasaPower.solarIrradianceKwhM2Day,
      landUse2Km: {
        greenFeatures: t.landUse2Km.greenFeaturesCount,
        waterFeatures: t.landUse2Km.waterFeaturesCount,
        urbanBuilt: t.landUse2Km.urbanBuiltCount,
        industrial: t.landUse2Km.industrialCount,
      },
      financialsInrCr: {
        baselineCapex: c.baselineCapexInrCr,
        unmitigated25YrPenalty: c.unmitigated25YrPenaltyInrCr,
        preventiveCapex: c.preventiveGreenCapexInrCr,
        netAvoidedCost: c.net25YrAvoidedCostInrCr,
      },
    };

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Analyze this live satellite & environmental site dossier and produce preventive urban planning intelligence plus a decisive final AI verdict specifically evaluating suitability for the requested projectType use case (${t.query.projectType}, ${t.query.areaHectares} ha, horizon ${t.query.horizonYear}):\n${JSON.stringify(
        promptPayload
      )}`,
      config: {
        systemInstruction:
          'You are a senior climate-resilient urban planning and civil engineering analyst. Never invent fake measurements; reference only the provided coordinates, telemetry numbers, and financial figures. For finalVerdict, issue an authoritative go/no-go decision tailored strictly to the selected projectType use case: set decision to one of "PROCEED", "PROCEED WITH MITIGATIONS", "CONDITIONAL HOLD", or "RELOCATION RECOMMENDED"; explain exact use-case fit in useCaseFitSummary; state concrete capital/engineering gating conditions in recommendedAction; and set confidenceLevel (e.g. "High Confidence — Telemetry-Verified"). For alternativeCorridors, suggest 2 realistic directional adjustments around the target coordinates using small latOffset/lngOffset values between -0.18 and +0.18 degrees (roughly 5-20 km away) that logically address the site constraints (e.g., higher terrain, downwind/upwind air corridor, or lower flood basin exposure).',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            finalVerdict: {
              type: Type.OBJECT,
              properties: {
                decision: { type: Type.STRING },
                useCaseFitSummary: { type: Type.STRING },
                recommendedAction: { type: Type.STRING },
                confidenceLevel: { type: Type.STRING },
              },
              required: ['decision', 'useCaseFitSummary', 'recommendedAction', 'confidenceLevel'],
            },
            executiveSummary: { type: Type.STRING },
            keyHazards: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  severity: { type: Type.STRING },
                  evidence: { type: Type.STRING },
                  consequence: { type: Type.STRING },
                },
                required: ['title', 'severity', 'evidence', 'consequence'],
              },
            },
            mitigationStrategies: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  impact: { type: Type.STRING },
                  costCategory: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ['title', 'impact', 'costCategory', 'description'],
              },
            },
            alternativeCorridors: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  directionAndDistance: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                  latOffset: { type: Type.NUMBER },
                  lngOffset: { type: Type.NUMBER },
                },
                required: ['name', 'directionAndDistance', 'rationale', 'latOffset', 'lngOffset'],
              },
            },
          },
          required: [
            'finalVerdict',
            'executiveSummary',
            'keyHazards',
            'mitigationStrategies',
            'alternativeCorridors',
          ],
        },
      },
    });

    const text = response.text?.trim() || '{}';
    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err: any) {
    const rawMsg = err?.message || 'Failed to generate AI site brief.';
    const isQuota =
      err?.status === 429 ||
      rawMsg.includes('RESOURCE_EXHAUSTED') ||
      rawMsg.includes('quota');
    const status = isQuota ? 429 : err?.status >= 400 && err?.status < 600 ? err.status : 500;
    res.status(status).json({
      error: isQuota
        ? 'Gemini quota temporarily exhausted while synthesizing the brief. Please wait a moment and retry.'
        : rawMsg,
    });
  }
});

// 4b. Gemini Google Search Grounding (Municipal Advisories & Climate Bulletins)
app.post('/api/ai/search-grounding', async (req, res) => {
  const { label, region, lat, lng, projectType = 'residential_township' } = req.body ?? {};
  const cleanLabel = String(label ?? '').trim();
  const cleanRegion = String(region ?? '').trim();
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!cleanLabel || !Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return res.status(400).json({ error: 'Site label and coordinates are required.' });
  }

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Summarize current urban planning masterplans, zoning constraints, recent extreme heatwave or flood advisories, and groundwater/air-quality regulations relevant to developing a ${String(projectType).replace('_', ' ')} near ${cleanLabel}, ${cleanRegion} (${numLat.toFixed(4)}, ${numLng.toFixed(4)}). Keep it factual, concise (3-4 bullet points or short paragraphs), and strictly grounded in live web results.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const seen = new Set<string>();
    const sources: Array<{ title: string; uri: string }> = [];
    for (const chunk of chunks) {
      const uri = chunk?.web?.uri;
      if (uri && !seen.has(uri)) {
        seen.add(uri);
        sources.push({
          title: chunk.web?.title || new URL(uri).hostname,
          uri,
        });
      }
    }

    res.json({
      summary: response.text?.trim() || 'No live web advisory summary returned.',
      sources: sources.slice(0, 8),
    });
  } catch (err: any) {
    const rawMsg = err?.message || 'Google Search Grounding request failed.';
    const isQuota =
      err?.status === 429 ||
      rawMsg.includes('RESOURCE_EXHAUSTED') ||
      rawMsg.includes('quota');
    const status = isQuota ? 429 : err?.status >= 400 && err?.status < 600 ? err.status : 500;
    res.status(status).json({
      error: isQuota
        ? 'Search Grounding quota reached temporarily. Retry in a few seconds.'
        : rawMsg,
    });
  }
});

// 4c. Gemini Google Maps Grounding (Nearby Infrastructure, Water Bodies & Transit)
app.post('/api/ai/maps-grounding', async (req, res) => {
  const { label, region, lat, lng } = req.body ?? {};
  const cleanLabel = String(label ?? '').trim();
  const cleanRegion = String(region ?? '').trim();
  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!cleanLabel || !Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return res.status(400).json({ error: 'Site label and coordinates are required.' });
  }

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Identify notable nearby civic infrastructure, transit hubs, parks, lakes/rivers, hospitals, and industrial zones around ${cleanLabel}, ${cleanRegion} near (${numLat.toFixed(4)}, ${numLng.toFixed(4)}) that affect pre-construction urban siting suitability. Summarize concisely.`,
      config: {
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude: numLat,
              longitude: numLng,
            },
          },
        },
      },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const seen = new Set<string>();
    const places: Array<{ title: string; uri: string; snippets: string[] }> = [];
    for (const chunk of chunks) {
      const m = chunk?.maps;
      if (m?.title) {
        const key = m.uri || m.title;
        if (!seen.has(key)) {
          seen.add(key);
          const snippets: string[] = Array.isArray(m.placeAnswerSources?.reviewSnippets)
            ? m.placeAnswerSources.reviewSnippets
                .map((s: any) => String(s?.text ?? '').trim())
                .filter(Boolean)
                .slice(0, 2)
            : [];
          places.push({
            title: m.title,
            uri: m.uri || `https://maps.google.com/?q=${numLat},${numLng}`,
            snippets,
          });
        }
      }
    }

    res.json({
      summary: response.text?.trim() || 'No surrounding Maps context returned.',
      places: places.slice(0, 8),
    });
  } catch (err: any) {
    const rawMsg = err?.message || 'Google Maps Grounding request failed.';
    const isQuota =
      err?.status === 429 ||
      rawMsg.includes('RESOURCE_EXHAUSTED') ||
      rawMsg.includes('quota');
    const status = isQuota ? 429 : err?.status >= 400 && err?.status < 600 ? err.status : 500;
    res.status(status).json({
      error: isQuota
        ? 'Maps Grounding quota reached temporarily. Retry in a few seconds.'
        : rawMsg,
    });
  }
});

// 5. Multi-Turn Gemini Planning Advisor Chat
const ALLOWED_CHAT_MODELS = new Set([
  'gemini-4-hydrogen',
  'gemini-4-neon',
  'gemini-4-carbon',
  'gemini-3.1-flash-lite',
]);

app.post('/api/ai/chat', async (req, res) => {
  const { model = 'gemini-4-hydrogen', messages = [], siteContext = null } = req.body ?? {};
  if (!ALLOWED_CHAT_MODELS.has(model)) {
    return res.status(400).json({ error: `Unsupported chat model: ${model}` });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Conversation messages array is required.' });
  }

  try {
    const ai = getGeminiClient();
    const systemInstruction = `You are TerraSight Planning Advisor, an expert sustainable urban planner, hydrologist, and climate-resilience economist.
Your mission is to help governments, planners, and developers evaluate land BEFORE construction to prevent future climate, water, heat, pollution, and infrastructure cost failures.
Always ground answers in the user's active site telemetry below when present. Cite exact units (°C, µg/m³, m³/s, kWh/m²/day, ₹ Crores) and distinguish between measured data vs. architectural recommendations. Keep answers structured, concise, and actionable.

ACTIVE SITE TELEMETRY CONTEXT:
${siteContext ? JSON.stringify(siteContext) : 'No active site loaded yet.'}`;

    const history = messages.slice(0, -1).map((m: { role: 'user' | 'model'; text: string }) => ({
      role: m.role === 'model' ? 'model' : 'user',
      parts: [{ text: String(m.text ?? '') }],
    }));

    const latestMessage = String(messages[messages.length - 1]?.text ?? '').trim();
    if (!latestMessage) {
      return res.status(400).json({ error: 'Latest user message cannot be empty.' });
    }

    const chat = ai.chats.create({
      model,
      history,
      config: {
        systemInstruction,
      },
    });

    const response = await chat.sendMessage({ message: latestMessage });
    res.json({
      reply: response.text || 'No response generated.',
      model,
    });
  } catch (err: any) {
    const rawMsg = err?.message || 'Chat request failed.';
    const isPaidKeyIssue =
      rawMsg.includes('PERMISSION_DENIED') ||
      rawMsg.includes('RESOURCE_EXHAUSTED') ||
      rawMsg.includes('API_KEY_INVALID') ||
      err?.status === 403 ||
      err?.status === 429;
    res.status(err?.status >= 400 && err?.status < 600 ? err.status : 500).json({
      error: isPaidKeyIssue
        ? `Model "${model}" requires a billing-enabled Gemini API key in Settings > Secrets, or switch to gemini-4-hydrogen / gemini-3.1-flash-lite. (${rawMsg})`
        : rawMsg,
    });
  }
});

// 6. High-Quality Concept Image Generation (1K / 2K / 4K via gemini-3-pro-image-preview)
app.post('/api/ai/generate-concept', async (req, res) => {
  const {
    prompt,
    imageSize = '1K',
    aspectRatio = '16:9',
  } = req.body ?? {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'A descriptive prompt is required.' });
  }
  const validSize = ['1K', '2K', '4K'].includes(imageSize) ? imageSize : '1K';
  const validAspect = ['16:9', '4:3', '1:1'].includes(aspectRatio) ? aspectRatio : '16:9';

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        imageConfig: {
          aspectRatio: validAspect,
          imageSize: validSize,
        },
      },
    });

    let imageUrl: string | null = null;
    let caption = '';

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType ?? 'image/png';
        imageUrl = `data:${mime};base64,${part.inlineData.data}`;
      } else if (part.text) {
        caption += part.text;
      }
    }

    if (!imageUrl) {
      return res.status(502).json({
        error: 'The image model returned text without an image frame. Try refining the architectural prompt.',
      });
    }

    res.json({
      imageUrl,
      caption: caption.trim() || undefined,
      model: 'gemini-3-pro-image-preview',
      imageSize: validSize,
      aspectRatio: validAspect,
    });
  } catch (err: any) {
    const rawMsg = err?.message || 'Concept image generation failed.';
    const isPaidKeyIssue =
      rawMsg.includes('PERMISSION_DENIED') ||
      rawMsg.includes('RESOURCE_EXHAUSTED') ||
      rawMsg.includes('billing') ||
      err?.status === 403 ||
      err?.status === 429;
    res.status(err?.status >= 400 && err?.status < 600 ? err.status : 500).json({
      error: isPaidKeyIssue
        ? `High-resolution image generation with gemini-3-pro-image-preview requires a billing-enabled Gemini API key in Settings > Secrets. (${rawMsg})`
        : rawMsg,
    });
  }
});

// 6b. Right-Corner AI Future & Live Internet Search Oracle (Free-tier Gemini + Google Search)
const ALLOWED_CORNER_MODELS = new Set(['gemini-4-hydrogen', 'gemini-3.1-flash-lite']);

app.post('/api/ai/corner-oracle', async (req, res) => {
  const {
    model = 'gemini-4-hydrogen',
    question,
    siteContext = null,
    horizonYears = 10,
  } = req.body ?? {};

  const cleanQuestion = String(question ?? '').trim();
  if (!cleanQuestion) {
    return res.status(400).json({ error: 'Please enter a question for the Future AI Advisor.' });
  }
  const safeModel = ALLOWED_CORNER_MODELS.has(model) ? model : 'gemini-4-hydrogen';

  try {
    const ai = getGeminiClient();
    const systemInstruction = `You are the TerraSight 10-Year Future & Live Internet Intelligence Assistant.
Help organizations, planners, and investors understand what a specific geographical location will look like ${Number(horizonYears) || 10} years from now (e.g. ~2036) and provide real, factual public information from the internet via Google Search.
Combine:
1) Live Google Search results (actual urban masterplans, infrastructure corridors, climate alerts, industrial/agricultural zoning, healthcare/civic developments, groundwater & heat trends present online).
2) The active site's measured satellite & environmental telemetry below (if provided).
Be concise, factual, structured with clear bullet points, and cite real figures/dates without inventing statistics.

ACTIVE SITE CONTEXT:
${siteContext ? JSON.stringify(siteContext) : 'No specific site selected yet; answer using live web search.'}`;

    const response = await ai.models.generateContent({
      model: safeModel,
      contents: cleanQuestion,
      config: {
        systemInstruction,
        tools: [{ googleSearch: {} }],
      },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const seen = new Set<string>();
    const sources: Array<{ title: string; uri: string }> = [];
    for (const chunk of chunks) {
      const uri = chunk?.web?.uri;
      if (uri && !seen.has(uri)) {
        seen.add(uri);
        sources.push({
          title: chunk.web?.title || new URL(uri).hostname,
          uri,
        });
      }
    }

    res.json({
      reply: response.text?.trim() || 'No live web intelligence returned for that query.',
      sources: sources.slice(0, 6),
      model: safeModel,
    });
  } catch (err: any) {
    const rawMsg = err?.message || 'Future AI query failed.';
    const isQuota =
      err?.status === 429 ||
      rawMsg.includes('RESOURCE_EXHAUSTED') ||
      rawMsg.includes('quota');
    const status = isQuota ? 429 : err?.status >= 400 && err?.status < 600 ? err.status : 500;
    res.status(status).json({
      error: isQuota
        ? 'Free Gemini Search quota temporarily reached. Wait a few seconds or switch between Gemini 4 Hydrogen and Gemini 3.1 Flash Lite.'
        : rawMsg,
    });
  }
});

// 7. Authenticated User Identity & Cloud SQL Saved Site Assessments
app.get('/api/auth/me', requireAuth, (req: AuthRequest, res) => {
  res.json({
    uid: req.user!.uid,
    email: req.user!.email,
    provider: req.user!.provider,
  });
});

app.get('/api/assessments', requireAuth, async (req: AuthRequest, res) => {
  try {
    const assessments = await listUserAssessments(req.user!.dbUserId);
    res.json({ assessments });
  } catch {
    res.status(500).json({ error: 'Unable to retrieve saved assessments from workspace database.' });
  }
});

const VALID_PROJECT_TYPES = new Set([
  'residential_township',
  'commercial_hub',
  'industrial_park',
  'medical_centre',
  'agricultural_land',
  'solar_logistics_hub',
  'green_infrastructure',
]);
const VALID_VERDICTS = new Set(['Nominal', 'Moderate', 'Elevated', 'Critical']);

app.post('/api/assessments', requireAuth, async (req: AuthRequest, res) => {
  const {
    siteLabel,
    region,
    lat,
    lng,
    projectType,
    areaHectares,
    horizonYear,
    overallSuitability,
    overallVerdict,
    netAvoidedInrCr,
    telemetryJson,
  } = req.body ?? {};

  const numLat = Number(lat);
  const numLng = Number(lng);
  const numArea = Math.round(Number(areaHectares));
  const numHorizon = Number(horizonYear) === 2035 ? 2035 : 2050;
  const numSuitability = Math.round(Number(overallSuitability));
  const numAvoided = Number(netAvoidedInrCr);

  if (
    typeof siteLabel !== 'string' ||
    !siteLabel.trim() ||
    typeof region !== 'string' ||
    !region.trim() ||
    !Number.isFinite(numLat) ||
    !Number.isFinite(numLng) ||
    !VALID_PROJECT_TYPES.has(String(projectType)) ||
    !VALID_VERDICTS.has(String(overallVerdict)) ||
    !Number.isFinite(numArea) ||
    numArea < 1 ||
    numArea > 5000 ||
    !Number.isFinite(numSuitability) ||
    numSuitability < 0 ||
    numSuitability > 100 ||
    !Number.isFinite(numAvoided) ||
    typeof telemetryJson !== 'string' ||
    telemetryJson.length > 350000
  ) {
    return res.status(400).json({ error: 'Invalid site assessment payload.' });
  }

  try {
    const saved = await createUserAssessment({
      userId: req.user!.dbUserId,
      siteLabel: siteLabel.trim().slice(0, 180),
      region: region.trim().slice(0, 120),
      lat: numLat,
      lng: numLng,
      projectType: String(projectType),
      areaHectares: numArea,
      horizonYear: numHorizon,
      overallSuitability: numSuitability,
      overallVerdict: String(overallVerdict),
      netAvoidedInrCr: +numAvoided.toFixed(2),
      telemetryJson,
    });
    res.status(201).json({ assessment: saved });
  } catch {
    res.status(500).json({ error: 'Failed to persist site assessment.' });
  }
});

app.delete('/api/assessments/:id', requireAuth, async (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid assessment ID.' });
  }
  try {
    const deleted = await deleteUserAssessment(req.user!.dbUserId, id);
    if (!deleted) {
      return res.status(404).json({ error: 'Saved assessment not found.' });
    }
    res.json({ deletedId: deleted.id });
  } catch {
    res.status(500).json({ error: 'Failed to delete saved assessment.' });
  }
});

async function startServer() {
  const httpServer = createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TerraSight server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
