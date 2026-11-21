import { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  Download,
  Loader2,
  MapPin,
  Printer,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import { evaluateSiteTelemetry } from '../lib/evaluator';
import {
  BENCHMARK_CORRIDORS,
  type EnvironmentalTelemetry,
  type GeocodeResult,
  type HorizonYear,
  type ProjectType,
  type RiskLevel,
  type SiteAssessment,
  type SiteQuery,
} from '../types/site';
import { CompareCharts, type ComparisonScenarioMode } from './CompareCharts';
import { MetricHelpTooltip } from './MetricHelpTooltip';
import { MiniParcelMap } from './MiniParcelMap';

interface CompareViewProps {
  savedSites: SiteAssessment[];
  activeAssessment: SiteAssessment | null;
  isBenchmarkingAll: boolean;
  onRunAllCorridors: () => void;
  onSelectSite: (assessment: SiteAssessment) => void;
  onRemoveSite: (id: string) => void;
  onSitesChange: (sites: SiteAssessment[]) => void;
}

const PROJECT_OPTIONS: Array<{ id: ProjectType; label: string }> = [
  { id: 'residential_township', label: 'Residential Township' },
  { id: 'commercial_hub', label: 'Commercial Hub' },
  { id: 'industrial_park', label: 'Industry & Manufacturing Zone' },
  { id: 'medical_centre', label: 'Medical Centre & Hospital' },
  { id: 'agricultural_land', label: 'Agricultural Land & Agro-Park' },
  { id: 'solar_logistics_hub', label: 'Logistics & Solar Energy Park' },
  { id: 'green_infrastructure', label: 'Green Infrastructure & Sponge Park' },
];

function RiskLabel({ level }: { level: RiskLevel }) {
  if (level === 'Nominal') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-brand-400 print:text-brand-700">
        <CheckCircle2 className="w-3.5 h-3.5" /> Nominal
      </span>
    );
  }
  if (level === 'Moderate') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-400 print:text-[#0f2557]">
        <CheckCircle2 className="w-3.5 h-3.5" /> Moderate
      </span>
    );
  }
  if (level === 'Elevated') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-400 print:text-amber-700">
        <AlertTriangle className="w-3.5 h-3.5" /> Elevated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-400 print:text-rose-700">
      <XCircle className="w-3.5 h-3.5" /> Critical
    </span>
  );
}

function buildSiteImprovements(site: SiteAssessment): string[] {
  const tips: string[] = [];
  const t = site.telemetry;
  const c = site.costProjection;

  if ((t.climate.futureExtremeHeatDaysPerYr ?? 0) >= 35 || c.coolingLoadIncreasePct >= 28) {
    tips.push(
      `Thermal Load (+${c.coolingLoadIncreasePct}% cooling demand): specify high-albedo cool roofs, shaded arcades, and district chilled-water loops.`
    );
  }
  if ((t.flood.peakToMeanRatio ?? 1) >= 1.6 || (t.elevation.reliefMeters ?? 10) < 5) {
    tips.push(
      `Drainage & Flood Exposure (${(t.flood.peakToMeanRatio ?? 1).toFixed(2)}× peak flow): elevate critical plinths and integrate permeable retention swales.`
    );
  }
  if ((t.airQuality.pm25 ?? 0) >= 35) {
    tips.push(
      `Particulate Air Quality (${t.airQuality.pm25?.toFixed(1)} µg/m³ PM2.5): deploy MERV-13/HEPA intake filtration and dense vegetative buffer belts.`
    );
  }
  if ((t.currentConditions.evapotranspirationMmDay ?? 4) >= 4.2 || (t.currentConditions.soilMoistureM3m3 ?? 0.25) < 0.18) {
    tips.push(
      `Water Stress (ET0 ${(t.currentConditions.evapotranspirationMmDay ?? 0).toFixed(1)} mm/day): enforce 100% greywater recycling and aquifer recharge wells.`
    );
  }
  if (t.landUse2Km.greenFeaturesCount < 5) {
    tips.push(
      `Low Canopy Cooling (${t.landUse2Km.greenFeaturesCount} mapped green corridors): reserve at least 22–28% contiguous native tree cover.`
    );
  }
  if (tips.length === 0) {
    tips.push(
      `Strong baseline resilience: optimize rooftop solar PV (${(t.nasaPower.solarIrradianceKwhM2Day ?? 5).toFixed(2)} kWh/m²/d) and rainwater harvesting.`
    );
  }
  return tips.slice(0, 3);
}

interface SlotPickerProps {
  slotName: 'Location A' | 'Location B';
  accentClass: string;
  accentHex: string;
  currentSite: SiteAssessment | null;
  activeAnalyzerSite: SiteAssessment | null;
  isLoading: boolean;
  onPickCoordinates: (lat: number, lng: number, label: string, region: string) => void;
  onAssignExisting: (site: SiteAssessment) => void;
}

function LocationSlotPicker({
  slotName,
  accentClass,
  accentHex,
  currentSite,
  activeAnalyzerSite,
  isLoading,
  onPickCoordinates,
  onAssignExisting,
}: SlotPickerProps) {
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = queryText.trim();
    if (!q) return;
    setIsSearching(true);
    setSearchErr(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');
      const list = Array.isArray(data.results) ? data.results : [];
      setResults(list);
      if (list.length === 0) {
        setSearchErr('No matching location found.');
      }
    } catch (err: any) {
      setSearchErr(err?.message || 'Unable to search location.');
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="bg-[#141820] border border-[#232936] rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block w-3 h-3 rounded-xs shrink-0 ${accentClass}`} />
          <span className="text-xs font-mono font-bold uppercase text-slate-400">{slotName}</span>
        </div>
        {isLoading && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" /> Loading telemetry...
          </span>
        )}
      </div>

      {currentSite ? (
        <>
          <div className="flex items-baseline justify-between gap-3 pb-2 border-b border-[#232936]">
            <div className="min-w-0">
              <h3 className="text-base font-display font-bold text-white truncate">
                {currentSite.telemetry.query.label}
              </h3>
              <p className="text-xs text-slate-400">
                {currentSite.telemetry.query.region} ·{' '}
                <span className="font-mono tabular-nums">
                  {currentSite.telemetry.query.lat.toFixed(3)}, {currentSite.telemetry.query.lng.toFixed(3)}
                </span>
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-base font-mono tabular-nums font-extrabold text-white">
                {currentSite.overallSuitability}/100
              </div>
              <RiskLabel level={currentSite.overallVerdict} />
            </div>
          </div>

          <MiniParcelMap site={currentSite} accentHex={accentHex} />
        </>
      ) : (
        <div className="p-3 bg-[#0e1116] border border-dashed border-[#2a3140] rounded-md text-xs text-slate-400">
          Search any city or select a corridor below to assign {slotName}.
        </div>
      )}

      <form onSubmit={handleSearch} className="flex gap-1.5 print:hidden">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder={`Search city or parcel for ${slotName}...`}
            className="w-full pl-8 pr-2.5 py-2 text-xs text-slate-100 bg-[#0e1116] border border-[#2a3140] rounded-md placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
          />
        </div>
        <button
          type="submit"
          disabled={isSearching || isLoading}
          className="px-3 py-2 text-xs font-bold bg-[#1a1f29] border border-[#2a3140] text-brand-400 rounded-md hover:bg-brand-500 hover:text-slate-950 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
        >
          {isSearching ? '...' : 'Set'}
        </button>
      </form>

      {searchErr && <p className="text-xs text-amber-400 print:hidden">{searchErr}</p>}

      {results.length > 0 && (
        <div className="border border-[#2a3140] rounded-md divide-y divide-[#232936] max-h-36 overflow-y-auto bg-[#0e1116] print:hidden">
          {results.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                const shortLabel = item.displayName.split(',').slice(0, 2).join(', ');
                setResults([]);
                setQueryText('');
                onPickCoordinates(item.lat, item.lng, shortLabel, item.region);
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-[#1a1f29] transition-colors"
            >
              <div className="font-semibold text-white truncate">{item.displayName}</div>
              <div className="font-mono text-[10px] text-slate-400 tabular-nums">
                {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-1 print:hidden">
        {BENCHMARK_CORRIDORS.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={isLoading}
            onClick={() => onPickCoordinates(c.lat, c.lng, c.name, c.city)}
            className="px-2.5 py-1 text-[11px] font-semibold bg-[#0e1116] hover:bg-[#1a1f29] border border-[#232936] hover:border-brand-500/60 text-slate-300 hover:text-white rounded-md transition-colors whitespace-nowrap"
          >
            {c.city}
          </button>
        ))}
        {activeAnalyzerSite && (
          <button
            type="button"
            disabled={isLoading}
            onClick={() => onAssignExisting(activeAnalyzerSite)}
            className="px-2.5 py-1 text-[11px] font-semibold bg-brand-500/15 hover:bg-brand-500/25 border border-brand-500/50 text-brand-300 rounded-md transition-colors whitespace-nowrap inline-flex items-center gap-1"
          >
            <MapPin className="w-3 h-3 text-brand-400" /> Active Site
          </button>
        )}
      </div>
    </div>
  );
}

export function CompareView({
  savedSites,
  activeAssessment,
  isBenchmarkingAll,
  onRunAllCorridors,
  onSelectSite,
  onRemoveSite,
  onSitesChange,
}: CompareViewProps) {
  const [loadingSlot, setLoadingSlot] = useState<'A' | 'B' | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [scenarioMode, setScenarioMode] = useState<ComparisonScenarioMode>('baseline');

  const siteA = savedSites[0] || activeAssessment || null;
  const siteB = savedSites[1] || null;
  const displaySites = savedSites.length > 0 ? savedSites : siteA ? [siteA] : [];

  const activeProjectType: ProjectType =
    siteA?.telemetry.query.projectType ||
    siteB?.telemetry.query.projectType ||
    'residential_township';
  const activeArea: number =
    siteA?.telemetry.query.areaHectares || siteB?.telemetry.query.areaHectares || 40;
  const activeHorizon: HorizonYear =
    siteA?.telemetry.query.horizonYear || siteB?.telemetry.query.horizonYear || 2050;

  const fetchSiteForSlot = async (
    slot: 'A' | 'B',
    lat: number,
    lng: number,
    label: string,
    region: string,
    horizonOverride?: HorizonYear
  ) => {
    setLoadingSlot(slot);
    setSlotError(null);
    try {
      const q: SiteQuery = {
        lat,
        lng,
        label,
        region,
        projectType: activeProjectType,
        areaHectares: activeArea,
        horizonYear: horizonOverride || activeHorizon,
      };
      const res = await fetch('/api/analyze-site', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(q),
      });
      const telemetry: EnvironmentalTelemetry & { error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(telemetry.error || `Failed to load telemetry for ${label}`);
      }
      const evaluated = evaluateSiteTelemetry(telemetry);
      const nextList = [...displaySites];
      if (slot === 'A') {
        nextList[0] = evaluated;
      } else {
        if (!nextList[0] && activeAssessment) {
          nextList[0] = activeAssessment;
        }
        nextList[1] = evaluated;
      }
      onSitesChange(nextList.filter(Boolean));
    } catch (err: any) {
      setSlotError(err?.message || 'Unable to load comparison location.');
    } finally {
      setLoadingSlot(null);
    }
  };

  const handleAssignExisting = (slot: 'A' | 'B', site: SiteAssessment) => {
    const nextList = [...displaySites];
    if (slot === 'A') {
      nextList[0] = site;
    } else {
      if (!nextList[0] && activeAssessment) nextList[0] = activeAssessment;
      nextList[1] = site;
    }
    onSitesChange(nextList.filter(Boolean));
  };

  const handleSwapSlots = () => {
    if (!siteA || !siteB) return;
    const next = [siteB, siteA, ...displaySites.slice(2)];
    onSitesChange(next);
  };

  const handleSharedAssumptionsChange = async (
    patch: Partial<Pick<SiteQuery, 'projectType' | 'areaHectares' | 'horizonYear'>>
  ) => {
    const nextProject = patch.projectType || activeProjectType;
    const nextArea = patch.areaHectares || activeArea;
    const nextHorizon = patch.horizonYear || activeHorizon;

    if (patch.horizonYear && patch.horizonYear !== activeHorizon) {
      // Refetch telemetry for the new climate horizon
      setLoadingSlot('A');
      setSlotError(null);
      try {
        const refreshed = await Promise.all(
          displaySites.map(async (s) => {
            const q: SiteQuery = {
              ...s.telemetry.query,
              projectType: nextProject,
              areaHectares: nextArea,
              horizonYear: nextHorizon,
            };
            const res = await fetch('/api/analyze-site', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(q),
            });
            const telemetry = await res.json();
            if (!res.ok) throw new Error(telemetry.error || 'Horizon refresh failed');
            return evaluateSiteTelemetry(telemetry);
          })
        );
        onSitesChange(refreshed);
      } catch (err: any) {
        setSlotError(err?.message || 'Failed to update climate horizon.');
      } finally {
        setLoadingSlot(null);
      }
      return;
    }

    const updated = displaySites.map((s) =>
      evaluateSiteTelemetry({
        ...s.telemetry,
        query: {
          ...s.telemetry.query,
          projectType: nextProject,
          areaHectares: nextArea,
          horizonYear: nextHorizon,
        },
      })
    );
    onSitesChange(updated);
  };

  const handleQuickPair = async () => {
    setLoadingSlot('B');
    setSlotError(null);
    try {
      const pair = [BENCHMARK_CORRIDORS[0], BENCHMARK_CORRIDORS[1]];
      const results = await Promise.all(
        pair.map(async (c) => {
          const q: SiteQuery = {
            lat: c.lat,
            lng: c.lng,
            label: c.name,
            region: c.city,
            projectType: activeProjectType,
            areaHectares: activeArea,
            horizonYear: activeHorizon,
          };
          const res = await fetch('/api/analyze-site', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(q),
          });
          const telemetry = await res.json();
          if (!res.ok) throw new Error(telemetry.error || 'Quick pair load failed');
          return evaluateSiteTelemetry(telemetry);
        })
      );
      onSitesChange(results);
    } catch (err: any) {
      setSlotError(err?.message || 'Unable to load New Delhi vs. Bengaluru comparison.');
    } finally {
      setLoadingSlot(null);
    }
  };

  // Determine Side-by-Side Winner & Advisories when both A & B exist
  const hasTwoSites = Boolean(siteA && siteB);
  const shortA = siteA ? siteA.telemetry.query.label.split('—')[0].split(',')[0].trim() : '';
  const shortB = siteB ? siteB.telemetry.query.label.split('—')[0].split(',')[0].trim() : '';

  const scoreWinner =
    siteA && siteB
      ? siteA.overallSuitability >= siteB.overallSuitability
        ? { winner: shortA, diff: siteA.overallSuitability - siteB.overallSuitability, site: siteA }
        : { winner: shortB, diff: siteB.overallSuitability - siteA.overallSuitability, site: siteB }
      : null;

  const residualA = siteA
    ? +siteA.costProjection.assumptions.reduce((acc, a) => acc + a.mitigatedInrCr, 0).toFixed(1)
    : 0;
  const residualB = siteB
    ? +siteB.costProjection.assumptions.reduce((acc, a) => acc + a.mitigatedInrCr, 0).toFixed(1)
    : 0;

  const activeExposureA =
    scenarioMode === 'retrofit'
      ? residualA
      : siteA?.costProjection.unmitigated25YrPenaltyInrCr ?? 0;
  const activeExposureB =
    scenarioMode === 'retrofit'
      ? residualB
      : siteB?.costProjection.unmitigated25YrPenaltyInrCr ?? 0;

  const penaltyDiff =
    siteA && siteB ? +(activeExposureA - activeExposureB).toFixed(1) : 0;

  const handleExportCsv = () => {
    if (displaySites.length === 0) return;
    const headers = ['Metric', ...displaySites.map((s) => `"${s.telemetry.query.label}"`)];
    const rows: Array<[string, ...Array<string | number>]> = [
      ['Region', ...displaySites.map((s) => `"${s.telemetry.query.region}"`)],
      ['Project Typology', ...displaySites.map((s) => s.telemetry.query.projectType)],
      ['Footprint (ha)', ...displaySites.map((s) => s.telemetry.query.areaHectares)],
      ['Climate Horizon', ...displaySites.map((s) => s.telemetry.query.horizonYear)],
      ['Overall Suitability (/100)', ...displaySites.map((s) => s.overallSuitability)],
      ['Overall Verdict', ...displaySites.map((s) => s.overallVerdict)],
      ['Base Infrastructure CapEx (INR Cr)', ...displaySites.map((s) => s.costProjection.baselineCapexInrCr.toFixed(1))],
      ['Preventive Green Infra CapEx (INR Cr)', ...displaySites.map((s) => s.costProjection.preventiveGreenCapexInrCr.toFixed(1))],
      ['Unmitigated 25-Yr Penalty (INR Cr)', ...displaySites.map((s) => s.costProjection.unmitigated25YrPenaltyInrCr.toFixed(1))],
      [
        'Mitigated 25-Yr OpEx (INR Cr)',
        ...displaySites.map((s) =>
          s.costProjection.assumptions.reduce((acc, a) => acc + a.mitigatedInrCr, 0).toFixed(1)
        ),
      ],
      ['Net 25-Yr Avoided Savings (INR Cr)', ...displaySites.map((s) => s.costProjection.net25YrAvoidedCostInrCr.toFixed(1))],
      ['Preventive ROI Multiple', ...displaySites.map((s) => `${s.costProjection.roiMultiple.toFixed(1)}x`)],
      ['CMIP6 Temp Delta (+C)', ...displaySites.map((s) => s.telemetry.climate.tempDeltaC?.toFixed(2) ?? 'N/A')],
      ['Future Extreme Heat Days >=40C', ...displaySites.map((s) => s.telemetry.climate.futureExtremeHeatDaysPerYr ?? 'N/A')],
      ['CAMS US AQI', ...displaySites.map((s) => s.telemetry.airQuality.usAqi ?? 'N/A')],
      ['CAMS PM2.5 (ug/m3)', ...displaySites.map((s) => s.telemetry.airQuality.pm25?.toFixed(1) ?? 'N/A')],
      ['Elevation Center (m)', ...displaySites.map((s) => s.telemetry.elevation.centerMeters?.toFixed(0) ?? 'N/A')],
      ['Elevation Relief (m)', ...displaySites.map((s) => s.telemetry.elevation.reliefMeters?.toFixed(1) ?? 'N/A')],
      ['GloFAS Flood Peak Ratio', ...displaySites.map((s) => s.telemetry.flood.peakToMeanRatio?.toFixed(2) ?? 'N/A')],
      ['OSM 2km Green Features', ...displaySites.map((s) => s.telemetry.landUse2Km.greenFeaturesCount)],
      ['OSM 2km Water Features', ...displaySites.map((s) => s.telemetry.landUse2Km.waterFeaturesCount)],
      ['NASA Solar Irradiance (kWh/m2/d)', ...displaySites.map((s) => s.telemetry.nasaPower.solarIrradianceKwhM2Day?.toFixed(2) ?? 'N/A')],
    ];
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `terrasight-comparison-${activeHorizon}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Executive Print-Only Report Banner */}
      <div className="hidden print:flex items-center justify-between border-b-2 border-[#0f2557] pb-3 mb-4">
        <div>
          <div className="text-lg font-display font-extrabold text-[#0f2557]">
            TERRASIGHT — Pre-Construction Site Comparison Report
          </div>
          <div className="text-xs italic text-brand-700">
            “Analyse the future before building one” ·{' '}
            {PROJECT_OPTIONS.find((p) => p.id === activeProjectType)?.label} · {activeArea} ha · Horizon{' '}
            {activeHorizon} · Scenario: {scenarioMode === 'retrofit' ? 'Sponge-City + Cool Roof Retrofit' : 'Baseline Design'}
          </div>
        </div>
        <div className="text-right text-[11px] font-mono text-slate-600">
          Generated {new Date().toLocaleDateString()}
        </div>
      </div>

      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 border-b border-[#232936] pb-5 print:hidden">
        <div>
          <h1 className="text-2xl font-display font-extrabold text-white tracking-tight">
            Side-by-Side Location, Budget &amp; Infrastructure Comparison
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Add any 2 locations to inspect split-screen maps, estimated CapEx, sponge-city retrofits, and 25-year climate trajectories.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!siteA}
            className="px-3 py-2 text-xs font-bold bg-[#141820] border border-[#2a3140] hover:border-brand-500/60 text-slate-200 hover:text-white rounded-md disabled:opacity-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5 text-brand-400" /> Print / Save PDF
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={!siteA}
            className="px-3 py-2 text-xs font-bold bg-[#141820] border border-[#2a3140] hover:border-sky-400/60 text-slate-200 hover:text-white rounded-md disabled:opacity-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" /> Export CSV
          </button>
          <button
            type="button"
            onClick={handleQuickPair}
            disabled={loadingSlot !== null || isBenchmarkingAll}
            className="px-3.5 py-2 text-xs font-bold bg-brand-500 hover:bg-brand-300 text-slate-950 rounded-md disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            Compare Delhi vs. Bengaluru
          </button>
          <button
            type="button"
            onClick={onRunAllCorridors}
            disabled={isBenchmarkingAll || loadingSlot !== null}
            className="px-3.5 py-2 text-xs font-bold bg-[#1a1f29] border border-[#2a3140] text-white rounded-md hover:border-brand-500/60 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            {isBenchmarkingAll ? 'Fetching 3 Corridors...' : 'Benchmark All 3 Corridors'}
          </button>
        </div>
      </div>

      {slotError && (
        <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-md text-xs text-amber-200 print:hidden">
          {slotError}
        </div>
      )}

      {/* Dual Location Comparison Builder (Slot A vs Slot B with Split-Screen Mini Maps) */}
      <div className="grid grid-cols-1 lg:grid-cols-11 gap-4 items-stretch">
        <div className="lg:col-span-5">
          <LocationSlotPicker
            slotName="Location A"
            accentClass="bg-sky-400"
            accentHex="#38bdf8"
            currentSite={siteA}
            activeAnalyzerSite={activeAssessment}
            isLoading={loadingSlot === 'A'}
            onPickCoordinates={(lat, lng, label, region) => fetchSiteForSlot('A', lat, lng, label, region)}
            onAssignExisting={(s) => handleAssignExisting('A', s)}
          />
        </div>

        <div className="lg:col-span-1 flex items-center justify-center print:hidden">
          <button
            type="button"
            onClick={handleSwapSlots}
            disabled={!hasTwoSites}
            title="Swap Location A and Location B"
            className="px-3 py-2 bg-[#141820] border border-[#2a3140] hover:border-brand-500/60 disabled:opacity-40 text-slate-200 rounded-md transition-colors inline-flex items-center gap-1.5 text-xs font-bold"
          >
            <ArrowLeftRight className="w-4 h-4 text-brand-400" />
            <span className="lg:hidden">Swap Locations</span>
          </button>
        </div>

        <div className="lg:col-span-5">
          <LocationSlotPicker
            slotName="Location B"
            accentClass="bg-brand-500"
            accentHex="#5C99EE"
            currentSite={siteB}
            activeAnalyzerSite={activeAssessment}
            isLoading={loadingSlot === 'B'}
            onPickCoordinates={(lat, lng, label, region) => fetchSiteForSlot('B', lat, lng, label, region)}
            onAssignExisting={(s) => handleAssignExisting('B', s)}
          />
        </div>
      </div>

      {/* Shared Apples-to-Apples Budget, Scale Presets & Scenario Assumptions Toolbar */}
      <section className="bg-[#141820] border border-[#232936] rounded-lg p-4 space-y-4 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-4">
            <label htmlFor="compare-project-type" className="block text-[11px] font-bold text-slate-300 mb-1">
              Project Typology (Apples-to-Apples Budget Basis)
            </label>
            <select
              id="compare-project-type"
              value={activeProjectType}
              onChange={(e) =>
                handleSharedAssumptionsChange({ projectType: e.target.value as ProjectType })
              }
              className="w-full px-3 py-2 text-xs font-semibold text-slate-100 bg-[#0e1116] border border-[#2a3140] rounded-md focus:outline-none focus:border-brand-500"
            >
              {PROJECT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <div className="flex items-center justify-between text-[11px] mb-1">
              <label htmlFor="compare-area" className="font-bold text-slate-300">
                Site Footprint
              </label>
              <div className="flex items-center gap-1.5">
                {[15, 45, 100].map((presetHa) => (
                  <button
                    key={presetHa}
                    type="button"
                    onClick={() => handleSharedAssumptionsChange({ areaHectares: presetHa })}
                    className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded border transition-colors ${
                      activeArea === presetHa
                        ? 'bg-brand-500 text-slate-950 border-brand-500'
                        : 'bg-[#0e1116] text-slate-400 border-[#2a3140] hover:border-brand-500/60 hover:text-white'
                    }`}
                  >
                    {presetHa}ha
                  </button>
                ))}
                <span className="font-mono tabular-nums font-bold text-brand-400 ml-1">
                  {activeArea} ha
                </span>
              </div>
            </div>
            <input
              id="compare-area"
              type="range"
              min={10}
              max={150}
              step={5}
              value={activeArea}
              onChange={(e) =>
                handleSharedAssumptionsChange({ areaHectares: Number(e.target.value) })
              }
              className="w-full accent-brand-500"
            />
          </div>

          <div className="md:col-span-4 flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <span className="block text-[11px] font-bold text-slate-300 mb-1">Climate Horizon</span>
              <div className="flex items-center gap-1 p-1 bg-[#0e1116] border border-[#232936] rounded-md">
                {([2035, 2050] as HorizonYear[]).map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => handleSharedAssumptionsChange({ horizonYear: yr })}
                    className={`flex-1 py-1 text-xs font-mono font-bold rounded-sm transition-colors ${
                      activeHorizon === yr ? 'bg-brand-500 text-slate-950' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {yr}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-[1.5]">
              <span className="block text-[11px] font-bold text-slate-300 mb-1">
                Design Scenario Preset
              </span>
              <div className="flex items-center gap-1 p-1 bg-[#0e1116] border border-[#232936] rounded-md">
                <button
                  type="button"
                  onClick={() => setScenarioMode('baseline')}
                  className={`flex-1 py-1 px-2 text-[11px] font-bold rounded-sm transition-colors whitespace-nowrap ${
                    scenarioMode === 'baseline'
                      ? 'bg-sky-400 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Baseline Design
                </button>
                <button
                  type="button"
                  onClick={() => setScenarioMode('retrofit')}
                  className={`flex-1 py-1 px-2 text-[11px] font-bold rounded-sm transition-colors whitespace-nowrap ${
                    scenarioMode === 'retrofit'
                      ? 'bg-brand-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Sponge-City + Cool Roof
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Executive Side-by-Side Budget & Cost KPI Row + Charts when 2 Locations are Selected */}
      {siteA && siteB ? (
        <>
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-[#141820] border border-[#232936] rounded-lg p-4">
              <div className="text-[11px] font-semibold text-slate-400">Suitability Leader</div>
              <div className="text-lg font-display font-extrabold text-white mt-1 truncate">
                {scoreWinner?.winner}
              </div>
              <div className="text-xs font-mono tabular-nums text-brand-400 font-bold mt-0.5">
                {scoreWinner?.diff === 0
                  ? 'Even score'
                  : `+${scoreWinner?.diff} pts higher (${siteA.overallSuitability} vs ${siteB.overallSuitability})`}
              </div>
            </div>

            <div className="bg-[#141820] border border-[#232936] rounded-lg p-4">
              <div className="text-[11px] font-semibold text-slate-400">Estimated Base CapEx</div>
              <div className="text-lg font-mono tabular-nums font-extrabold text-white mt-1">
                ₹{siteA.costProjection.baselineCapexInrCr.toFixed(0)} Cr
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-400 mt-0.5">
                vs ₹{siteB.costProjection.baselineCapexInrCr.toFixed(0)} Cr ({activeArea} ha)
              </div>
            </div>

            <div className="bg-[#141820] border border-[#232936] rounded-lg p-4">
              <div className="text-[11px] font-semibold text-slate-400">Preventive Infra Budget</div>
              <div className="text-lg font-mono tabular-nums font-extrabold text-sky-300 mt-1">
                ₹{siteA.costProjection.preventiveGreenCapexInrCr.toFixed(1)} Cr
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-400 mt-0.5">
                {shortB}: ₹{siteB.costProjection.preventiveGreenCapexInrCr.toFixed(1)} Cr upfront
              </div>
            </div>

            <div className="bg-[#141820] border border-[#232936] rounded-lg p-4">
              <div className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <span>
                  {scenarioMode === 'retrofit' ? '25-Yr Mitigated OpEx' : '25-Yr Penalty Exposure'}
                </span>
                <MetricHelpTooltip
                  title={scenarioMode === 'retrofit' ? '25-Yr Mitigated OpEx' : '25-Yr Penalty Exposure'}
                  explanation="Projects 25-year HVAC cooling, flood repair, water procurement, and filtration operating costs under each scenario."
                  budgetImpact="Switching to Sponge-City + Cool Roof Retrofit replaces steep unmitigated losses with predictable, lower lifecycle OpEx."
                />
              </div>
              <div
                className={`text-lg font-mono tabular-nums font-extrabold mt-1 ${
                  scenarioMode === 'retrofit' ? 'text-sky-300' : 'text-rose-400'
                }`}
              >
                ₹{activeExposureA.toFixed(1)} vs ₹{activeExposureB.toFixed(1)} Cr
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-400 mt-0.5">
                {penaltyDiff === 0
                  ? 'Equal exposure'
                  : penaltyDiff > 0
                    ? `${shortB} lower by ₹${penaltyDiff.toFixed(1)} Cr`
                    : `${shortA} lower by ₹${Math.abs(penaltyDiff).toFixed(1)} Cr`}
              </div>
            </div>

            <div className="bg-brand-950/25 border border-brand-500/40 rounded-lg p-4">
              <div className="text-[11px] font-bold text-brand-300 flex items-center gap-1">
                <span>Net 25-Yr Avoided Savings</span>
                <MetricHelpTooltip
                  title="Net 25-Year Avoided Cost"
                  explanation="Total 25-year penalty avoided by pre-construction green infrastructure minus upfront preventive CapEx."
                  budgetImpact="Positive savings and a >2.0× ROI multiple confirm preventive upgrades pay back early in the asset lifecycle."
                />
              </div>
              <div className="text-lg font-mono tabular-nums font-extrabold text-brand-400 mt-1">
                ₹{siteA.costProjection.net25YrAvoidedCostInrCr.toFixed(1)} vs ₹
                {siteB.costProjection.net25YrAvoidedCostInrCr.toFixed(1)} Cr
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-300 mt-0.5">
                ROI {siteA.costProjection.roiMultiple.toFixed(1)}× vs {siteB.costProjection.roiMultiple.toFixed(1)}×
              </div>
            </div>
          </section>

          {/* Pie Charts, Grouped Budget Bars, 5-Pillar Bars, 25-Yr Line Graph, Monthly Temp Graph */}
          <CompareCharts siteA={siteA} siteB={siteB} scenarioMode={scenarioMode} />

          {/* Side-by-Side Engineering & Improvement Advisory */}
          <section className="bg-[#141820] border border-[#232936] rounded-lg p-5 space-y-4">
            <div className="border-b border-[#232936] pb-3">
              <h2 className="text-base font-display font-bold text-white">
                Side-by-Side Feasibility Verdict &amp; Required Site Improvements
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Based on live CMIP6 climate deltas, Copernicus 90m elevation, CAMS air quality, and GloFAS hydrology:
                {' '}
                <strong className="text-brand-400">
                  {scoreWinner?.winner} leads overall suitability ({Math.max(siteA.overallSuitability, siteB.overallSuitability)}/100)
                </strong>
                {penaltyDiff !== 0 &&
                  ` and ${penaltyDiff > 0 ? shortB : shortA} carries ₹${Math.abs(penaltyDiff).toFixed(1)} Cr lower ${
                    scenarioMode === 'retrofit' ? 'mitigated 25-year OpEx' : 'unmitigated 25-year infrastructure penalty'
                  }.`}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-[#0e1116] border border-[#232936] rounded-lg space-y-2.5">
                <h3 className="text-sm font-display font-bold text-sky-300">
                  Recommended Upgrades for {shortA}
                </h3>
                <ul className="space-y-2 text-xs text-slate-300 leading-relaxed list-disc list-inside">
                  {buildSiteImprovements(siteA).map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>

              <div className="p-4 bg-brand-950/20 border border-brand-500/35 rounded-lg space-y-2.5">
                <h3 className="text-sm font-display font-bold text-brand-400">
                  Recommended Upgrades for {shortB}
                </h3>
                <ul className="space-y-2 text-xs text-slate-300 leading-relaxed list-disc list-inside">
                  {buildSiteImprovements(siteB).map((tip, i) => (
                    <li key={i}>{tip}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </>
      ) : (
        <div className="bg-[#141820] border border-[#232936] rounded-lg p-6 text-center space-y-2">
          <p className="text-sm font-bold text-white">
            Select Location B above to unlock side-by-side pie charts, budget bar charts, and 25-year cost graphs
          </p>
          <p className="text-xs text-slate-400 max-w-lg mx-auto">
            {siteA
              ? `${shortA} is loaded in Location A. Search any city in Location B or click a corridor chip (e.g., Bengaluru or Ahmedabad).`
              : 'Pick any two cities or corridors above, or click "Compare Delhi vs. Bengaluru" for an instant side-by-side analysis.'}
          </p>
        </div>
      )}

      {/* Detailed Side-by-Side Comparison Matrix Table */}
      {displaySites.length > 0 && (
        <div className="bg-[#141820] border border-[#232936] rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[760px]">
            <thead>
              <tr className="border-b border-[#232936] bg-[#0e1116] text-white">
                <th className="py-3.5 px-4 text-xs font-bold text-slate-300 w-60">Evaluation &amp; Budget Metric</th>
                {displaySites.map((site, idx) => (
                  <th key={`${site.id}_${idx}`} className="py-3.5 px-4 border-l border-[#232936] align-top">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-mono uppercase text-brand-400">
                          Location {String.fromCharCode(65 + idx)}
                        </div>
                        <div className="text-sm font-bold text-white">
                          {site.telemetry.query.label}
                        </div>
                        <div className="text-xs text-slate-400 font-normal mt-0.5">
                          {site.telemetry.query.projectType.replace(/_/g, ' ')} ·{' '}
                          {site.telemetry.query.areaHectares} ha · {site.telemetry.query.horizonYear}
                        </div>
                      </div>
                      {savedSites.length > 0 && (
                        <button
                          type="button"
                          onClick={() => onRemoveSite(site.id)}
                          aria-label={`Remove ${site.telemetry.query.label}`}
                          className="p-1 text-slate-400 hover:text-rose-400 transition-colors print:hidden"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#232936] text-xs">
              <tr>
                <td className="py-3 px-4 font-semibold text-white">Overall Site Suitability</td>
                {displaySites.map((site, idx) => (
                  <td key={`${site.id}_suit_${idx}`} className="py-3 px-4 border-l border-[#232936]">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-mono tabular-nums font-bold text-white">
                        {site.overallSuitability}/100
                      </span>
                      <RiskLabel level={site.overallVerdict} />
                    </div>
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 px-4 font-medium text-slate-300">Estimated Base Infrastructure CapEx</td>
                {displaySites.map((site, idx) => (
                  <td key={`${site.id}_base_${idx}`} className="py-3 px-4 border-l border-[#232936] font-mono tabular-nums font-semibold text-white">
                    ₹{site.costProjection.baselineCapexInrCr.toFixed(1)} Cr
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 px-4 font-medium text-slate-300">Upfront Preventive Resilience Infra</td>
                {displaySites.map((site, idx) => (
                  <td key={`${site.id}_prev_${idx}`} className="py-3 px-4 border-l border-[#232936] font-mono tabular-nums text-sky-300">
                    ₹{site.costProjection.preventiveGreenCapexInrCr.toFixed(1)} Cr
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 px-4 font-medium text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    CMIP6 Warming &amp; Extreme Heat
                    <MetricHelpTooltip
                      title="CMIP6 Warming & Extreme Heat"
                      explanation="Projected temperature rise vs 1981–2010 baseline and annual count of days reaching 40°C or higher."
                      budgetImpact="Higher heat deltas increase peak chiller capacity, electricity tariffs, and cool-roof CapEx."
                    />
                  </span>
                </td>
                {displaySites.map((site, idx) => (
                  <td key={`${site.id}_clim_${idx}`} className="py-3 px-4 border-l border-[#232936] font-mono tabular-nums text-slate-200">
                    {site.telemetry.climate.tempDeltaC !== null
                      ? `+${site.telemetry.climate.tempDeltaC.toFixed(2)} °C (${
                          site.telemetry.climate.futureExtremeHeatDaysPerYr ?? '--'
                        } days ≥40°C)`
                      : 'N/A'}
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 px-4 font-medium text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    CAMS Air Quality &amp; PM2.5
                    <MetricHelpTooltip
                      title="CAMS Air Quality & PM2.5"
                      explanation="Copernicus Atmosphere Monitoring Service particulate matter (PM2.5) and US Air Quality Index at the parcel."
                      budgetImpact="Elevated PM2.5 requires MERV-13/HEPA intake filtration, higher fan energy, and perimeter tree buffers."
                    />
                  </span>
                </td>
                {displaySites.map((site, idx) => (
                  <td key={`${site.id}_air_${idx}`} className="py-3 px-4 border-l border-[#232936] font-mono tabular-nums text-slate-200">
                    US AQI {site.telemetry.airQuality.usAqi ?? '--'} ·{' '}
                    {site.telemetry.airQuality.pm25?.toFixed(1) ?? '--'} µg/m³
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 px-4 font-medium text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    Copernicus 90m DEM &amp; Relief
                    <MetricHelpTooltip
                      title="Copernicus 90m DEM & Relief"
                      explanation="Ground elevation above sea level and height difference (relief) across a 2 km parcel grid."
                      budgetImpact="Flat terrain (<5m relief) slows gravity drainage and needs stormwater pumping; steep relief raises cut-and-fill grading."
                    />
                  </span>
                </td>
                {displaySites.map((site, idx) => (
                  <td key={`${site.id}_dem_${idx}`} className="py-3 px-4 border-l border-[#232936] font-mono tabular-nums text-slate-200">
                    {site.telemetry.elevation.centerMeters?.toFixed(0) ?? '--'} m elev ·{' '}
                    {site.telemetry.elevation.reliefMeters?.toFixed(1) ?? '--'} m relief
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 px-4 font-medium text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    GloFAS Flood Peak Ratio
                    <MetricHelpTooltip
                      title="GloFAS Flood Peak Ratio"
                      explanation="Ratio of peak 60-day river discharge to baseline mean flow from the Global Flood Awareness System."
                      budgetImpact="Ratios above 1.6× trigger elevated plinths, retention basins, and higher flood insurance reserves."
                    />
                  </span>
                </td>
                {displaySites.map((site, idx) => (
                  <td key={`${site.id}_flood_${idx}`} className="py-3 px-4 border-l border-[#232936] font-mono tabular-nums text-slate-200">
                    {site.telemetry.flood.max60DayDischargeM3s?.toFixed(1) ?? '--'} m³/s (
                    {site.telemetry.flood.peakToMeanRatio?.toFixed(2) ?? '--'}× mean)
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 px-4 font-medium text-slate-300">
                  <span className="inline-flex items-center gap-1">
                    OSM 2 km Green vs. Built
                    <MetricHelpTooltip
                      title="OSM 2 km Green vs. Built"
                      explanation="Count of mapped parks/forests, water bodies, and built footprints within 2 km of the site center."
                      budgetImpact="Low natural canopy amplifies Urban Heat Island temperatures, requiring larger onsite green setbacks."
                    />
                  </span>
                </td>
                {displaySites.map((site, idx) => (
                  <td key={`${site.id}_osm_${idx}`} className="py-3 px-4 border-l border-[#232936] font-mono tabular-nums text-slate-200">
                    {site.telemetry.landUse2Km.greenFeaturesCount} green ·{' '}
                    {site.telemetry.landUse2Km.waterFeaturesCount} water ·{' '}
                    {site.telemetry.landUse2Km.urbanBuiltCount} built
                  </td>
                ))}
              </tr>

              <tr>
                <td className="py-3 px-4 font-medium text-slate-300">NASA Solar Irradiance</td>
                {displaySites.map((site, idx) => (
                  <td key={`${site.id}_sol_${idx}`} className="py-3 px-4 border-l border-[#232936] font-mono tabular-nums text-slate-200">
                    {site.telemetry.nasaPower.solarIrradianceKwhM2Day?.toFixed(2) ?? '--'} kWh/m²/day
                  </td>
                ))}
              </tr>

              <tr className="bg-[#0e1116]/70">
                <td className="py-3 px-4 font-bold text-white">Unmitigated 25-Yr Penalty</td>
                {displaySites.map((site, idx) => (
                  <td
                    key={`${site.id}_pen_${idx}`}
                    className="py-3 px-4 border-l border-[#232936] font-mono tabular-nums font-bold text-rose-400"
                  >
                    ₹{site.costProjection.unmitigated25YrPenaltyInrCr.toFixed(1)} Cr
                  </td>
                ))}
              </tr>

              <tr className="bg-brand-950/25">
                <td className="py-3 px-4 font-bold text-brand-300">
                  Net 25-Yr Avoided Cost (Preventive)
                </td>
                {displaySites.map((site, idx) => (
                  <td
                    key={`${site.id}_net_${idx}`}
                    className="py-3 px-4 border-l border-[#232936] font-mono tabular-nums font-bold text-brand-400"
                  >
                    ₹{site.costProjection.net25YrAvoidedCostInrCr.toFixed(1)} Cr (
                    {site.costProjection.roiMultiple.toFixed(1)}× ROI)
                  </td>
                ))}
              </tr>

              <tr className="print:hidden">
                <td className="py-3 px-4 font-medium text-slate-300">Inspect in Workbench</td>
                {displaySites.map((site, idx) => (
                  <td key={`${site.id}_load_${idx}`} className="py-3 px-4 border-l border-[#232936]">
                    <button
                      type="button"
                      onClick={() => onSelectSite(site)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-400 hover:text-brand-300 transition-colors"
                    >
                      Load Site Telemetry <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
