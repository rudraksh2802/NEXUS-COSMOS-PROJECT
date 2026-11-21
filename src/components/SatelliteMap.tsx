import { useEffect, useRef, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  Pin,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
  type MapMouseEvent,
} from '@vis.gl/react-google-maps';
import { AlertTriangle, Search } from 'lucide-react';
import type { ElevationGridPoint, EnvironmentalTelemetry, MapLayerMode } from '../types/site';

interface SatelliteMapProps {
  lat: number;
  lng: number;
  label: string;
  layerMode: MapLayerMode;
  showElevationGrid: boolean;
  showLandUseBuffer: boolean;
  elevationGrid: ElevationGridPoint[];
  landUseSamples: EnvironmentalTelemetry['landUse2Km']['sampleFeatures'];
  onSelectCoordinates: (lat: number, lng: number, placeLabel?: string) => void;
  onLayerChange: (mode: MapLayerMode) => void;
  onToggleElevationGrid: () => void;
  onToggleLandUseBuffer: () => void;
}

const MAP_TYPE_BY_MODE: Record<MapLayerMode, string> = {
  satellite: 'hybrid',
  urban: 'roadmap',
  topo: 'terrain',
};

function MapCameraSync({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  const prevRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!map) return;
    if (
      prevRef.current &&
      Math.abs(prevRef.current.lat - lat) < 1e-5 &&
      Math.abs(prevRef.current.lng - lng) < 1e-5
    ) {
      return;
    }
    prevRef.current = { lat, lng };
    map.panTo({ lat, lng });
    if ((map.getZoom() ?? 0) < 13) {
      map.setZoom(13);
    }
  }, [map, lat, lng]);

  return null;
}

interface MapCircleHandle {
  setMap: (map: unknown) => void;
  setCenter: (center: { lat: number; lng: number }) => void;
}

function AnalysisBufferCircle({
  lat,
  lng,
  visible,
}: {
  lat: number;
  lng: number;
  visible: boolean;
}) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const circleRef = useRef<MapCircleHandle | null>(null);

  useEffect(() => {
    if (!map || !visible || !mapsLib?.Circle) {
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
      return;
    }

    if (!circleRef.current) {
      circleRef.current = new mapsLib.Circle({
        map,
        center: { lat, lng },
        radius: 2000,
        strokeColor: '#467fd4',
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: '#5C99EE',
        fillOpacity: 0.12,
        clickable: false,
      }) as unknown as MapCircleHandle;
    } else {
      circleRef.current.setCenter({ lat, lng });
      circleRef.current.setMap(map);
    }

    return () => {
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
    };
  }, [map, mapsLib, lat, lng, visible]);

  return null;
}

function PlacesQuickSearch({
  onSelectPlace,
}: {
  onSelectPlace: (lat: number, lng: number, placeLabel?: string) => void;
}) {
  const placesLib = useMapsLibrary('places');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  if (!placesLib?.Place) return null;

  const handlePlacesLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || searching) return;
    setSearching(true);
    try {
      const { places } = await placesLib.Place.searchByText({
        textQuery: trimmed,
        fields: ['displayName', 'location', 'formattedAddress'],
        maxResultCount: 1,
      });
      const first = places?.[0];
      if (first?.location) {
        const nextLat = +first.location.lat().toFixed(5);
        const nextLng = +first.location.lng().toFixed(5);
        onSelectPlace(nextLat, nextLng, first.displayName || trimmed);
        setQuery('');
      }
    } catch {
      // Ignore transient SDK lookup failures cleanly
    } finally {
      setSearching(false);
    }
  };

  return (
    <form
      onSubmit={handlePlacesLookup}
      className="hidden sm:flex items-center bg-[#0e1116]/90 backdrop-blur-md border border-[#2a3140] rounded-md shadow-lg overflow-hidden"
    >
      <Search className="w-3.5 h-3.5 text-slate-400 ml-2.5 shrink-0" />
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Places jump..."
        className="w-36 px-2 py-1 text-xs bg-transparent text-slate-100 placeholder:text-slate-500 focus:outline-none"
      />
      <button
        type="submit"
        disabled={searching || !query.trim()}
        className="px-2.5 py-1 text-[11px] font-mono font-bold bg-[#1a1f29] hover:bg-brand-500 hover:text-slate-950 text-brand-400 border-l border-[#2a3140] transition-colors disabled:opacity-50"
      >
        {searching ? '...' : 'Go'}
      </button>
    </form>
  );
}

function InnerGoogleMap({
  lat,
  lng,
  label,
  layerMode,
  showElevationGrid,
  showLandUseBuffer,
  elevationGrid,
  landUseSamples,
  onSelectCoordinates,
  onLayerChange,
  onToggleElevationGrid,
  onToggleLandUseBuffer,
}: SatelliteMapProps) {
  const status = useApiLoadingStatus();
  const [selectedProbe, setSelectedProbe] = useState<{
    lat: number;
    lng: number;
    title: string;
    detail: string;
  } | null>(null);

  const minElev =
    elevationGrid.length > 0 ? Math.min(...elevationGrid.map((p) => p.elevation)) : 0;
  const maxElev =
    elevationGrid.length > 0 ? Math.max(...elevationGrid.map((p) => p.elevation)) : 1;
  const elevSpan = Math.max(1, maxElev - minElev);

  const handleMapClick = (ev: MapMouseEvent) => {
    const clicked = ev.detail?.latLng;
    if (!clicked) return;
    setSelectedProbe(null);
    onSelectCoordinates(+clicked.lat.toFixed(5), +clicked.lng.toFixed(5));
  };

  if (status === APILoadingStatus.AUTH_FAILURE || status === APILoadingStatus.FAILED) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-[#0e1116]">
        <AlertTriangle className="w-6 h-6 text-amber-400 mb-2" />
        <p className="text-sm font-bold text-white">
          Google Maps Viewport Temporarily Unavailable
        </p>
        <p className="text-xs text-slate-400 mt-1 max-w-md">
          Coordinate selection via location search and benchmark corridors remains active. Live Open-Meteo, Copernicus DEM, CAMS, GloFAS, and NASA POWER telemetry continues uninterrupted.
        </p>
      </div>
    );
  }

  return (
    <>
      <Map
        mapId="DEMO_MAP_ID"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        defaultCenter={{ lat, lng }}
        defaultZoom={13}
        colorScheme="DARK"
        mapTypeId={MAP_TYPE_BY_MODE[layerMode]}
        gestureHandling="greedy"
        mapTypeControl={false}
        streetViewControl={false}
        fullscreenControl={false}
        onClick={handleMapClick}
        style={{ width: '100%', height: '100%' }}
      >
        <MapCameraSync lat={lat} lng={lng} />
        <AnalysisBufferCircle lat={lat} lng={lng} visible={showLandUseBuffer} />

        {/* Primary Parcel Pin */}
        <AdvancedMarker
          position={{ lat, lng }}
          title={`${label} (${lat.toFixed(4)}, ${lng.toFixed(4)})`}
          onClick={() =>
            setSelectedProbe({
              lat,
              lng,
              title: label,
              detail: `Target Parcel · ${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`,
            })
          }
        >
          <Pin
            background="#141820"
            borderColor="#5C99EE"
            glyphColor="#87b5f4"
            scale={1.15}
          />
        </AdvancedMarker>

        {/* 5x5 Copernicus DEM 90m Elevation Probes */}
        {showElevationGrid &&
          elevationGrid.map((pt, idx) => {
            const ratio = (pt.elevation - minElev) / elevSpan;
            const dotColor =
              ratio < 0.3 ? '#f97316' : ratio < 0.7 ? '#5C99EE' : '#38bdf8';
            return (
              <AdvancedMarker
                key={`dem-${idx}`}
                position={{ lat: pt.lat, lng: pt.lng }}
                title={`DEM 90m: ${pt.elevation.toFixed(1)} m`}
                onClick={() =>
                  setSelectedProbe({
                    lat: pt.lat,
                    lng: pt.lng,
                    title: 'Copernicus DEM 90m Probe',
                    detail: `Elevation: ${pt.elevation.toFixed(1)} m ASL`,
                  })
                }
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: dotColor,
                    border: '1.5px solid #0b0d11',
                    boxShadow: '0 1px 6px rgba(0,0,0,0.65)',
                  }}
                />
              </AdvancedMarker>
            );
          })}

        {/* 2 km OSM Land-Use Feature Samples */}
        {showLandUseBuffer &&
          landUseSamples.map((feat, idx) => {
            const color =
              feat.kind === 'green'
                ? '#5C99EE'
                : feat.kind === 'water'
                  ? '#38bdf8'
                  : feat.kind === 'industrial'
                    ? '#ef4444'
                    : '#94a3b8';
            return (
              <AdvancedMarker
                key={`osm-${idx}`}
                position={{ lat: feat.lat, lng: feat.lng }}
                title={`${feat.name} (${feat.kind})`}
                onClick={() =>
                  setSelectedProbe({
                    lat: feat.lat,
                    lng: feat.lng,
                    title: feat.name,
                    detail: `OSM Feature Classification: ${feat.kind.toUpperCase()}`,
                  })
                }
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    backgroundColor: color,
                    border: '1px solid #0b0d11',
                    transform: 'rotate(45deg)',
                  }}
                />
              </AdvancedMarker>
            );
          })}

        {selectedProbe && (
          <InfoWindow
            position={{ lat: selectedProbe.lat, lng: selectedProbe.lng }}
            onCloseClick={() => setSelectedProbe(null)}
          >
            <div className="text-slate-900 p-0.5 max-w-[210px]">
              <div className="text-xs font-bold text-slate-950">{selectedProbe.title}</div>
              <div className="text-[11px] font-mono text-slate-600 mt-0.5">
                {selectedProbe.detail}
              </div>
            </div>
          </InfoWindow>
        )}
      </Map>

      {/* Top-Left Basemap Mode Segmented Switcher + Places Quick Jump */}
      <div className="absolute top-3 left-3 z-10 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 p-1 bg-[#0e1116]/90 backdrop-blur-md border border-[#2a3140] rounded-md shadow-lg">
          {(['satellite', 'urban', 'topo'] as MapLayerMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onLayerChange(mode)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-sm transition-colors whitespace-nowrap shrink-0 ${
                layerMode === mode
                  ? 'bg-brand-500 text-slate-950'
                  : 'text-slate-300 hover:bg-[#1a1f29] hover:text-white'
              }`}
            >
              {mode === 'satellite' ? 'Satellite' : mode === 'urban' ? 'Urban Map' : 'Terrain'}
            </button>
          ))}
        </div>

        <PlacesQuickSearch onSelectPlace={onSelectCoordinates} />
      </div>

      {/* Top-Right Spatial Layer Toggles */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleLandUseBuffer}
          className={`px-2.5 py-1.5 text-xs font-semibold rounded-md border backdrop-blur-md transition-colors whitespace-nowrap shrink-0 shadow-lg ${
            showLandUseBuffer
              ? 'bg-brand-500/20 border-brand-500/70 text-brand-300'
              : 'bg-[#0e1116]/90 border-[#2a3140] text-slate-300 hover:text-white hover:border-[#3b4459]'
          }`}
        >
          2 km Buffer
        </button>
        <button
          type="button"
          onClick={onToggleElevationGrid}
          className={`px-2.5 py-1.5 text-xs font-semibold rounded-md border backdrop-blur-md transition-colors whitespace-nowrap shrink-0 shadow-lg ${
            showElevationGrid
              ? 'bg-sky-500/20 border-sky-400/70 text-sky-300'
              : 'bg-[#0e1116]/90 border-[#2a3140] text-slate-300 hover:text-white hover:border-[#3b4459]'
          }`}
        >
          5×5 DEM Grid
        </button>
      </div>

      {/* Bottom Coordinate Readout & Marker Legend HUD */}
      <div className="absolute bottom-3 inset-x-3 z-10 flex flex-col xl:flex-row xl:items-end justify-between gap-2 pointer-events-none">
        <div className="pointer-events-auto self-start bg-[#0e1116]/90 backdrop-blur-md border border-[#2a3140] rounded-md px-3 py-1.5 shadow-lg">
          <div className="flex items-center gap-3 text-xs text-slate-300">
            <span className="font-mono tabular-nums font-bold text-brand-400">
              {lat.toFixed(4)}° N, {lng.toFixed(4)}° E
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="text-slate-400 hidden sm:inline">
              Click map or any dot to inspect
            </span>
          </div>
        </div>

        {(showElevationGrid || showLandUseBuffer) && (
          <div className="pointer-events-auto self-start xl:self-end bg-[#0e1116]/92 backdrop-blur-md border border-[#2a3140] rounded-md px-3 py-2 shadow-lg space-y-1.5 text-[10px] font-mono text-slate-300">
            {showElevationGrid && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-slate-400 font-semibold uppercase tracking-wider">
                  DEM 90m Dots:
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#f97316] border border-[#0b0d11]" />
                  Low / Pooling
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#5C99EE] border border-[#0b0d11]" />
                  Mid Elev
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#38bdf8] border border-[#0b0d11]" />
                  High Ground
                </span>
              </div>
            )}

            {showLandUseBuffer && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-slate-400 font-semibold uppercase tracking-wider">
                  2 km OSM Markers:
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rotate-45 bg-[#ef4444] border border-[#0b0d11]" />
                  Industrial Hazard
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rotate-45 bg-[#5C99EE] border border-[#0b0d11]" />
                  Green / Park
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rotate-45 bg-[#38bdf8] border border-[#0b0d11]" />
                  Water Body
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rotate-45 bg-[#94a3b8] border border-[#0b0d11]" />
                  Urban Built
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function SatelliteMap(props: SatelliteMapProps) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  return (
    <div className="relative w-full h-[500px] lg:h-[580px] border border-[#232936] rounded-lg overflow-hidden bg-[#0e1116]">
      {!apiKey ? (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
          <AlertTriangle className="w-6 h-6 text-amber-400 mb-2" />
          <p className="text-sm font-bold text-white">
            Google Maps API Key Not Configured
          </p>
          <p className="text-xs text-slate-400 mt-1 max-w-md">
            Set <code className="font-mono text-brand-400">VITE_GOOGLE_MAPS_API_KEY</code> to display the interactive satellite viewport.
          </p>
        </div>
      ) : (
        <APIProvider apiKey={apiKey} libraries={['marker', 'places']}>
          <InnerGoogleMap {...props} />
        </APIProvider>
      )}
    </div>
  );
}
