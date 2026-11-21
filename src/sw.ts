import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import { cleanupOutdatedCaches, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

declare global {
  interface Window {
    __WB_MANIFEST: Array<PrecacheEntry | string>;
  }
}

interface SWGlobal {
  location: Location;
  skipWaiting: () => Promise<void>;
  clients: {
    claim: () => Promise<void>;
  };
  addEventListener: (type: string, listener: (event: any) => void) => void;
}

const sw = self as unknown as SWGlobal;

const TELEMETRY_CACHE_NAME = 'terrasight-telemetry-v1';
const AI_BRIEF_CACHE_NAME = 'terrasight-ai-brief-v1';
const MAX_TELEMETRY_ENTRIES = 40;
const MAX_BRIEF_ENTRIES = 30;

// Take control immediately for field inspectors returning to active tabs
sw.skipWaiting();
clientsClaim();

// Precache Vite-built static assets injected by vite-plugin-pwa
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

// 1. App Shell & Navigation (NetworkFirst with fast timeout fallback for offline reload)
const navigationStrategy = new NetworkFirst({
  cacheName: 'terrasight-pages-v1',
  networkTimeoutSeconds: 4,
  plugins: [
    new CacheableResponsePlugin({
      statuses: [0, 200],
    }),
    new ExpirationPlugin({
      maxEntries: 15,
      maxAgeSeconds: 60 * 60 * 24 * 14,
    }),
  ],
});

registerRoute(
  new NavigationRoute(
    async ({ event, request, url }) => {
      try {
        return await navigationStrategy.handle({ event, request });
      } catch {
        const cache = await caches.open('terrasight-pages-v1');
        const rootMatch =
          (await cache.match('/')) ||
          (await cache.match(`${url.origin}/`)) ||
          (await cache.match('/index.html'));
        if (rootMatch) return rootMatch;
        return new Response(
          '<!doctype html><html><body style="font-family:sans-serif;padding:24px;color:#0f2557;"><h2>TerraSight Offline</h2><p>Reconnect briefly to complete initial app shell caching.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html' } }
        );
      }
    },
    {
      denylist: [/^\/api\//],
    }
  )
);

// 2. Google Fonts (CacheFirst for font binaries, StaleWhileRevalidate for CSS)
registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({
    cacheName: 'terrasight-google-fonts-css-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'terrasight-google-fonts-bin-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }),
    ],
  })
);

// 3. Static Assets in Dev & Runtime (JS, CSS, SVG, PNG, WOFF2)
registerRoute(
  ({ request, url }) =>
    url.origin === sw.location.origin &&
    !url.pathname.startsWith('/api/') &&
    !url.pathname.startsWith('/@vite/') &&
    !url.pathname.startsWith('/@react-refresh') &&
    !url.pathname.startsWith('/@id/') &&
    !url.pathname.startsWith('/node_modules/') &&
    !url.search.includes('dev-sw') &&
    ['script', 'style', 'image', 'font'].includes(request.destination),
  new StaleWhileRevalidate({
    cacheName: 'terrasight-static-assets-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 }),
    ],
  })
);

// 4. OpenStreetMap / ESRI Public Map Tiles for Field Offline Map Inspection
registerRoute(
  ({ url }) =>
    url.hostname.endsWith('tile.openstreetmap.org') ||
    url.hostname.includes('arcgisonline.com'),
  new CacheFirst({
    cacheName: 'terrasight-map-tiles-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 250,
        maxAgeSeconds: 60 * 60 * 24 * 14,
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// 5. GET Geocoding & Saved Assessments (NetworkFirst fallback to recent cache)
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.origin === sw.location.origin &&
    (url.pathname === '/api/geocode' || url.pathname === '/api/reverse-geocode'),
  new NetworkFirst({
    cacheName: 'terrasight-geocode-v1',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 14 }),
    ],
  })
);

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.origin === sw.location.origin &&
    url.pathname === '/api/assessments',
  new NetworkFirst({
    cacheName: 'terrasight-assessments-v1',
    networkTimeoutSeconds: 5,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    ],
  })
);

// Helper: Fetch with explicit timeout for intermittent field connectivity
async function fetchWithTimeout(request: Request, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Helper: Enforce LRU bound on custom CacheStorage buckets
async function pruneCacheBucket(cache: Cache, maxEntries: number): Promise<void> {
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    const removeCount = keys.length - maxEntries;
    for (let i = 0; i < removeCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// 6. Custom Workbox Route for POST /api/analyze-site Telemetry
// Maps POST payloads to canonical GET CacheStorage keys keyed by coordinates & horizonYear
registerRoute(
  ({ url, request }) =>
    url.origin === sw.location.origin &&
    url.pathname === '/api/analyze-site' &&
    request.method === 'POST',
  async ({ request, url }) => {
    let payload: Record<string, any> = {};
    try {
      payload = await request.clone().json();
    } catch {
      payload = {};
    }

    const lat = Number(payload.lat);
    const lng = Number(payload.lng);
    const horizonYear = Number(payload.horizonYear) === 2035 ? 2035 : 2050;
    const hasValidCoords = Number.isFinite(lat) && Number.isFinite(lng);

    const cacheKeyUrl = hasValidCoords
      ? `${url.origin}/__sw_cache__/telemetry?lat=${lat.toFixed(3)}&lng=${lng.toFixed(3)}&horizon=${horizonYear}`
      : `${url.origin}/__sw_cache__/telemetry?default=1`;
    const cacheKeyReq = new Request(cacheKeyUrl, { method: 'GET' });
    const cache = await caches.open(TELEMETRY_CACHE_NAME);

    try {
      const networkRes = await fetchWithTimeout(request, 12000);
      if (networkRes.ok) {
        const cloned = networkRes.clone();
        const data = await cloned.json();
        const cachedAt = new Date().toISOString();

        const cacheHeaders = new Headers({
          'Content-Type': 'application/json',
          'X-TerraSight-Cached-At': cachedAt,
        });
        await cache.put(
          cacheKeyReq,
          new Response(JSON.stringify(data), { status: 200, headers: cacheHeaders })
        );
        await pruneCacheBucket(cache, MAX_TELEMETRY_ENTRIES);
      }
      return networkRes;
    } catch {
      // Intermittent or offline fallback: serve cached telemetry if present for these coordinates
      const cachedRes = await cache.match(cacheKeyReq);
      if (cachedRes) {
        const cachedData = await cachedRes.json();
        // Preserve inspector's requested projectType / areaHectares / label on cached telemetry
        cachedData.query = {
          ...(cachedData.query || {}),
          lat: hasValidCoords ? lat : cachedData.query?.lat,
          lng: hasValidCoords ? lng : cachedData.query?.lng,
          label: payload.label || cachedData.query?.label || 'Cached Field Parcel',
          region: payload.region || cachedData.query?.region || 'Offline Cache',
          projectType: payload.projectType || cachedData.query?.projectType || 'residential_township',
          areaHectares: Number(payload.areaHectares) || cachedData.query?.areaHectares || 35,
          horizonYear,
        };
        const cachedAt = cachedRes.headers.get('X-TerraSight-Cached-At') || cachedData.fetchedAt || '';
        return new Response(JSON.stringify(cachedData), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-TerraSight-Cache': 'HIT',
            'X-TerraSight-Cached-At': cachedAt,
          },
        });
      }

      return new Response(
        JSON.stringify({
          error:
            'Offline and no cached telemetry is stored for these coordinates yet. Select a previously inspected site or reconnect briefly.',
          offline: true,
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'X-TerraSight-Cache': 'MISS',
          },
        }
      );
    }
  },
  'POST'
);

// 7. Custom Workbox Route for POST /api/ai/brief (Caches recent executive site briefs)
registerRoute(
  ({ url, request }) =>
    url.origin === sw.location.origin &&
    url.pathname === '/api/ai/brief' &&
    request.method === 'POST',
  async ({ request, url }) => {
    let payload: Record<string, any> = {};
    try {
      payload = await request.clone().json();
    } catch {
      payload = {};
    }

    const q = payload?.assessment?.telemetry?.query || {};
    const lat = Number(q.lat);
    const lng = Number(q.lng);
    const projectType = String(q.projectType || 'residential_township');
    const horizonYear = Number(q.horizonYear) === 2035 ? 2035 : 2050;
    const cacheKeyUrl =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? `${url.origin}/__sw_cache__/brief?lat=${lat.toFixed(3)}&lng=${lng.toFixed(3)}&project=${encodeURIComponent(
            projectType
          )}&horizon=${horizonYear}`
        : `${url.origin}/__sw_cache__/brief?default=1`;
    const cacheKeyReq = new Request(cacheKeyUrl, { method: 'GET' });
    const cache = await caches.open(AI_BRIEF_CACHE_NAME);

    try {
      const networkRes = await fetchWithTimeout(request, 15000);
      if (networkRes.ok) {
        const textBody = await networkRes.clone().text();
        await cache.put(
          cacheKeyReq,
          new Response(textBody, {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-TerraSight-Cached-At': new Date().toISOString(),
            },
          })
        );
        await pruneCacheBucket(cache, MAX_BRIEF_ENTRIES);
      }
      return networkRes;
    } catch {
      const cachedRes = await cache.match(cacheKeyReq);
      if (cachedRes) {
        const body = await cachedRes.text();
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-TerraSight-Cache': 'HIT',
            'X-TerraSight-Cached-At': cachedRes.headers.get('X-TerraSight-Cached-At') || '',
          },
        });
      }
      return new Response(
        JSON.stringify({
          error: 'Offline: AI narrative brief is unavailable until connectivity returns.',
          offline: true,
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
  },
  'POST'
);

sw.addEventListener('message', (event) => {
  if (event?.data?.type === 'SKIP_WAITING') {
    sw.skipWaiting();
  }
});
