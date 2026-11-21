import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowUpRight,
  BookmarkCheck,
  BookmarkPlus,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  HardDrive,
  Loader2,
  LogOut,
  MapPin,
  MessageSquare,
  Search,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { AuthGate } from './components/AuthGate';
import { ClimateCharts } from './components/ClimateCharts';
import { CompareView } from './components/CompareView';
import { CornerFutureAI } from './components/CornerFutureAI';
import { MetricHelpTooltip } from './components/MetricHelpTooltip';
import { PlanningAdvisor } from './components/PlanningAdvisor';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { SatelliteMap } from './components/SatelliteMap';
import { useCachedFieldSites, useOnlineStatus, type CachedFieldSiteSummary } from './hooks/useOnlineStatus';
import { evaluateSiteTelemetry } from './lib/evaluator';
import { firebaseAuth, signOutFirebase } from './lib/firebase';
import {
  getActiveSupabaseSession,
  signOutSupabase,
  supabase,
} from './lib/supabase';
import {
  BENCHMARK_CORRIDORS,
  type AiBrief,
  type AuthSessionState,
  type BenchmarkCorridor,
  type ChatMessage,
  type ChatModelId,
  type EnvironmentalTelemetry,
  type GeocodeResult,
  type HorizonYear,
  type MapLayerMode,
  type ProjectType,
  type RiskLevel,
  type SavedAssessmentRecord,
  type SiteAssessment,
  type SiteQuery,
} from './types/site';

type ActiveTab = 'analyzer' | 'compare' | 'advisor';

const PROJECT_LABELS: Record<ProjectType, string> = {
  residential_township: 'Residential Township',
  commercial_hub: 'Commercial Hub',
  industrial_park: 'Industry & Manufacturing Zone',
  medical_centre: 'Medical Centre & Hospital',
  agricultural_land: 'Agricultural Land & Agro-Park',
  solar_logistics_hub: 'Logistics & Solar Energy Park',
  green_infrastructure: 'Green Infrastructure & Sponge Park',
};

const PILLAR_HELP: Record<string, { explanation: string; budgetImpact: string }> = {
  climate: {
    explanation:
      'Measures CMIP6 warming delta and annual days >=40°C compared against the 1981–2010 historical baseline.',
    budgetImpact:
      'More extreme heat days raise peak HVAC chiller tonnage, energy OpEx, and cool-roof shading requirements.',
  },
  environment: {
    explanation:
      'Combines live CAMS particulate air quality (PM2.5) and daily water evaporation stress (ET0).',
    budgetImpact:
      'High PM2.5 and water stress demand MERV-13/HEPA intake filtration, greywater recycling, and vegetative buffers.',
  },
  geography: {
    explanation:
      'Evaluates Copernicus 90m elevation relief and GloFAS 60-day peak-to-mean river discharge ratios.',
    budgetImpact:
      'Flat basins or high flood ratios require raised critical plinths, retention ponds, and stormwater pumping.',
  },
  sustainability: {
    explanation:
      'Assesses OpenStreetMap 2 km green/water ecosystem corridors against NASA POWER solar irradiance.',
    budgetImpact:
      'Sparse surrounding green cover increases Urban Heat Island load, while high solar radiation boosts PV payback.',
  },
  feasibility: {
    explanation:
      'Calculates the net 25-year avoided cost and ROI multiple of preventive design versus unmitigated damage.',
    budgetImpact:
      'Shows how much lifecycle CapEx + OpEx your organization preserves by investing in resilience pre-construction.',
  },
};

function VerdictBadge({ level }: { level: RiskLevel }) {
  if (level === 'Nominal') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-brand-400">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Nominal
      </span>
    );
  }
  if (level === 'Moderate') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-sky-400">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Moderate
      </span>
    );
  }
  if (level === 'Elevated') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-400">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Elevated
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-400">
      <XCircle className="w-3.5 h-3.5 shrink-0" /> Critical
    </span>
  );
}

function TelemetryRing({
  ratio,
  color,
  trackColor = '#232936',
  label,
  sublabel,
}: {
  ratio: number;
  color: string;
  trackColor?: string;
  label: string;
  sublabel: string;
}) {
  const clamped = Math.max(0.05, Math.min(1, ratio));
  const r = 24;
  const circ = 2 * Math.PI * r;
  const dash = circ * clamped;
  return (
    <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
      <svg viewBox="0 0 64 64" className="w-16 h-16 -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke={trackColor} strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={`${dash.toFixed(1)} ${circ.toFixed(1)}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <span className="text-xs font-mono font-bold tabular-nums text-white">{label}</span>
        <span className="text-[9px] font-mono text-slate-400 mt-0.5">{sublabel}</span>
      </div>
    </div>
  );
}

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSessionState | null>(null);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const [mapsQuotaWarning, setMapsQuotaWarning] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('analyzer');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const initialCorridor = BENCHMARK_CORRIDORS[0];
  const [siteQuery, setSiteQuery] = useState<SiteQuery>({
    lat: initialCorridor.lat,
    lng: initialCorridor.lng,
    label: initialCorridor.name,
    region: initialCorridor.city,
    projectType: initialCorridor.defaultProjectType,
    areaHectares: initialCorridor.defaultAreaHectares,
    horizonYear: 2050,
  });

  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const [layerMode, setLayerMode] = useState<MapLayerMode>('satellite');
  const [showElevationGrid, setShowElevationGrid] = useState(true);
  const [showLandUseBuffer, setShowLandUseBuffer] = useState(true);

  const [assessment, setAssessment] = useState<SiteAssessment | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [cachedTelemetryAt, setCachedTelemetryAt] = useState<string | null>(null);

  const isOnline = useOnlineStatus();
  const { cachedSites, refreshCachedSites } = useCachedFieldSites();

  const [aiBrief, setAiBrief] = useState<AiBrief | null>(null);
  const [isGeneratingBrief, setIsGeneratingBrief] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const [cloudSavedSites, setCloudSavedSites] = useState<SavedAssessmentRecord[]>([]);
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  const [saveDbNotice, setSaveDbNotice] = useState<string | null>(null);

  const [savedSites, setSavedSites] = useState<SiteAssessment[]>([]);
  const [isBenchmarkingAll, setIsBenchmarkingAll] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatModel, setChatModel] = useState<ChatModelId>('gemini-4-hydrogen');

  useEffect(() => {
    const handleQuotaEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail;
      setMapsQuotaWarning(
        detail ||
          'Google Maps Platform quota or authentication limit reached. Coordinate search and environmental telemetry remain operational.'
      );
    };
    window.addEventListener('gmp-quota-exceeded', handleQuotaEvent);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuotaEvent);
  }, []);

  useEffect(() => {
    let active = true;

    const syncInitial = async () => {
      const sbSession = await getActiveSupabaseSession();
      if (!active) return;
      if (sbSession?.user) {
        setAuthSession({
          provider: 'supabase',
          uid: sbSession.user.id,
          email: sbSession.user.email || 'planner@terrasight',
          emailVerified: Boolean(sbSession.user.email_confirmed_at),
          token: sbSession.access_token,
        });
        setShowAuthScreen(false);
      }
      setAuthReady(true);
    };
    syncInitial();

    const { data: sbListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (session?.user) {
        setAuthSession({
          provider: 'supabase',
          uid: session.user.id,
          email: session.user.email || 'planner@terrasight',
          emailVerified: Boolean(session.user.email_confirmed_at),
          token: session.access_token,
        });
        if (event === 'SIGNED_IN') {
          setShowAuthScreen(false);
        }
      } else {
        setAuthSession((prev) => (prev?.provider === 'supabase' ? null : prev));
      }
      setAuthReady(true);
    });

    const unsubFirebase = onAuthStateChanged(firebaseAuth, async (fbUser) => {
      if (!active) return;
      if (fbUser) {
        const token = await fbUser.getIdToken();
        setAuthSession({
          provider: 'firebase',
          uid: fbUser.uid,
          email: fbUser.email || 'google-user@terrasight',
          emailVerified: fbUser.emailVerified,
          token,
        });
        setShowAuthScreen(false);
      } else {
        setAuthSession((prev) => (prev?.provider === 'firebase' ? null : prev));
      }
      setAuthReady(true);
    });

    return () => {
      active = false;
      sbListener.subscription.unsubscribe();
      unsubFirebase();
    };
  }, []);

  const loadCloudAssessments = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/assessments', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.assessments)) {
        setCloudSavedSites(data.assessments);
      }
    } catch {
      // Ignore silent background sync errors
    }
  }, []);

  useEffect(() => {
    if (authSession?.token) {
      loadCloudAssessments(authSession.token);
    } else {
      setCloudSavedSites([]);
    }
  }, [authSession?.token, loadCloudAssessments]);

  const fetchAiBrief = useCallback(async (nextAssessment: SiteAssessment) => {
    setIsGeneratingBrief(true);
    setBriefError(null);
    try {
      const res = await fetch('/api/ai/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment: nextAssessment }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI synthesis failed.');
      }
      setAiBrief(data);
    } catch (err: any) {
      setBriefError(err?.message || 'Unable to generate AI site brief.');
      setAiBrief(null);
    } finally {
      setIsGeneratingBrief(false);
    }
  }, []);

  const runAnalysis = useCallback(
    async (queryToRun: SiteQuery) => {
      setIsAnalyzing(true);
      setAnalysisError(null);
      setCachedTelemetryAt(null);
      setAiBrief(null);
      setBriefError(null);
      setSaveDbNotice(null);

      try {
        const res = await fetch('/api/analyze-site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(queryToRun),
        });
        const isCacheHit = res.headers.get('X-TerraSight-Cache') === 'HIT';
        const cachedHeaderTime = res.headers.get('X-TerraSight-Cached-At');
        const telemetry: EnvironmentalTelemetry & { error?: string } = await res.json();
        if (!res.ok) {
          throw new Error(
            telemetry.error || 'Failed to fetch live public environmental telemetry.'
          );
        }

        if (isCacheHit) {
          setCachedTelemetryAt(cachedHeaderTime || telemetry.fetchedAt || new Date().toISOString());
        } else {
          setCachedTelemetryAt(null);
        }

        const evaluated = evaluateSiteTelemetry(telemetry);
        setAssessment(evaluated);
        setIsAnalyzing(false);
        refreshCachedSites();

        fetchAiBrief(evaluated);
      } catch (err: any) {
        setAnalysisError(err?.message || 'Site analysis request failed.');
        setIsAnalyzing(false);
      }
    },
    [fetchAiBrief, refreshCachedSites]
  );

  const hasRunInitialRef = useRef(false);
  useEffect(() => {
    if (!showAuthScreen && !hasRunInitialRef.current) {
      hasRunInitialRef.current = true;
      runAnalysis(siteQuery);
    }
  }, [showAuthScreen, runAnalysis, siteQuery]);

  const handleProjectConfigChange = (
    patch: Partial<Pick<SiteQuery, 'projectType' | 'areaHectares' | 'horizonYear'>>
  ) => {
    const updated = { ...siteQuery, ...patch };
    setSiteQuery(updated);
    if (patch.horizonYear && patch.horizonYear !== siteQuery.horizonYear) {
      runAnalysis(updated);
    } else if (assessment) {
      const reEvaluated = evaluateSiteTelemetry({
        ...assessment.telemetry,
        query: updated,
      });
      setAssessment(reEvaluated);
    }
  };

  const handleSelectBenchmark = (corridor: BenchmarkCorridor) => {
    const next: SiteQuery = {
      lat: corridor.lat,
      lng: corridor.lng,
      label: corridor.name,
      region: corridor.city,
      projectType: corridor.defaultProjectType,
      areaHectares: corridor.defaultAreaHectares,
      horizonYear: siteQuery.horizonYear,
    };
    setSiteQuery(next);
    setSearchResults([]);
    runAnalysis(next);
  };

  const handleMapClick = async (lat: number, lng: number, placeLabel?: string) => {
    const optimisticQuery: SiteQuery = {
      ...siteQuery,
      lat,
      lng,
      label: placeLabel || `Parcel (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      region: placeLabel ? 'Google Places Selection' : 'Resolving place name...',
    };
    setSiteQuery(optimisticQuery);

    try {
      const res = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
      const geo = await res.json();
      const resolvedQuery: SiteQuery = {
        ...optimisticQuery,
        label: placeLabel || geo.label || optimisticQuery.label,
        region: geo.region || 'Selected Coordinates',
      };
      setSiteQuery(resolvedQuery);
      runAnalysis(resolvedQuery);
    } catch {
      runAnalysis(optimisticQuery);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Geocoding failed');
      setSearchResults(data.results || []);
      if (!data.results?.length) {
        setSearchError('No matching places found. Try a city, district, or landmark name.');
      }
    } catch (err: any) {
      setSearchError(err?.message || 'Unable to search location.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectSearchResult = (item: GeocodeResult) => {
    const shortLabel = item.displayName.split(',').slice(0, 2).join(', ');
    const next: SiteQuery = {
      ...siteQuery,
      lat: item.lat,
      lng: item.lng,
      label: shortLabel,
      region: item.region,
    };
    setSiteQuery(next);
    setSearchResults([]);
    setSearchInput('');
    runAnalysis(next);
  };

  const handlePinToCompare = () => {
    if (!assessment) return;
    setSavedSites((prev) => {
      if (prev.some((s) => s.id === assessment.id)) return prev;
      return [...prev.slice(-2), assessment];
    });
  };

  const handleSaveToWorkspaceDb = async () => {
    if (!assessment) return;
    if (!authSession?.token) {
      setAuthNotice('Sign in with your verified Supabase or Google account to save dossiers.');
      setShowAuthScreen(true);
      return;
    }

    setIsSavingToDb(true);
    setSaveDbNotice(null);
    try {
      const res = await fetch('/api/assessments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authSession.token}`,
        },
        body: JSON.stringify({
          siteLabel: assessment.telemetry.query.label,
          region: assessment.telemetry.query.region,
          lat: assessment.telemetry.query.lat,
          lng: assessment.telemetry.query.lng,
          projectType: assessment.telemetry.query.projectType,
          areaHectares: assessment.telemetry.query.areaHectares,
          horizonYear: assessment.telemetry.query.horizonYear,
          overallSuitability: assessment.overallSuitability,
          overallVerdict: assessment.overallVerdict,
          netAvoidedInrCr: assessment.costProjection.net25YrAvoidedCostInrCr,
          telemetryJson: JSON.stringify(assessment.telemetry),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save to Cloud SQL.');
      if (data.assessment) {
        setCloudSavedSites((prev) => [data.assessment, ...prev]);
        setSaveDbNotice('Saved to workspace database.');
      }
    } catch (err: any) {
      setSaveDbNotice(err?.message || 'Unable to save assessment.');
    } finally {
      setIsSavingToDb(false);
    }
  };

  const handleLoadCloudRecord = (rec: SavedAssessmentRecord) => {
    try {
      const parsedTelemetry = JSON.parse(rec.telemetryJson) as EnvironmentalTelemetry;
      const evaluated = evaluateSiteTelemetry(parsedTelemetry);
      setSiteQuery(parsedTelemetry.query);
      setAssessment(evaluated);
      setActiveTab('analyzer');
      fetchAiBrief(evaluated);
    } catch {
      const q: SiteQuery = {
        lat: rec.lat,
        lng: rec.lng,
        label: rec.siteLabel,
        region: rec.region,
        projectType: rec.projectType,
        areaHectares: rec.areaHectares,
        horizonYear: rec.horizonYear,
      };
      setSiteQuery(q);
      runAnalysis(q);
    }
  };

  const handleDeleteCloudRecord = async (id: number) => {
    if (!authSession?.token) return;
    try {
      const res = await fetch(`/api/assessments/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authSession.token}` },
      });
      if (res.ok) {
        setCloudSavedSites((prev) => prev.filter((item) => item.id !== id));
      }
    } catch {
      // ignore transient error
    }
  };

  const handleRunAllCorridors = async () => {
    setIsBenchmarkingAll(true);
    try {
      const results = await Promise.all(
        BENCHMARK_CORRIDORS.map(async (c) => {
          const q: SiteQuery = {
            lat: c.lat,
            lng: c.lng,
            label: c.name,
            region: c.city,
            projectType: c.defaultProjectType,
            areaHectares: c.defaultAreaHectares,
            horizonYear: siteQuery.horizonYear,
          };
          const res = await fetch('/api/analyze-site', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(q),
          });
          const telemetry = await res.json();
          if (!res.ok) throw new Error(telemetry.error || 'Benchmark failed');
          return evaluateSiteTelemetry(telemetry);
        })
      );
      setSavedSites(results);
    } catch (err: any) {
      setAnalysisError(err?.message || 'Failed to benchmark all corridors.');
    } finally {
      setIsBenchmarkingAll(false);
    }
  };

  const handleSignOut = async () => {
    if (authSession?.provider === 'supabase') {
      await signOutSupabase();
    } else if (authSession?.provider === 'firebase') {
      await signOutFirebase();
    }
    setAuthSession(null);
    setShowAuthScreen(true);
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0b0d11] text-slate-100 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-brand-400 mr-2" />
        <span className="text-xs font-mono font-bold uppercase tracking-wider">
          Initializing TerraSight
        </span>
      </div>
    );
  }

  if (showAuthScreen) {
    return (
      <AuthGate
        initialNotice={authNotice}
        onAuthenticated={() => {
          setAuthNotice(null);
          setShowAuthScreen(false);
        }}
        onContinuePreview={() => {
          setAuthNotice(null);
          setShowAuthScreen(false);
        }}
      />
    );
  }

  const isCurrentPinned = assessment ? savedSites.some((s) => s.id === assessment.id) : false;

  const heatDays = assessment?.telemetry.climate.futureExtremeHeatDaysPerYr ?? 0;
  const aqiVal = assessment?.telemetry.airQuality.usAqi ?? 0;
  const floodRatio = assessment?.telemetry.flood.peakToMeanRatio ?? 1;
  const roiVal = assessment?.costProjection.roiMultiple ?? 1;
  const elevProfile = (assessment?.telemetry.elevation.grid ?? []).slice(0, 12);
  const elevMin = elevProfile.length ? Math.min(...elevProfile.map((p) => p.elevation)) : 0;
  const elevMax = elevProfile.length ? Math.max(...elevProfile.map((p) => p.elevation)) : 1;
  const elevRange = Math.max(1, elevMax - elevMin);

  return (
    <div className="min-h-screen flex flex-col bg-[#0b0d11] text-slate-100">
      {/* Top Geospatial Command Bar */}
      <header className="sticky top-0 z-30 bg-[#0e1116]/95 backdrop-blur-md text-slate-100 border-b border-[#232936] px-4 sm:px-6 h-14 flex items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('analyzer');
            }}
            className="flex items-center gap-2 text-base font-display font-extrabold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <span className="inline-block w-2.5 h-2.5 bg-brand-400 rounded-xs" />
            <span>TERRASIGHT</span>
          </a>
          <span className="hidden xl:inline text-xs italic font-medium text-slate-400 border-l border-[#232936] pl-3 whitespace-nowrap">
            “Analyse the future before building one”
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          {(
            [
              { id: 'analyzer', label: 'Site Analyzer' },
              {
                id: 'compare',
                label: savedSites.length > 0 ? `Compare Sites (${savedSites.length})` : 'Compare Sites',
              },
              { id: 'advisor', label: 'Planning Advisor' },
            ] as Array<{ id: ActiveTab; label: string }>
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`h-14 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.id
                  ? 'border-brand-400 text-brand-400 font-bold'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <PWAInstallButton />
          {authSession ? (
            <div className="flex items-center gap-2">
              <span className="hidden lg:inline text-xs font-mono text-slate-400 truncate max-w-[150px]">
                {authSession.email}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                title="Sign out"
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:text-white border border-[#2a3140] bg-[#181c24] hover:border-brand-500/60 rounded-md inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5 text-brand-400" />
                <span className="hidden sm:inline">Sign Out</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAuthScreen(true)}
              className="px-3 py-1.5 text-xs font-semibold text-slate-200 hover:text-white border border-[#2a3140] bg-[#181c24] hover:border-brand-500/60 rounded-md transition-colors whitespace-nowrap shrink-0"
            >
              Sign In
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setActiveTab('analyzer');
              setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            className="px-3.5 py-1.5 text-xs font-bold text-slate-950 bg-brand-500 hover:bg-brand-300 rounded-md transition-colors whitespace-nowrap shrink-0"
          >
            New Assessment
          </button>
        </div>
      </header>

      {/* Quote Strip on Medium / Mobile viewports where xl header quote hides */}
      <div className="xl:hidden bg-[#0e1116] border-b border-[#232936] px-4 py-1.5 text-center text-xs font-medium italic text-slate-400 print:hidden">
        “Analyse the future before building one”
      </div>

      {/* Tier 1 Google Maps Platform Quota / Auth Warning Banner */}
      {mapsQuotaWarning && (
        <div className="bg-amber-950/60 border-b border-amber-500/40 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs text-amber-200 print:hidden">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{mapsQuotaWarning}</span>
          </div>
          <button
            type="button"
            onClick={() => setMapsQuotaWarning(null)}
            className="p-1 text-amber-300 hover:text-white"
            aria-label="Dismiss Maps warning"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Mobile Tab Bar */}
      <div className="md:hidden flex items-center gap-1 px-4 py-2 bg-[#0e1116] border-b border-[#232936] overflow-x-auto print:hidden">
        {(
          [
            { id: 'analyzer', label: 'Analyzer' },
            { id: 'compare', label: `Compare (${savedSites.length})` },
            { id: 'advisor', label: 'Advisor' },
          ] as Array<{ id: ActiveTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-bold rounded-md whitespace-nowrap shrink-0 ${
              activeTab === tab.id ? 'bg-brand-500 text-slate-950' : 'text-slate-400 hover:bg-[#1a1f29] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <main className="flex-1">
        {activeTab === 'analyzer' && (
          <div className="max-w-[1460px] mx-auto px-4 sm:px-6 py-5 flex flex-col lg:flex-row gap-5 items-start">
            {/* Left Control & Benchmark Rail */}
            <aside className="w-full lg:w-[300px] shrink-0 space-y-4">
              {/* Location Search */}
              <section className="bg-[#141820] border border-[#232936] rounded-lg p-3.5 space-y-3">
                <div>
                  <h2 className="text-xs font-display font-bold uppercase tracking-wider text-white">
                    Location Search
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Search any city, corridor, or click the Google satellite map
                  </p>
                </div>

                <form onSubmit={handleSearchSubmit} className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="e.g., Noida, Pune, Surat..."
                      className="w-full pl-8 pr-2.5 py-2 text-xs text-slate-100 bg-[#0e1116] border border-[#2a3140] rounded-md placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSearching}
                    className="px-3 py-2 text-xs font-bold bg-[#1a1f29] border border-[#2a3140] text-brand-400 rounded-md hover:bg-brand-500 hover:text-slate-950 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                  >
                    {isSearching ? '...' : 'Find'}
                  </button>
                </form>

                {searchError && <p className="text-xs text-amber-400">{searchError}</p>}

                {searchResults.length > 0 && (
                  <div className="border border-[#2a3140] rounded-md divide-y divide-[#232936] max-h-48 overflow-y-auto bg-[#0e1116]">
                    {searchResults.map((res, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => handleSelectSearchResult(res)}
                        className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-[#1a1f29] transition-colors"
                      >
                        <div className="font-semibold text-white truncate">
                          {res.displayName}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 tabular-nums">
                          {res.lat.toFixed(4)}, {res.lng.toFixed(4)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* Indian Urban Corridor Benchmarks */}
              <section className="bg-[#141820] border border-[#232936] rounded-lg p-3.5 space-y-3">
                <div>
                  <h2 className="text-xs font-display font-bold uppercase tracking-wider text-white">
                    Indian Urban Corridors
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Select a benchmark growth zone to inspect
                  </p>
                </div>

                <div className="space-y-2">
                  {BENCHMARK_CORRIDORS.map((corridor) => {
                    const isSelected =
                      Math.abs(siteQuery.lat - corridor.lat) < 0.005 &&
                      Math.abs(siteQuery.lng - corridor.lng) < 0.005;
                    return (
                      <button
                        key={corridor.id}
                        type="button"
                        onClick={() => handleSelectBenchmark(corridor)}
                        className={`w-full text-left rounded-md border overflow-hidden transition-colors ${
                          isSelected
                            ? 'border-brand-500/70 bg-brand-500/10'
                            : 'border-[#232936] bg-[#0e1116] hover:border-[#3b4459]'
                        }`}
                      >
                        <div className="flex gap-3 p-2 items-center">
                          <img
                            src={corridor.previewImage}
                            alt={corridor.city}
                            referrerPolicy="no-referrer"
                            className="w-14 h-11 rounded-sm object-cover shrink-0 bg-[#141820]"
                          />
                          <div className="min-w-0 flex-1">
                            <div className={`text-xs font-bold truncate ${isSelected ? 'text-brand-300' : 'text-white'}`}>
                              {corridor.city}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate">
                              {corridor.corridor}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Proposed Project Parameters */}
              <section className="bg-[#141820] border border-[#232936] rounded-lg p-3.5 space-y-4">
                <h2 className="text-xs font-display font-bold uppercase tracking-wider text-white">
                  Proposed Development
                </h2>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                    Project Typology
                  </label>
                  <div className="space-y-1.5">
                    {(Object.keys(PROJECT_LABELS) as ProjectType[]).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        onClick={() => handleProjectConfigChange({ projectType: pt })}
                        className={`w-full text-left px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
                          siteQuery.projectType === pt
                            ? 'border-brand-500/70 bg-brand-500/10 text-brand-300'
                            : 'border-[#232936] bg-[#0e1116] text-slate-300 hover:border-[#3b4459] hover:text-white'
                        }`}
                      >
                        {PROJECT_LABELS[pt]}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <label htmlFor="area-slider" className="font-semibold text-slate-400">
                      Site Footprint
                    </label>
                    <span className="font-mono tabular-nums font-bold text-brand-400">
                      {siteQuery.areaHectares} ha
                    </span>
                  </div>
                  <input
                    id="area-slider"
                    type="range"
                    min={10}
                    max={150}
                    step={5}
                    value={siteQuery.areaHectares}
                    onChange={(e) =>
                      handleProjectConfigChange({ areaHectares: Number(e.target.value) })
                    }
                    className="w-full accent-brand-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                    Climate Horizon
                  </label>
                  <div className="flex items-center gap-1 p-1 bg-[#0e1116] border border-[#232936] rounded-md">
                    {([2035, 2050] as HorizonYear[]).map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => handleProjectConfigChange({ horizonYear: yr })}
                        className={`flex-1 py-1.5 text-xs font-mono font-bold rounded-sm transition-colors ${
                          siteQuery.horizonYear === yr
                            ? 'bg-brand-500 text-slate-950'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {yr}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => runAnalysis(siteQuery)}
                  disabled={isAnalyzing}
                  className="w-full py-2.5 px-4 bg-brand-500 hover:bg-brand-300 disabled:opacity-60 text-slate-950 text-xs font-bold rounded-md transition-colors flex items-center justify-center gap-2"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Querying Public Datasets...
                    </>
                  ) : (
                    'Refresh Site Telemetry'
                  )}
                </button>
              </section>

              {/* Offline Field Cache (Workbox CacheStorage) */}
              {cachedSites.length > 0 && (
                <section className="bg-[#141820] border border-[#232936] rounded-lg p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-display font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-brand-400" />
                      Offline Field Cache
                    </h2>
                    <span className="text-[11px] font-mono font-semibold text-brand-400">
                      {cachedSites.length} ready
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Recent telemetry cached by Workbox for low-signal field visits.
                  </p>
                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {cachedSites.slice(0, 8).map((item: CachedFieldSiteSummary) => (
                      <button
                        key={item.cacheUrl}
                        type="button"
                        onClick={() => {
                          const next: SiteQuery = {
                            lat: item.lat,
                            lng: item.lng,
                            label: item.label,
                            region: item.region,
                            projectType: item.projectType,
                            areaHectares: item.areaHectares,
                            horizonYear: item.horizonYear,
                          };
                          setSiteQuery(next);
                          runAnalysis(next);
                        }}
                        className="w-full text-left px-2.5 py-2 bg-[#0e1116] hover:bg-[#1a1f29] border border-[#232936] hover:border-brand-500/60 rounded-md transition-colors"
                      >
                        <div className="text-xs font-bold text-white truncate">
                          {item.label}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">
                          {item.region} · {item.horizonYear} · {item.lat.toFixed(2)}, {item.lng.toFixed(2)}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Saved Workspace Assessments (Cloud SQL) */}
              {authSession && (
                <section className="bg-[#141820] border border-[#232936] rounded-lg p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-display font-bold uppercase tracking-wider text-white flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-brand-400" />
                      Saved Dossiers
                    </h2>
                    <span className="text-[11px] font-mono text-slate-400">
                      {cloudSavedSites.length}
                    </span>
                  </div>

                  {cloudSavedSites.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      Save an evaluated site to persist its telemetry in your workspace.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {cloudSavedSites.map((rec) => (
                        <div
                          key={rec.id}
                          className="p-2.5 bg-[#0e1116] border border-[#232936] rounded-md flex items-start justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => handleLoadCloudRecord(rec)}
                            className="text-left min-w-0 flex-1"
                          >
                            <div className="text-xs font-semibold text-white truncate hover:text-brand-400">
                              {rec.siteLabel}
                            </div>
                            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                              {rec.overallSuitability}/100 · {rec.horizonYear} · ₹
                              {rec.netAvoidedInrCr.toFixed(1)} Cr
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCloudRecord(rec.id)}
                            aria-label={`Delete ${rec.siteLabel}`}
                            className="p-1 text-slate-500 hover:text-rose-400 shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </aside>

            {/* Primary Geospatial & Evaluation Stage */}
            <div className="flex-1 min-w-0 space-y-5">
              {/* Active Site Header & Workspace Toolbar */}
              <div className="bg-[#141820] border border-[#232936] rounded-lg p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="inline-flex items-center gap-1 font-bold text-brand-400">
                      <MapPin className="w-3.5 h-3.5 text-brand-400" />
                      {siteQuery.region}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-slate-300">
                      {PROJECT_LABELS[siteQuery.projectType]}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{siteQuery.areaHectares} ha</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">Horizon {siteQuery.horizonYear}</span>
                    {(cachedTelemetryAt || !isOnline) && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold bg-brand-500/15 text-brand-300 border border-brand-500/40 rounded">
                          Cached Telemetry
                          {cachedTelemetryAt
                            ? ` (${new Date(cachedTelemetryAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })})`
                            : ''}
                        </span>
                      </>
                    )}
                  </div>
                  <h1 className="text-xl sm:text-2xl font-display font-extrabold text-white tracking-tight mt-1 truncate">
                    {siteQuery.label}
                  </h1>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {assessment && (
                    <div className="pr-3 mr-1 border-r border-[#232936] text-right">
                      <div className="text-[11px] text-slate-400">Suitability</div>
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-mono tabular-nums font-extrabold text-white">
                          {assessment.overallSuitability}/100
                        </span>
                        <VerdictBadge level={assessment.overallVerdict} />
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleSaveToWorkspaceDb}
                    disabled={!assessment || isSavingToDb}
                    className="px-3 py-2 text-xs font-semibold border border-[#2a3140] bg-[#181c24] hover:border-brand-500/60 disabled:opacity-60 text-slate-200 hover:text-white rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    {isSavingToDb ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                    ) : (
                      <BookmarkCheck className="w-3.5 h-3.5 text-brand-400" />
                    )}
                    {authSession ? 'Save Dossier' : 'Sign In to Save'}
                  </button>

                  <button
                    type="button"
                    onClick={handlePinToCompare}
                    disabled={!assessment || isCurrentPinned}
                    className="px-3 py-2 text-xs font-semibold border border-[#2a3140] bg-[#181c24] hover:border-sky-400/60 disabled:opacity-60 text-slate-200 hover:text-white rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5 text-sky-400" />
                    {isCurrentPinned ? 'Pinned' : 'Pin to Compare'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setDrawerOpen((v) => !v)}
                    className={`px-3 py-2 text-xs font-semibold border rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                      drawerOpen
                        ? 'border-brand-500/70 bg-brand-500/15 text-brand-300'
                        : 'border-[#2a3140] bg-[#181c24] hover:border-brand-500/60 text-slate-200 hover:text-white'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-brand-400" />
                    Advisor Chat
                  </button>
                </div>
              </div>

              {saveDbNotice && (
                <div className="px-3.5 py-2 bg-brand-950/40 border border-brand-500/40 rounded-md text-xs text-brand-200 flex items-center justify-between">
                  <span>{saveDbNotice}</span>
                  <button
                    type="button"
                    onClick={() => setSaveDbNotice(null)}
                    className="text-brand-300 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {analysisError && (
                <div className="p-4 bg-amber-950/40 border border-amber-500/40 rounded-lg text-xs text-amber-200 flex items-center justify-between gap-3">
                  <span>{analysisError}</span>
                  <button
                    type="button"
                    onClick={() => runAnalysis(siteQuery)}
                    className="px-3 py-1.5 bg-brand-500 text-slate-950 font-bold rounded-md"
                  >
                    Retry
                  </button>
                </div>
              )}

              {/* Compact Top Telemetry Ring Strip (Live Computed Site KPIs) */}
              {assessment && (
                <section className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
                  <div className="bg-[#141820] border border-[#232936] rounded-lg p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        Site Score
                      </div>
                      <div className="text-2xl font-mono tabular-nums font-extrabold text-white mt-0.5">
                        {assessment.overallSuitability}
                        <span className="text-xs text-slate-500 font-normal">/100</span>
                      </div>
                      <div className="mt-1">
                        <VerdictBadge level={assessment.overallVerdict} />
                      </div>
                    </div>
                    <TelemetryRing
                      ratio={assessment.overallSuitability / 100}
                      color={
                        assessment.overallSuitability >= 75
                          ? '#5C99EE'
                          : assessment.overallSuitability >= 55
                            ? '#38bdf8'
                            : '#f97316'
                      }
                      label={`${assessment.overallSuitability}%`}
                      sublabel={String(siteQuery.horizonYear)}
                    />
                  </div>

                  <div className="bg-[#141820] border border-[#232936] rounded-lg p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        Warming Delta
                      </div>
                      <div className="text-xl font-mono tabular-nums font-extrabold text-orange-400 mt-0.5">
                        {assessment.telemetry.climate.tempDeltaC !== null
                          ? `+${assessment.telemetry.climate.tempDeltaC.toFixed(2)}°C`
                          : '--'}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1 truncate">
                        {heatDays} days ≥40°C/yr
                      </div>
                    </div>
                    <TelemetryRing
                      ratio={Math.min(1, heatDays / 120)}
                      color={heatDays >= 55 ? '#ef4444' : heatDays >= 25 ? '#f97316' : '#5C99EE'}
                      label={`${heatDays}d`}
                      sublabel="≥40°C"
                    />
                  </div>

                  <div className="bg-[#141820] border border-[#232936] rounded-lg p-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        CAMS Air Quality
                      </div>
                      <div className="text-xl font-mono tabular-nums font-extrabold text-white mt-0.5">
                        {aqiVal || '--'} <span className="text-xs font-normal text-slate-400">AQI</span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1 truncate">
                        PM2.5 {assessment.telemetry.airQuality.pm25?.toFixed(1) ?? '--'} µg/m³
                      </div>
                    </div>
                    <TelemetryRing
                      ratio={Math.min(1, aqiVal / 250)}
                      color={aqiVal >= 150 ? '#ef4444' : aqiVal >= 90 ? '#eab308' : '#5C99EE'}
                      label={`${aqiVal || '--'}`}
                      sublabel="US AQI"
                    />
                  </div>

                  <div className="bg-[#141820] border border-[#232936] rounded-lg p-3.5 flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                        DEM &amp; Flood
                      </span>
                      <span className="text-xs font-mono tabular-nums font-bold text-sky-400">
                        {floodRatio.toFixed(2)}× peak
                      </span>
                    </div>
                    <div className="flex items-end gap-1 h-7 mt-1.5" aria-hidden="true">
                      {elevProfile.length > 0 ? (
                        elevProfile.map((pt, i) => {
                          const pct = Math.max(18, Math.round(((pt.elevation - elevMin) / elevRange) * 100));
                          return (
                            <div
                              key={i}
                              className="flex-1 rounded-xs bg-sky-400/70"
                              style={{ height: `${pct}%` }}
                            />
                          );
                        })
                      ) : (
                        <div className="w-full h-1.5 bg-[#232936] rounded" />
                      )}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1 truncate">
                      {assessment.telemetry.elevation.centerMeters?.toFixed(0) ?? '--'}m elev ·{' '}
                      {assessment.telemetry.elevation.reliefMeters?.toFixed(1) ?? '--'}m relief
                    </div>
                  </div>

                  <div className="bg-[#141820] border border-brand-500/35 rounded-lg p-3.5 flex items-center justify-between gap-3 col-span-2 sm:col-span-1">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-brand-400">
                        25-Yr Net Saved
                      </div>
                      <div className="text-xl font-mono tabular-nums font-extrabold text-brand-400 mt-0.5">
                        ₹{assessment.costProjection.net25YrAvoidedCostInrCr.toFixed(0)} Cr
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1 truncate">
                        Solar {assessment.telemetry.nasaPower.solarIrradianceKwhM2Day?.toFixed(1) ?? '--'} kWh/m²
                      </div>
                    </div>
                    <TelemetryRing
                      ratio={Math.min(1, roiVal / 6)}
                      color="#5C99EE"
                      label={`${roiVal.toFixed(1)}×`}
                      sublabel="ROI"
                    />
                  </div>
                </section>
              )}

              {/* Google Maps Platform Satellite Viewport */}
              <SatelliteMap
                lat={siteQuery.lat}
                lng={siteQuery.lng}
                label={siteQuery.label}
                layerMode={layerMode}
                showElevationGrid={showElevationGrid}
                showLandUseBuffer={showLandUseBuffer}
                elevationGrid={assessment?.telemetry.elevation.grid ?? []}
                landUseSamples={assessment?.telemetry.landUse2Km.sampleFeatures ?? []}
                onSelectCoordinates={handleMapClick}
                onLayerChange={setLayerMode}
                onToggleElevationGrid={() => setShowElevationGrid((v) => !v)}
                onToggleLandUseBuffer={() => setShowLandUseBuffer((v) => !v)}
              />

              {/* Public Data Source Verification Line */}
              {assessment && (
                <div className="bg-[#141820]/80 border border-[#232936] rounded-lg flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-400 px-4 py-2.5">
                  <span className="font-bold text-slate-200">Verified Public Feeds:</span>
                  {assessment.telemetry.sources.map((src) => (
                    <span key={src.name} className="inline-flex items-center gap-1">
                      {src.ok ? (
                        <CheckCircle2 className="w-3 h-3 text-brand-400 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                      )}
                      <span className="text-slate-200 font-medium">{src.name}</span>
                      <span className="text-slate-500 font-mono text-[11px]">({src.detail})</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Five-Pillar Site Intelligence Grid */}
              {isAnalyzing && !assessment ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <div
                      key={n}
                      className="h-44 bg-[#141820] border border-[#232936] rounded-lg p-4 animate-pulse"
                    />
                  ))}
                </div>
              ) : (
                assessment && (
                  <>
                    <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                      {assessment.pillars.map((pillar) => (
                        <div
                          key={pillar.id}
                          className="bg-[#141820] border border-[#232936] rounded-lg p-4 flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="text-xs font-display font-bold text-white inline-flex items-center gap-1">
                                <span>{pillar.title}</span>
                                {PILLAR_HELP[pillar.id] && (
                                  <MetricHelpTooltip
                                    title={pillar.title}
                                    explanation={PILLAR_HELP[pillar.id].explanation}
                                    budgetImpact={PILLAR_HELP[pillar.id].budgetImpact}
                                  />
                                )}
                              </h3>
                              <VerdictBadge level={pillar.riskLevel} />
                            </div>
                            <div className="mt-3 flex items-baseline gap-1.5">
                              <span className="text-2xl font-mono tabular-nums font-extrabold text-white">
                                {pillar.headlineMetric}
                              </span>
                              <span className="text-xs font-mono text-slate-400">
                                {pillar.headlineUnit}
                              </span>
                            </div>
                            <div className="text-xs font-mono tabular-nums text-slate-400 mt-1">
                              {pillar.subMetric}
                            </div>
                          </div>

                          <ul className="mt-4 pt-3 border-t border-[#232936] space-y-1.5 text-[11px] text-slate-300 leading-relaxed">
                            {pillar.findings.map((f, i) => (
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </section>

                    {/* Climate Trajectory & Radar Visualization */}
                    <ClimateCharts
                      monthlySeries={assessment.telemetry.climate.monthlySeries}
                      horizonYear={assessment.telemetry.query.horizonYear}
                      pillars={assessment.pillars}
                    />

                    {/* 25-Year Preventive Cost Avoidance Breakdown */}
                    <section className="bg-[#141820] border border-[#232936] rounded-lg p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                        <div>
                          <h2 className="text-base font-display font-extrabold text-white">
                            25-Year Lifecycle Cost &amp; Preventive Savings Model
                          </h2>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Engineering cost multipliers anchored to live CMIP6 warming, GloFAS hydrology, CAMS PM2.5, and terrain relief.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums">
                          <div>
                            <span className="text-slate-400 block text-[11px] font-sans">
                              Baseline CapEx
                            </span>
                            <span className="font-bold text-white">
                              ₹{assessment.costProjection.baselineCapexInrCr.toFixed(1)} Cr
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px] font-sans">
                              Unmitigated Penalty
                            </span>
                            <span className="font-bold text-rose-400">
                              ₹{assessment.costProjection.unmitigated25YrPenaltyInrCr.toFixed(1)} Cr
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px] font-sans">
                              Preventive Upfront
                            </span>
                            <span className="font-bold text-sky-300">
                              ₹{assessment.costProjection.preventiveGreenCapexInrCr.toFixed(1)} Cr
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block text-[11px] font-sans">
                              Net 25-Yr Avoided Cost
                            </span>
                            <span className="font-extrabold text-brand-400">
                              ₹{assessment.costProjection.net25YrAvoidedCostInrCr.toFixed(1)} Cr (
                              {assessment.costProjection.roiMultiple.toFixed(1)}× ROI)
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="overflow-x-auto border border-[#232936] rounded-md">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-[#0e1116] text-slate-300 border-b border-[#232936]">
                              <th className="py-2.5 px-3.5 font-bold">Cost Driver</th>
                              <th className="py-2.5 px-3.5 font-bold">Empirical Telemetry Basis</th>
                              <th className="py-2.5 px-3.5 font-bold text-right">
                                Unmitigated (₹ Cr)
                              </th>
                              <th className="py-2.5 px-3.5 font-bold text-right">
                                With Early Design (₹ Cr)
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#232936]">
                            {assessment.costProjection.assumptions.map((row) => (
                              <tr key={row.driver} className="hover:bg-[#1a1f29]/60">
                                <td className="py-2.5 px-3.5 font-semibold text-white">
                                  {row.driver}
                                </td>
                                <td className="py-2.5 px-3.5 text-slate-400">{row.formulaNote}</td>
                                <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-rose-400 font-semibold">
                                  ₹{row.unmitigatedInrCr.toFixed(1)}
                                </td>
                                <td className="py-2.5 px-3.5 text-right font-mono tabular-nums text-brand-400 font-bold">
                                  ₹{row.mitigatedInrCr.toFixed(1)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    {/* AI Preventive Synthesis, Alternative Siting & Final Use-Case Verdict */}
                    <section className="bg-[#141820] border border-[#232936] rounded-lg p-5 space-y-5">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#232936] pb-4">
                        <div>
                          <h2 className="text-base font-display font-extrabold text-white">
                            Preventive Planning Brief, Alternative Siting &amp; Final AI Verdict
                          </h2>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Synthesized strictly from measured satellite and environmental telemetry via Gemini 4 Hydrogen
                          </p>
                        </div>
                        {isGeneratingBrief && (
                          <span className="inline-flex items-center gap-1.5 text-xs text-brand-400 font-semibold">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" /> Synthesizing field brief...
                          </span>
                        )}
                      </div>

                      {briefError && (
                        <div className="p-3 bg-amber-950/40 border border-amber-500/40 rounded-md text-xs text-amber-200 flex items-center justify-between gap-2">
                          <span>{briefError}</span>
                          <button
                            type="button"
                            onClick={() => fetchAiBrief(assessment)}
                            className="px-2.5 py-1 bg-brand-500 text-slate-950 rounded text-xs font-bold shrink-0"
                          >
                            Retry Brief
                          </button>
                        </div>
                      )}

                      {aiBrief && (
                        <div className="space-y-6">
                          {(() => {
                            const fallbackDecision =
                              assessment.overallVerdict === 'Critical'
                                ? 'RELOCATION RECOMMENDED'
                                : assessment.overallVerdict === 'Elevated'
                                  ? 'CONDITIONAL HOLD'
                                  : assessment.overallVerdict === 'Moderate'
                                    ? 'PROCEED WITH MITIGATIONS'
                                    : 'PROCEED';
                            const decision = (
                              aiBrief.finalVerdict?.decision || fallbackDecision
                            ).toUpperCase();
                            const confidence = aiBrief.finalVerdict?.confidenceLevel || 'High';
                            const fitSummary =
                              aiBrief.finalVerdict?.useCaseFitSummary || aiBrief.executiveSummary;
                            const actionText =
                              aiBrief.finalVerdict?.recommendedAction ||
                              'Apply the preventive engineering controls below before finalizing civil design.';

                            const isRelocate = decision.includes('RELOCAT');
                            const isHold = decision.includes('HOLD');
                            const isMitigate = decision.includes('MITIGAT');

                            const badgeClasses = isRelocate
                              ? 'border-rose-500/50 bg-rose-500/15 text-rose-300'
                              : isHold
                                ? 'border-amber-500/50 bg-amber-500/15 text-amber-300'
                                : isMitigate
                                  ? 'border-sky-500/50 bg-sky-500/15 text-sky-300'
                                  : 'border-brand-500/50 bg-brand-500/15 text-brand-300';

                            const cardBorder = isRelocate
                              ? 'border-rose-500/35'
                              : isHold
                                ? 'border-amber-500/35'
                                : 'border-brand-500/35';

                            return (
                              <div className={`p-4 bg-[#0e1116] border ${cardBorder} rounded-lg space-y-3`}>
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-brand-400 shrink-0" />
                                    <div>
                                      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                                        Final AI Verdict Upon Use Case
                                      </div>
                                      <div className="text-xs font-semibold text-white mt-0.5">
                                        {PROJECT_LABELS[siteQuery.projectType]} ·{' '}
                                        <span className="font-mono text-slate-300">
                                          {siteQuery.areaHectares} ha
                                        </span>{' '}
                                        ·{' '}
                                        <span className="font-mono text-slate-300">
                                          Horizon {siteQuery.horizonYear}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2.5">
                                    <span className="text-[11px] font-mono text-slate-400">
                                      Confidence:{' '}
                                      <span className="font-bold text-slate-200">{confidence}</span>
                                    </span>
                                    <span
                                      className={`px-2.5 py-1 text-[11px] font-mono font-extrabold tracking-wide rounded border ${badgeClasses}`}
                                    >
                                      {decision}
                                    </span>
                                  </div>
                                </div>

                                <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                                  {fitSummary}
                                </p>

                                <div className="pt-2.5 border-t border-[#232936] flex flex-col sm:flex-row sm:items-start gap-1.5 text-xs">
                                  <span className="font-mono font-bold uppercase tracking-wider text-brand-400 shrink-0">
                                    Recommended Action:
                                  </span>
                                  <span className="text-slate-300">{actionText}</span>
                                </div>
                              </div>
                            );
                          })()}

                          <p className="text-sm text-slate-200 leading-relaxed max-w-4xl">
                            {aiBrief.executiveSummary}
                          </p>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Hazards */}
                            <div className="space-y-3">
                              <h3 className="text-xs font-display font-bold uppercase tracking-wider text-slate-300">
                                Identified Future Constraints
                              </h3>
                              <div className="space-y-2.5">
                                {aiBrief.keyHazards.map((h, i) => (
                                  <div
                                    key={i}
                                    className="p-3.5 bg-[#0e1116] border border-[#232936] rounded-md space-y-1"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-bold text-white">
                                        {h.title}
                                      </span>
                                      <span className="text-[11px] font-mono font-bold text-amber-400">
                                        {h.severity}
                                      </span>
                                    </div>
                                    <p className="text-xs text-slate-400">{h.evidence}</p>
                                    <p className="text-xs text-slate-200 font-medium">
                                      {h.consequence}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* Preventive Mitigations */}
                            <div className="space-y-3">
                              <h3 className="text-xs font-display font-bold uppercase tracking-wider text-slate-300">
                                Preventive Pre-Construction Modifications
                              </h3>
                              <div className="space-y-2.5">
                                {aiBrief.mitigationStrategies.map((m, i) => (
                                  <div
                                    key={i}
                                    className="p-3.5 bg-[#0e1116] border border-[#232936] rounded-md space-y-1"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs font-bold text-white">
                                        {m.title}
                                      </span>
                                      <span className="text-[11px] font-mono font-bold text-brand-400">
                                        {m.costCategory}
                                      </span>
                                    </div>
                                    <p className="text-xs text-brand-300 font-semibold">{m.impact}</p>
                                    <p className="text-xs text-slate-400">{m.description}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* Alternative Siting Recommendations */}
                          {aiBrief.alternativeCorridors?.length > 0 && (
                            <div className="pt-4 border-t border-[#232936] space-y-3">
                              <h3 className="text-xs font-display font-bold uppercase tracking-wider text-slate-300">
                                Alternative Relocation Candidates (Click to Evaluate Live)
                              </h3>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {aiBrief.alternativeCorridors.map((alt, i) => {
                                  const targetLat = +(
                                    siteQuery.lat +
                                    Math.max(-0.2, Math.min(0.2, Number(alt.latOffset) || 0.06))
                                  ).toFixed(4);
                                  const targetLng = +(
                                    siteQuery.lng +
                                    Math.max(-0.2, Math.min(0.2, Number(alt.lngOffset) || 0.06))
                                  ).toFixed(4);
                                  return (
                                    <button
                                      key={i}
                                      type="button"
                                      onClick={() => handleMapClick(targetLat, targetLng)}
                                      className="text-left p-3.5 bg-[#0e1116] border border-[#232936] hover:border-brand-500/60 hover:bg-brand-500/10 rounded-md transition-colors flex items-start justify-between gap-3"
                                    >
                                      <div>
                                        <div className="text-xs font-bold text-white flex items-center gap-1.5">
                                          <Compass className="w-3.5 h-3.5 text-brand-400" />
                                          {alt.name}
                                        </div>
                                        <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                                          {alt.directionAndDistance} · {targetLat}°, {targetLng}°
                                        </div>
                                        <p className="text-xs text-slate-300 mt-1.5">
                                          {alt.rationale}
                                        </p>
                                      </div>
                                      <ArrowUpRight className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </section>

                    {/* Nearby Infrastructure & Landmarks */}
                    <section className="bg-[#141820] border border-[#232936] rounded-lg p-5">
                      <div className="flex items-center justify-between gap-2 border-b border-[#232936] pb-3">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-brand-400 shrink-0" />
                          <div>
                            <h3 className="text-xs font-display font-bold text-white">
                              Nearby Infrastructure &amp; Landmarks
                            </h3>
                            <p className="text-[11px] text-slate-400">
                              Surrounding civic, transit &amp; utility proximity index
                            </p>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-bold bg-brand-500/10 text-brand-300 border border-brand-500/35 rounded">
                          <Clock className="w-3 h-3 text-brand-400" />
                          Feature coming soon
                        </span>
                      </div>
                      <div className="py-6 flex flex-col items-center justify-center text-center space-y-1.5">
                        <p className="text-sm font-display font-bold text-white">
                          Feature coming soon
                        </p>
                        <p className="text-xs text-slate-400 max-w-md">
                          Automated proximity indexing for regional hospitals, transit corridors, power substations, and municipal water utilities is scheduled for an upcoming release.
                        </p>
                      </div>
                    </section>
                  </>
                )
              )}
            </div>
          </div>
        )}

        {activeTab === 'compare' && (
          <CompareView
            savedSites={savedSites}
            activeAssessment={assessment}
            isBenchmarkingAll={isBenchmarkingAll}
            onRunAllCorridors={handleRunAllCorridors}
            onSelectSite={(site) => {
              setSiteQuery(site.telemetry.query);
              setAssessment(site);
              setActiveTab('analyzer');
              fetchAiBrief(site);
            }}
            onRemoveSite={(id) => setSavedSites((prev) => prev.filter((s) => s.id !== id))}
            onSitesChange={setSavedSites}
          />
        )}

        {activeTab === 'advisor' && (
          <PlanningAdvisor
            assessment={assessment}
            messages={chatMessages}
            selectedModel={chatModel}
            onModelChange={setChatModel}
            onMessagesChange={setChatMessages}
          />
        )}
      </main>

      {/* Slide-Over Advisor Drawer inside Analyzer / Compare */}
      {drawerOpen && activeTab !== 'advisor' && (
        <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-[#141820] border-l border-[#232936] shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#232936] bg-[#0e1116] text-white">
            <span className="text-xs font-display font-bold">
              Site Intelligence Advisor Drawer
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="p-1 text-slate-400 hover:text-white rounded"
              aria-label="Close advisor drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 min-h-0 p-2 bg-[#0b0d11]">
            <PlanningAdvisor
              assessment={assessment}
              messages={chatMessages}
              selectedModel={chatModel}
              onModelChange={setChatModel}
              onMessagesChange={setChatMessages}
              compact
            />
          </div>
        </div>
      )}

      {/* Offline Connectivity Banner for Field Inspectors */}
      <OfflineIndicator cachedSiteCount={cachedSites.length} />

      {/* Floating Right-Corner 10-Year Future & Live Web AI */}
      <CornerFutureAI siteQuery={siteQuery} assessment={assessment} />

      {/* Clean Minimal Footer */}
      <footer className="border-t border-[#232936] bg-[#0e1116] px-4 sm:px-6 py-4 mt-8 print:hidden">
        <div className="max-w-[1460px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
          <span className="font-semibold text-white">
            TerraSight — <span className="text-brand-400 font-normal italic">“Analyse the future before building one”</span>
          </span>
          <span className="text-slate-500">
            Sources: Google Maps Platform, Open-Meteo CMIP6, Copernicus DEM 90m, CAMS Air, GloFAS, NASA POWER, OpenStreetMap
          </span>
        </div>
      </footer>
    </div>
  );
}
