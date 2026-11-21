import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { SiteAssessment } from '../types/site';

interface MiniParcelMapProps {
  site: SiteAssessment;
  accentHex: string;
}

export function MiniParcelMap({ site, accentHex }: MiniParcelMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const overlayLayerRef = useRef<L.LayerGroup | null>(null);
  const [tileMode, setTileMode] = useState<'satellite' | 'street'>('satellite');

  const { lat, lng, label } = site.telemetry.query;
  const sampleFeatures = site.telemetry.landUse2Km.sampleFeatures;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [lat, lng],
      zoom: 13,
      zoomControl: false,
      attributionControl: false,
    });

    const overlayGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    overlayLayerRef.current = overlayGroup;

    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      overlayLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const tileUrl =
      tileMode === 'satellite'
        ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
        : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

    tileLayerRef.current = L.tileLayer(tileUrl, {
      maxZoom: 18,
    }).addTo(map);
  }, [tileMode]);

  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayLayerRef.current;
    if (!map || !overlay) return;

    map.setView([lat, lng], 13, { animate: false });
    overlay.clearLayers();

    // 2 km environmental buffer ring
    L.circle([lat, lng], {
      radius: 2000,
      color: accentHex,
      weight: 2,
      fillColor: accentHex,
      fillOpacity: 0.12,
    }).addTo(overlay);

    // Center parcel pin
    L.circleMarker([lat, lng], {
      radius: 6,
      color: '#ffffff',
      weight: 2,
      fillColor: accentHex,
      fillOpacity: 1,
    })
      .bindTooltip(label, { direction: 'top' })
      .addTo(overlay);

    // Surrounding green & water features
    for (const feat of sampleFeatures.slice(0, 20)) {
      const color =
        feat.kind === 'green'
          ? '#5C99EE'
          : feat.kind === 'water'
            ? '#38bdf8'
            : feat.kind === 'industrial'
              ? '#ef4444'
              : '#94a3b8';
      L.circleMarker([feat.lat, feat.lng], {
        radius: 3,
        color,
        weight: 1,
        fillColor: color,
        fillOpacity: 0.9,
      }).addTo(overlay);
    }
  }, [lat, lng, label, accentHex, sampleFeatures]);

  return (
    <div className="relative rounded-md border border-[#232936] overflow-hidden bg-[#0e1116] h-44">
      <div ref={containerRef} className="w-full h-full z-0" />

      <div className="absolute top-2 right-2 z-[400] flex items-center gap-1 bg-[#0e1116]/90 backdrop-blur-md border border-[#2a3140] rounded p-0.5 shadow-sm print:hidden">
        <button
          type="button"
          onClick={() => setTileMode('satellite')}
          className={`px-2 py-0.5 text-[10px] font-semibold rounded-xs transition-colors ${
            tileMode === 'satellite' ? 'bg-brand-500 text-slate-950' : 'text-slate-300 hover:text-white'
          }`}
        >
          Satellite
        </button>
        <button
          type="button"
          onClick={() => setTileMode('street')}
          className={`px-2 py-0.5 text-[10px] font-semibold rounded-xs transition-colors ${
            tileMode === 'street' ? 'bg-brand-500 text-slate-950' : 'text-slate-300 hover:text-white'
          }`}
        >
          Street
        </button>
      </div>

      <div className="absolute bottom-2 left-2 right-2 z-[400] px-2.5 py-1 bg-[#0e1116]/90 backdrop-blur-md border border-[#2a3140] rounded text-[10px] font-mono text-slate-200 font-medium pointer-events-none flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
        <span className="text-slate-400">2 km:</span>
        <span className="inline-flex items-center gap-1 text-brand-400">
          <span className="inline-block w-2 h-2 rounded-full bg-[#5C99EE]" />
          {site.telemetry.landUse2Km.greenFeaturesCount} green
        </span>
        <span className="inline-flex items-center gap-1 text-sky-400">
          <span className="inline-block w-2 h-2 rounded-full bg-[#38bdf8]" />
          {site.telemetry.landUse2Km.waterFeaturesCount} water
        </span>
        <span className="inline-flex items-center gap-1 text-rose-400">
          <span className="inline-block w-2 h-2 rounded-full bg-[#ef4444]" />
          {site.telemetry.landUse2Km.industrialCount} ind.
        </span>
        <span className="inline-flex items-center gap-1 text-slate-400">
          <span className="inline-block w-2 h-2 rounded-full bg-[#94a3b8]" />
          built
        </span>
      </div>
    </div>
  );
}
