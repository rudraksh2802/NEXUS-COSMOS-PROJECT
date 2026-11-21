import { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#2c3444] bg-[#181c24] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-brand-500/60 hover:text-white transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5 text-brand-400" />
        <span className="hidden sm:inline">Install App</span>
        <span className="sm:hidden">Install</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#2c3444] bg-[#181c24] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-brand-500/60 hover:text-white transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5 text-brand-400" />
          <span className="hidden sm:inline">Install on iOS</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-lg border border-[#2c3444] bg-[#141820] p-5 shadow-2xl text-slate-100">
              <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#232936]">
                <h3 className="text-sm font-semibold text-white">
                  Install TerraSight on iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 text-slate-400 hover:text-white rounded"
                  aria-label="Close iOS install instructions"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="mt-3 text-xs text-slate-400 leading-relaxed">
                Install TerraSight for offline field inspection access:
              </p>
              <ol className="mt-2 space-y-1.5 text-xs text-slate-200 list-decimal list-inside">
                <li>
                  Tap the <strong className="text-white">Share</strong> button in the Safari toolbar.
                </li>
                <li>
                  Scroll down and tap <strong className="text-white">Add to Home Screen</strong>.
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-md bg-brand-500 py-2 text-xs font-semibold text-slate-950 hover:bg-brand-300 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}

interface OfflineIndicatorProps {
  cachedSiteCount?: number;
}

export function OfflineIndicator({ cachedSiteCount = 0 }: OfflineIndicatorProps) {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-5 z-40 flex items-center gap-2.5 rounded-md border border-brand-500/50 bg-[#141820]/95 backdrop-blur-md px-3.5 py-2 text-xs font-medium text-slate-100 shadow-2xl max-w-[calc(100vw-2.5rem)] print:hidden"
    >
      <WifiOff className="w-4 h-4 text-brand-400 shrink-0" />
      <span className="truncate">
        Offline Mode — Using Workbox cached assets
        {cachedSiteCount > 0 ? ` (${cachedSiteCount} field site${cachedSiteCount === 1 ? '' : 's'} cached)` : ''}
      </span>
    </div>
  );
}
