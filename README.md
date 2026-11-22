[README.md](https://github.com/user-attachments/files/35222467/README.md)
# TerraSight

> **“Analyse the future before building one”**

TerraSight is an AI-powered geospatial and environmental site intelligence workbench built for urban planners, infrastructure teams, and sustainability engineers. It aggregates live satellite, hydrological, climate, and land-use telemetry for any coordinate or corridor on Earth, computes a 5-pillar suitability assessment with 25-year preventive cost modeling, and synthesizes an actionable planning verdict tailored to the proposed development use case.

---

## Key Capabilities

### 1. Interactive Geospatial & Satellite Workbench
- **Google Maps Platform Integration**: Supports Satellite, Hybrid, and Terrain views alongside clickable parcel inspection (`@vis.gl/react-google-maps` + Google Places lookup).
- **DEM 90m Elevation & 2 km Land-Use Overlays**: Toggleable terrain elevation sampling and surrounding OpenStreetMap feature markers with an on-map color-coded legend:
  - **DEM 90m Dots**: Orange (Low / Pooling), Blue `#5C99EE` (Mid Elevation), Sky Blue (High Ground).
  - **2 km OSM Markers**: Red (Industrial Hazard), Blue `#5C99EE` (Green / Park), Sky Blue (Water Body), Slate (Urban Built).
- **Location Search & Benchmark Corridors**: Geocode any city/district or jump directly to pre-configured Indian urban growth corridors.

### 2. Five-Pillar Empirical Telemetry & Scoring
Every selected site is evaluated across five weighted engineering pillars for a configurable project typology, footprint (`10–150 ha`), and climate horizon (`2035` or `2050`):
- **Climate Resilience** — CMIP6 warming delta and annual extreme heat days (`≥ 40°C`).
- **Environment & Air** — Copernicus CAMS live particulate matter (`PM2.5` / `US AQI`) and daily evaporation stress (`ET0`).
- **Geography & Hydrology** — Copernicus 90m DEM relief and GloFAS 60-day peak-to-mean river discharge ratios.
- **Sustainability & Solar** — 2 km OpenStreetMap green/water buffer ratio paired with NASA POWER solar irradiance (`kWh/m²/day`).
- **Economic Feasibility** — 25-year lifecycle cost comparison (Baseline CapEx, Unmitigated Climate Penalty, Preventive Upfront CapEx, Net Avoided Cost in `₹ Cr`, and ROI multiple).

### 3. Preventive Planning Brief, Alternative Siting & Final AI Verdict
- Synthesized server-side via `@google/genai` strictly from measured site telemetry.
- Displays a dedicated **Final AI Verdict Upon Use Case** (`PROCEED`, `PROCEED WITH MITIGATIONS`, `CONDITIONAL HOLD`, or `RELOCATION RECOMMENDED`) with confidence level, use-case fit summary, and recommended pre-construction action.
- Lists prioritized hazards, preventive civil/MEP mitigations, and clickable **Alternative Relocation Candidates** that re-evaluate nearby coordinates live.
- **Nearby Infrastructure & Landmarks**: Dedicated proximity panel marked **Feature coming soon**.

### 4. Multi-Site Comparison & Planning Advisor
- **Compare Sites**: Pin evaluated parcels or batch-benchmark all reference corridors side by side with comparative radar and cost charts.
- **Planning Advisor & Corner Forecast**: Interactive planning chat and 10-year future outlook assistant contextualized with active site telemetry.

### 5. Workspace Persistence, Auth & Offline Field Support
- **Authentication**: Supports Firebase Authentication (Google Sign-In / email) and Supabase Auth.
- **PostgreSQL Persistence (Cloud SQL)**: Authenticated users can save, reload, and delete site dossiers via Drizzle ORM (`/api/assessments`).
- **Progressive Web App (PWA)**: Workbox service worker caches analyzed site telemetry for low-connectivity field visits (`Offline Field Cache`).

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS v4, Lucide Icons, Motion
- **Mapping & Visualization**: Google Maps Platform (`@vis.gl/react-google-maps`), Leaflet (`MiniParcelMap`), custom SVG charts
- **Backend**: Node.js, Express, `tsx`, Vite middleware in dev
- **Database**: PostgreSQL (Cloud SQL) with `drizzle-orm` & `pg`
- **Authentication**: Firebase Auth (`firebase` + `firebase-admin`) & Supabase (`@supabase/supabase-js`)
- **AI Engine**: Google Gemini (`@google/genai`) server-side proxy endpoints
- **Offline / PWA**: `vite-plugin-pwa` & Workbox

---

## Project Structure

```text
.
├── server.ts                  # Express server, telemetry aggregators, Gemini AI & Cloud SQL routes
├── index.html                 # HTML shell and metadata
├── metadata.json              # App name, description, and capabilities
├── vite.config.ts             # Vite + Tailwind + PWA configuration
├── firebase-applet-config.json# Firebase client configuration
└── src/
    ├── App.tsx                # Main workbench shell (Analyzer, Compare, Advisor)
    ├── index.css              # Tailwind v4 theme tokens & dark geospatial palette
    ├── sw.ts                  # Workbox service worker for offline field telemetry caching
    ├── components/
    │   ├── AuthGate.tsx       # Firebase & Supabase sign-in view
    │   ├── ClimateCharts.tsx  # CMIP6 monthly temperature & radar visualizations
    │   ├── CompareCharts.tsx  # Multi-site comparison charts
    │   ├── CompareView.tsx    # Side-by-side parcel comparison table & controls
    │   ├── CornerFutureAI.tsx # Floating 10-year outlook assistant
    │   ├── MetricHelpTooltip.tsx # Pillar methodology & budget impact tooltips
    │   ├── MiniParcelMap.tsx  # Leaflet parcel thumbnail with feature swatches
    │   ├── PWAInstallButton.tsx # Offline status & PWA install banner
    │   ├── PlanningAdvisor.tsx# Interactive planning Q&A workspace & drawer
    │   └── SatelliteMap.tsx   # Google Maps satellite canvas + DEM/OSM legend HUD
    ├── db/
    │   ├── index.ts           # PostgreSQL connection pool & Drizzle client
    │   └── schema.ts          # Saved site assessments table schema
    ├── hooks/
    │   └── useOnlineStatus.ts # Network connectivity & Workbox cache inspection
    ├── lib/
    │   ├── evaluator.ts       # 5-pillar scoring & 25-year cost projection engine
    │   ├── firebase.ts        # Firebase Auth client helpers
    │   └── supabase.ts        # Supabase client helpers
    ├── middleware/
    │   └── auth.ts            # Bearer token verification (Firebase Admin / Supabase)
    └── types/
        └── site.ts            # Shared TypeScript interfaces & benchmark corridors
```

---

## API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/geocode` | Forward geocode places by query string |
| `GET` | `/api/reverse-geocode` | Resolve coordinates to locality & region |
| `POST` | `/api/analyze-site` | Fetch live CMIP6, CAMS, DEM, GloFAS, NASA POWER & OSM telemetry |
| `POST` | `/api/ai/brief` | Generate Preventive Planning Brief, Alternative Siting & Final AI Verdict |
| `POST` | `/api/ai/chat` | Interactive Planning Advisor conversation |
| `POST` | `/api/ai/corner-oracle` | 10-year site outlook synthesis |
| `GET` | `/api/auth/me` | Verify active Firebase or Supabase session |
| `GET` | `/api/assessments` | List saved Cloud SQL site dossiers for the signed-in user |
| `POST` | `/api/assessments` | Save an evaluated site dossier to Cloud SQL |
| `DELETE` | `/api/assessments/:id` | Delete a saved dossier |

---

## Environment Variables

Configure runtime variables using `.env.example` as a template:

- `GEMINI_API_KEY` — Server-side Gemini API key
- `APP_URL` — Public application base URL
- `VITE_GOOGLE_MAPS_API_KEY` — Google Maps Platform JavaScript API key
- `VITE_SUPABASE_URL` & `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase authentication credentials
- `SQL_HOST`, `SQL_USER`, `SQL_ADMIN_USER`, `SQL_PASSWORD`, `SQL_ADMIN_PASSWORD`, `SQL_DB_NAME` — Cloud SQL PostgreSQL connection settings

---

## Scripts

```bash
# Install dependencies
npm install

# Run full-stack development server (port 3000)
npm run dev

# Type-check with TypeScript
npm run lint

# Build production frontend bundle
npm run build

# Start production server
npm run start
```
