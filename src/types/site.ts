export type ProjectType =
  | 'residential_township'
  | 'commercial_hub'
  | 'industrial_park'
  | 'medical_centre'
  | 'agricultural_land'
  | 'solar_logistics_hub'
  | 'green_infrastructure';

export type HorizonYear = 2035 | 2050;

export type MapLayerMode = 'satellite' | 'urban' | 'topo';

export type ChatModelId =
  | 'gemini-4-hydrogen'
  | 'gemini-4-neon'
  | 'gemini-4-carbon'
  | 'gemini-3.1-flash-lite';

export type CornerModelId = 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';

export type ImageSizeOption = '1K' | '2K' | '4K';
export type ImageAspectRatio = '16:9' | '4:3' | '1:1';

export interface SiteQuery {
  lat: number;
  lng: number;
  label: string;
  region: string;
  projectType: ProjectType;
  areaHectares: number;
  horizonYear: HorizonYear;
}

export interface BenchmarkCorridor {
  id: string;
  name: string;
  corridor: string;
  city: string;
  lat: number;
  lng: number;
  defaultProjectType: ProjectType;
  defaultAreaHectares: number;
  focusSummary: string;
  previewImage: string;
}

export const BENCHMARK_CORRIDORS: BenchmarkCorridor[] = [
  {
    id: 'new-delhi',
    name: 'New Delhi — Dwarka / Yamuna Fringe',
    corridor: 'Dwarka Sector 24 & Najafgarh Basin',
    city: 'New Delhi',
    lat: 28.5672,
    lng: 77.0436,
    defaultProjectType: 'residential_township',
    defaultAreaHectares: 45,
    focusSummary: 'Severe summer UHI peaks, high PM2.5 particulates, and monsoon drainage pooling.',
    previewImage: '/src/assets/images/corridor_new_delhi_1795286793557.jpg',
  },
  {
    id: 'bengaluru',
    name: 'Bengaluru — Bellandur / Whitefield Basin',
    corridor: 'Bellandur Lake Watershed Corridor',
    city: 'Bengaluru',
    lat: 12.9352,
    lng: 77.6744,
    defaultProjectType: 'commercial_hub',
    defaultAreaHectares: 30,
    focusSummary: 'Lake-basin flood encroachment risk, stormwater runoff, and urban tree canopy loss.',
    previewImage: '/src/assets/images/corridor_bengaluru_1795286793744.jpg',
  },
  {
    id: 'ahmedabad',
    name: 'Ahmedabad — Sabarmati / South Fringe',
    corridor: 'Sabarmati Riverfront Expansion Zone',
    city: 'Ahmedabad',
    lat: 22.9878,
    lng: 72.5594,
    defaultProjectType: 'green_infrastructure',
    defaultAreaHectares: 55,
    focusSummary: 'Extreme dry-heat stress above 44°C, arid soil deficit, and high solar potential.',
    previewImage: '/src/assets/images/corridor_ahmedabad_1795286793733.jpg',
  },
];

export interface ElevationGridPoint {
  lat: number;
  lng: number;
  elevation: number;
}

export interface MonthlyClimatePoint {
  month: string;
  historicalMaxC: number;
  futureMaxC: number;
  historicalPrecipMm: number;
  futurePrecipMm: number;
}

export interface SourceStatus {
  name: string;
  ok: boolean;
  detail: string;
}

export interface EnvironmentalTelemetry {
  query: SiteQuery;
  fetchedAt: string;
  sources: SourceStatus[];
  climate: {
    historicalMeanMaxC: number | null;
    futureMeanMaxC: number | null;
    tempDeltaC: number | null;
    historicalExtremeHeatDaysPerYr: number | null;
    futureExtremeHeatDaysPerYr: number | null;
    historicalAnnualPrecipMm: number | null;
    futureAnnualPrecipMm: number | null;
    precipChangePct: number | null;
    monthlySeries: MonthlyClimatePoint[];
    modelUsed: string;
  };
  elevation: {
    centerMeters: number | null;
    minMeters: number | null;
    maxMeters: number | null;
    reliefMeters: number | null;
    estimatedSlopePct: number | null;
    grid: ElevationGridPoint[];
  };
  airQuality: {
    usAqi: number | null;
    europeanAqi: number | null;
    pm25: number | null;
    pm10: number | null;
    no2: number | null;
    ozone: number | null;
    dust: number | null;
    uvIndex: number | null;
    aerosolOpticalDepth: number | null;
  };
  flood: {
    currentDischargeM3s: number | null;
    meanDischargeM3s: number | null;
    max60DayDischargeM3s: number | null;
    peakToMeanRatio: number | null;
  };
  currentConditions: {
    temperatureC: number | null;
    humidityPct: number | null;
    windSpeedKmh: number | null;
    soilMoistureM3m3: number | null;
    soilTempC: number | null;
    evapotranspirationMmDay: number | null;
    shortwaveRadiationMjM2: number | null;
  };
  nasaPower: {
    solarIrradianceKwhM2Day: number | null;
    climatologyTempC: number | null;
    climatologyPrecipMmDay: number | null;
  };
  landUse2Km: {
    greenFeaturesCount: number;
    waterFeaturesCount: number;
    urbanBuiltCount: number;
    industrialCount: number;
    nearestWaterKm: number | null;
    nearestGreenKm: number | null;
    sampleFeatures: Array<{
      name: string;
      kind: 'green' | 'water' | 'urban' | 'industrial';
      lat: number;
      lng: number;
    }>;
  };
}

export type RiskLevel = 'Nominal' | 'Moderate' | 'Elevated' | 'Critical';

export interface PillarEvaluation {
  id: 'climate' | 'environment' | 'geography' | 'sustainability' | 'feasibility';
  title: string;
  riskLevel: RiskLevel;
  score: number;
  headlineMetric: string;
  headlineUnit: string;
  subMetric: string;
  findings: string[];
}

export interface CostAssumption {
  driver: string;
  formulaNote: string;
  unmitigatedInrCr: number;
  mitigatedInrCr: number;
}

export interface CostProjection {
  baselineCapexInrCr: number;
  unmitigated25YrPenaltyInrCr: number;
  preventiveGreenCapexInrCr: number;
  net25YrAvoidedCostInrCr: number;
  roiMultiple: number;
  coolingLoadIncreasePct: number;
  assumptions: CostAssumption[];
}

export interface SiteAssessment {
  id: string;
  telemetry: EnvironmentalTelemetry;
  pillars: PillarEvaluation[];
  overallSuitability: number;
  overallVerdict: RiskLevel;
  costProjection: CostProjection;
}

export interface AiBrief {
  finalVerdict: {
    decision: string;
    useCaseFitSummary: string;
    recommendedAction: string;
    confidenceLevel: string;
  };
  executiveSummary: string;
  keyHazards: Array<{
    title: string;
    severity: string;
    evidence: string;
    consequence: string;
  }>;
  mitigationStrategies: Array<{
    title: string;
    impact: string;
    costCategory: string;
    description: string;
  }>;
  alternativeCorridors: Array<{
    name: string;
    directionAndDistance: string;
    rationale: string;
    latOffset: number;
    lngOffset: number;
  }>;
}

export interface SearchGroundingResult {
  summary: string;
  sources: Array<{
    title: string;
    uri: string;
  }>;
}

export interface MapsGroundingResult {
  summary: string;
  places: Array<{
    title: string;
    uri: string;
    snippets: string[];
  }>;
}

export interface CornerOracleMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  model?: CornerModelId;
  sources?: Array<{ title: string; uri: string }>;
  timestamp: string;
}

export interface SavedAssessmentRecord {
  id: number;
  userId: number;
  siteLabel: string;
  region: string;
  lat: number;
  lng: number;
  projectType: ProjectType;
  areaHectares: number;
  horizonYear: HorizonYear;
  overallSuitability: number;
  overallVerdict: RiskLevel;
  netAvoidedInrCr: number;
  telemetryJson: string;
  createdAt: string;
}

export interface AuthSessionState {
  provider: 'supabase' | 'firebase';
  uid: string;
  email: string;
  emailVerified: boolean;
  token: string;
}

export interface GeneratedConcept {
  id: string;
  siteLabel: string;
  prompt: string;
  strategyLabel: string;
  imageSize: ImageSizeOption;
  aspectRatio: ImageAspectRatio;
  imageUrl: string;
  caption?: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  model?: ChatModelId;
  timestamp: string;
}

export interface GeocodeResult {
  displayName: string;
  lat: number;
  lng: number;
  region: string;
}
