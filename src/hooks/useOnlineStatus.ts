import { useCallback, useEffect, useState } from 'react';
import type { HorizonYear, ProjectType } from '../types/site';

export interface CachedFieldSiteSummary {
  cacheUrl: string;
  label: string;
  region: string;
  lat: number;
  lng: number;
  projectType: ProjectType;
  areaHectares: number;
  horizonYear: HorizonYear;
  cachedAt: string;
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

export async function readCachedTelemetrySites(): Promise<CachedFieldSiteSummary[]> {
  if (typeof window === 'undefined' || !('caches' in window)) return [];
  try {
    const cache = await caches.open('terrasight-telemetry-v1');
    const keys = await cache.keys();
    const items: CachedFieldSiteSummary[] = [];

    for (const req of keys) {
      const res = await cache.match(req);
      if (!res) continue;
      try {
        const data = await res.json();
        const q = data?.query;
        if (q && Number.isFinite(Number(q.lat)) && Number.isFinite(Number(q.lng))) {
          items.push({
            cacheUrl: req.url,
            label: String(q.label || 'Cached Field Parcel'),
            region: String(q.region || 'Cached Region'),
            lat: Number(q.lat),
            lng: Number(q.lng),
            projectType: (q.projectType || 'residential_township') as ProjectType,
            areaHectares: Number(q.areaHectares) || 35,
            horizonYear: Number(q.horizonYear) === 2035 ? 2035 : 2050,
            cachedAt:
              res.headers.get('X-TerraSight-Cached-At') ||
              String(data.fetchedAt || ''),
          });
        }
      } catch {
        // Skip malformed cache entries
      }
    }

    return items.sort(
      (a, b) => new Date(b.cachedAt || 0).getTime() - new Date(a.cachedAt || 0).getTime()
    );
  } catch {
    return [];
  }
}

export function useCachedFieldSites() {
  const [cachedSites, setCachedSites] = useState<CachedFieldSiteSummary[]>([]);

  const refreshCachedSites = useCallback(async () => {
    const items = await readCachedTelemetrySites();
    setCachedSites(items);
  }, []);

  useEffect(() => {
    refreshCachedSites();
  }, [refreshCachedSites]);

  return { cachedSites, refreshCachedSites };
}
