import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register Workbox service worker for offline static assets and field telemetry caching
if ('serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60 * 60 * 1000);
      }
    },
  });
}

// Tier 1 Google Maps Platform Quota Defense Listener (Demo/GHP Key)
const QUOTA_REGEX =
  /OverQuotaMapError|BillingNotEnabledMapError|ExpiredKeyMapError|QuotaExceeded|OVER_QUERY_LIMIT|REQUEST_DENIED/i;

const emitQuotaExceeded = (detail: string) => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded', { detail }));
};

(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  emitQuotaExceeded(
    'Google Maps authentication or billing limit triggered (gm_authFailure).'
  );
};

const origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const joined = args.map((a) => String(a ?? '')).join(' ');
  if (QUOTA_REGEX.test(joined)) {
    emitQuotaExceeded(joined.slice(0, 220));
  }
  origConsoleError(...args);
};

createRoot(document.getElementById('root')!).render(<App />);
