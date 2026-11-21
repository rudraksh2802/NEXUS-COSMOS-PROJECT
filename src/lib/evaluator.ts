import type {
  CostAssumption,
  CostProjection,
  EnvironmentalTelemetry,
  PillarEvaluation,
  ProjectType,
  RiskLevel,
  SiteAssessment,
} from '../types/site';

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function toRiskLevel(suitabilityScore: number): RiskLevel {
  if (suitabilityScore >= 72) return 'Nominal';
  if (suitabilityScore >= 54) return 'Moderate';
  if (suitabilityScore >= 36) return 'Elevated';
  return 'Critical';
}

const PROJECT_BASE_CAPEX_PER_HECTARE_INR_CR: Record<ProjectType, number> = {
  residential_township: 18.5,
  commercial_hub: 28.0,
  industrial_park: 24.0,
  medical_centre: 34.0,
  agricultural_land: 2.4,
  solar_logistics_hub: 14.5,
  green_infrastructure: 4.8,
};

const COOLING_FACTOR_BY_PROJECT: Record<ProjectType, number> = {
  residential_township: 0.072,
  commercial_hub: 0.095,
  industrial_park: 0.088,
  medical_centre: 0.115, // 24/7 clinical HVAC + sterile cleanroom loads
  agricultural_land: 0.028, // Cold-storage & greenhouse climate control
  solar_logistics_hub: 0.052,
  green_infrastructure: 0.015,
};

const PREVENTIVE_RATE_BY_PROJECT: Record<ProjectType, number> = {
  residential_township: 0.065,
  commercial_hub: 0.065,
  industrial_park: 0.072,
  medical_centre: 0.078,
  agricultural_land: 0.055,
  solar_logistics_hub: 0.058,
  green_infrastructure: 0.045,
};

export function evaluateSiteTelemetry(telemetry: EnvironmentalTelemetry): SiteAssessment {
  const { query, climate, elevation, airQuality, flood, currentConditions, nasaPower, landUse2Km } =
    telemetry;

  // 1. Climate Vulnerability
  const futureMax = climate.futureMeanMaxC ?? nasaPower.climatologyTempC ?? 32;
  const tempDelta = climate.tempDeltaC ?? 1.4;
  const extremeHeatDays = climate.futureExtremeHeatDaysPerYr ?? 35;
  const precipDeltaPct = climate.precipChangePct ?? 0;

  const heatPenalty =
    clamp((tempDelta - 0.8) * 14, 0, 28) +
    clamp((extremeHeatDays - 15) * 0.45, 0, 36) +
    clamp(Math.abs(precipDeltaPct) * 0.45, 0, 14);
  const climateSuitability = Math.round(clamp(92 - heatPenalty, 12, 96));

  const climateFindings: string[] = [];
  if (climate.tempDeltaC !== null) {
    climateFindings.push(
      `CMIP6 projects +${climate.tempDeltaC.toFixed(2)} °C mean peak warming by ${query.horizonYear}.`
    );
  }
  if (climate.futureExtremeHeatDaysPerYr !== null) {
    climateFindings.push(
      `${climate.futureExtremeHeatDaysPerYr} days/yr projected ≥ 40 °C (up from ${
        climate.historicalExtremeHeatDaysPerYr ?? 'baseline'
      } days/yr).`
    );
  }
  if (climate.precipChangePct !== null) {
    const dir = climate.precipChangePct >= 0 ? '+' : '';
    climateFindings.push(
      `Annual rainfall shift of ${dir}${climate.precipChangePct.toFixed(1)}% alters runoff & groundwater recharge.`
    );
  }

  const climatePillar: PillarEvaluation = {
    id: 'climate',
    title: 'Climate Vulnerability',
    riskLevel: toRiskLevel(climateSuitability),
    score: climateSuitability,
    headlineMetric:
      climate.tempDeltaC !== null ? `+${climate.tempDeltaC.toFixed(1)}` : `${futureMax.toFixed(1)}`,
    headlineUnit: climate.tempDeltaC !== null ? `°C by ${query.horizonYear}` : '°C Mean',
    subMetric: `${extremeHeatDays} extreme heat days/yr`,
    findings: climateFindings,
  };

  // 2. Environmental Conditions
  const pm25 = airQuality.pm25 ?? 25;
  const usAqi = airQuality.usAqi ?? 65;
  const greenCount = landUse2Km.greenFeaturesCount;
  const waterCount = landUse2Km.waterFeaturesCount;

  const airMultiplier =
    query.projectType === 'medical_centre'
      ? 1.25
      : query.projectType === 'agricultural_land'
        ? 0.85
        : 1.0;

  const airPenalty =
    (clamp((pm25 - 15) * 0.65, 0, 42) + clamp((usAqi - 60) * 0.14, 0, 22)) * airMultiplier;
  const greenBonus = clamp(greenCount * 1.4, 0, 18) + clamp(waterCount * 1.8, 0, 10);
  const envSuitability = Math.round(
    clamp(82 - airPenalty + greenBonus - (greenCount < 4 ? 12 : 0), 10, 96)
  );

  const envFindings: string[] = [
    `Copernicus CAMS PM2.5 currently ${pm25.toFixed(1)} µg/m³ (US AQI ${Math.round(usAqi)}).`,
    `OSM 2 km buffer contains ${greenCount} mapped green/canopy corridors and ${waterCount} water bodies.`,
  ];
  if (airQuality.dust !== null && airQuality.dust > 30) {
    envFindings.push(
      `Elevated coarse dust loading (${airQuality.dust.toFixed(0)} µg/m³) degrades HVAC & solar collectors.`
    );
  }

  const envPillar: PillarEvaluation = {
    id: 'environment',
    title: 'Environmental Conditions',
    riskLevel: toRiskLevel(envSuitability),
    score: envSuitability,
    headlineMetric:
      airQuality.usAqi !== null ? `${Math.round(airQuality.usAqi)}` : `${pm25.toFixed(0)}`,
    headlineUnit: airQuality.usAqi !== null ? 'US AQI' : 'µg/m³ PM2.5',
    subMetric: `${greenCount} green · ${waterCount} water (2 km)`,
    findings: envFindings,
  };

  // 3. Geographical Suitability
  const relief = elevation.reliefMeters ?? 8;
  const slopePct = elevation.estimatedSlopePct ?? 1.2;
  const floodRatio = flood.peakToMeanRatio ?? 1.5;
  const soilMoisture = currentConditions.soilMoistureM3m3 ?? 0.22;

  const floodPenalty =
    clamp((floodRatio - 1.4) * 14, 0, 30) +
    (flood.max60DayDischargeM3s && flood.max60DayDischargeM3s > 150 ? 14 : 0);
  const terrainPenalty =
    (relief < 4 ? 12 : 0) +
    clamp((slopePct - 6) * 3.5, 0, 24);
  const geoSuitability = Math.round(clamp(88 - floodPenalty - terrainPenalty, 14, 96));

  const geoFindings: string[] = [];
  if (elevation.centerMeters !== null) {
    geoFindings.push(
      `Copernicus 90m DEM center ${elevation.centerMeters.toFixed(0)} m (5×5 relief ${relief.toFixed(
        1
      )} m, slope ${slopePct.toFixed(1)}%).`
    );
  }
  if (flood.max60DayDischargeM3s !== null) {
    geoFindings.push(
      `GloFAS peak river discharge ${flood.max60DayDischargeM3s.toFixed(1)} m³/s (${floodRatio.toFixed(
        2
      )}× seasonal mean).`
    );
  }
  geoFindings.push(`Topsoil volumetric moisture ${soilMoisture.toFixed(2)} m³/m³.`);

  const geoPillar: PillarEvaluation = {
    id: 'geography',
    title: 'Geographical Suitability',
    riskLevel: toRiskLevel(geoSuitability),
    score: geoSuitability,
    headlineMetric:
      elevation.centerMeters !== null ? `${Math.round(elevation.centerMeters)}` : '--',
    headlineUnit: 'm Elevation',
    subMetric: `Relief ${relief.toFixed(1)} m · Flood ${floodRatio.toFixed(1)}×`,
    findings: geoFindings,
  };

  // 4. Urban Sustainability
  const urbanCount = landUse2Km.urbanBuiltCount;
  const industrialCount = landUse2Km.industrialCount;
  const solarKwh = nasaPower.solarIrradianceKwhM2Day ?? 5.2;
  const et0 = currentConditions.evapotranspirationMmDay ?? 4.2;

  const uhiRatio = urbanCount / Math.max(1, greenCount + waterCount);
  const uhiPenalty = clamp((uhiRatio - 1.2) * 8, 0, 32) + clamp(industrialCount * 2.5, 0, 18);
  const waterStressPenalty =
    clamp((et0 - 3.8) * 6, 0, 16) +
    (soilMoisture < 0.16 ? (query.projectType === 'agricultural_land' ? 20 : 12) : 0);
  const sustSuitability = Math.round(
    clamp(84 - uhiPenalty - waterStressPenalty + clamp((solarKwh - 4.5) * 6, 0, 10), 14, 96)
  );

  const sustFindings: string[] = [
    `NASA POWER solar insolation ${solarKwh.toFixed(2)} kWh/m²/day supports on-site PV generation.`,
    `Surrounding 2 km built-to-green zone ratio is ${uhiRatio.toFixed(1)}× (${urbanCount} built / ${
      greenCount + waterCount
    } natural).`,
    `Reference evapotranspiration ${et0.toFixed(1)} mm/day drives regional water & irrigation demand.`,
  ];

  const sustPillar: PillarEvaluation = {
    id: 'sustainability',
    title: 'Urban Sustainability',
    riskLevel: toRiskLevel(sustSuitability),
    score: sustSuitability,
    headlineMetric: `${solarKwh.toFixed(2)}`,
    headlineUnit: 'kWh/m²/d Solar',
    subMetric: `Built/Green ${uhiRatio.toFixed(1)}× · ET0 ${et0.toFixed(1)} mm`,
    findings: sustFindings,
  };

  // 5. Long-Term Feasibility & Cost Avoidance Model
  const area = Math.max(5, query.areaHectares);
  const baseCapexRate = PROJECT_BASE_CAPEX_PER_HECTARE_INR_CR[query.projectType] ?? 18.5;
  const baselineCapexInrCr = +(area * baseCapexRate).toFixed(1);

  const coolingLoadIncreasePct = Math.round(
    clamp(
      tempDelta * 11 +
        Math.max(0, extremeHeatDays - 20) * 0.35 +
        Math.min(18, uhiRatio * 2.5),
      6,
      62
    )
  );

  const coolingPenaltyFactor = COOLING_FACTOR_BY_PROJECT[query.projectType] ?? 0.072;
  const hvacPenalty = +(
    baselineCapexInrCr *
    coolingPenaltyFactor *
    (coolingLoadIncreasePct / 25)
  ).toFixed(1);

  const floodMultiplier =
    query.projectType === 'medical_centre' || query.projectType === 'industrial_park' ? 1.25 : 1.0;
  const floodRiskFactor =
    clamp((floodRatio - 1.1) * 0.045 + (relief < 5 ? 0.035 : 0.01), 0.01, 0.14) *
    floodMultiplier;
  const floodRetrofitPenalty = +(baselineCapexInrCr * floodRiskFactor).toFixed(1);

  const waterMultiplier =
    query.projectType === 'agricultural_land'
      ? 2.1
      : query.projectType === 'industrial_park'
        ? 1.35
        : 1.0;
  const waterStressFactor =
    clamp((et0 - 3.0) * 0.014 + (soilMoisture < 0.18 ? 0.025 : 0.008), 0.01, 0.08) *
    waterMultiplier;
  const waterProcurementPenalty = +(baselineCapexInrCr * waterStressFactor).toFixed(1);

  const airFiltrationFactor =
    clamp((pm25 - 15) * 0.0008, 0.004, 0.055) *
    (query.projectType === 'medical_centre' ? 1.5 : 1.0);
  const airFiltrationPenalty = +(baselineCapexInrCr * airFiltrationFactor).toFixed(1);

  const unmitigated25YrPenaltyInrCr = +(
    hvacPenalty +
    floodRetrofitPenalty +
    waterProcurementPenalty +
    airFiltrationPenalty
  ).toFixed(1);

  const preventiveRate = PREVENTIVE_RATE_BY_PROJECT[query.projectType] ?? 0.065;
  const preventiveGreenCapexInrCr = +(baselineCapexInrCr * preventiveRate).toFixed(1);

  const hvacMitigated = +(hvacPenalty * 0.36).toFixed(1);
  const floodMitigated = +(floodRetrofitPenalty * 0.25).toFixed(1);
  const waterMitigated = +(waterProcurementPenalty * 0.35).toFixed(1);
  const airMitigated = +(airFiltrationPenalty * 0.45).toFixed(1);

  const residualPenalty = hvacMitigated + floodMitigated + waterMitigated + airMitigated;
  const grossSavings = unmitigated25YrPenaltyInrCr - residualPenalty;
  const net25YrAvoidedCostInrCr = +Math.max(0, grossSavings - preventiveGreenCapexInrCr).toFixed(1);
  const roiMultiple = +(grossSavings / Math.max(0.1, preventiveGreenCapexInrCr)).toFixed(2);

  const assumptions: CostAssumption[] = [
    {
      driver:
        query.projectType === 'agricultural_land'
          ? '25-Yr Crop Heat & Cold-Chain Load'
          : '25-Yr Excess Cooling & UHI Load',
      formulaNote: `+${coolingLoadIncreasePct}% thermal load from +${tempDelta.toFixed(
        1
      )}°C warming & ${uhiRatio.toFixed(1)}× built ratio`,
      unmitigatedInrCr: hvacPenalty,
      mitigatedInrCr: hvacMitigated,
    },
    {
      driver: 'Stormwater & Flood Plinth Retrofit',
      formulaNote: `${floodRatio.toFixed(2)}× GloFAS peak discharge ratio & ${relief.toFixed(
        1
      )} m terrain relief`,
      unmitigatedInrCr: floodRetrofitPenalty,
      mitigatedInrCr: floodMitigated,
    },
    {
      driver:
        query.projectType === 'agricultural_land'
          ? '25-Yr Irrigation & Aquifer Deficit'
          : '25-Yr Water Deficit & Tanker OpEx',
      formulaNote: `ET0 ${et0.toFixed(1)} mm/day & ${soilMoisture.toFixed(2)} m³/m³ soil moisture`,
      unmitigatedInrCr: waterProcurementPenalty,
      mitigatedInrCr: waterMitigated,
    },
    {
      driver:
        query.projectType === 'medical_centre'
          ? 'Clinical HEPA Filtration & Envelope Wear'
          : 'Particulate Filtration & Envelope Wear',
      formulaNote: `CAMS PM2.5 at ${pm25.toFixed(1)} µg/m³ across site air intake`,
      unmitigatedInrCr: airFiltrationPenalty,
      mitigatedInrCr: airFiltrationPenalty ? airMitigated : 0,
    },
  ];

  const penaltyRatio = unmitigated25YrPenaltyInrCr / Math.max(1, baselineCapexInrCr);
  const feasSuitability = Math.round(clamp(92 - penaltyRatio * 185, 16, 95));

  const feasPillar: PillarEvaluation = {
    id: 'feasibility',
    title: 'Long-Term Feasibility',
    riskLevel: toRiskLevel(feasSuitability),
    score: feasSuitability,
    headlineMetric: `₹${net25YrAvoidedCostInrCr.toFixed(1)}`,
    headlineUnit: 'Cr Net Saved',
    subMetric: `${roiMultiple.toFixed(1)}× preventive CapEx ROI`,
    findings: [
      `Unmitigated climate/site penalties add ₹${unmitigated25YrPenaltyInrCr.toFixed(1)} Cr (${(
        penaltyRatio * 100
      ).toFixed(1)}% of ₹${baselineCapexInrCr.toFixed(0)} Cr CapEx) over 25 years.`,
      `Early preventive & sponge-city design (₹${preventiveGreenCapexInrCr.toFixed(
        1
      )} Cr upfront) yields ${roiMultiple.toFixed(1)}× lifecycle return.`,
    ],
  };

  const pillars = [climatePillar, envPillar, geoPillar, sustPillar, feasPillar];
  const overallSuitability = Math.round(
    pillars.reduce((acc, p) => acc + p.score, 0) / pillars.length
  );

  const costProjection: CostProjection = {
    baselineCapexInrCr,
    unmitigated25YrPenaltyInrCr,
    preventiveGreenCapexInrCr,
    net25YrAvoidedCostInrCr,
    roiMultiple,
    coolingLoadIncreasePct,
    assumptions,
  };

  return {
    id: `${query.lat.toFixed(4)}_${query.lng.toFixed(4)}_${query.projectType}_${query.areaHectares}_${query.horizonYear}`,
    telemetry,
    pillars,
    overallSuitability,
    overallVerdict: toRiskLevel(overallSuitability),
    costProjection,
  };
}
