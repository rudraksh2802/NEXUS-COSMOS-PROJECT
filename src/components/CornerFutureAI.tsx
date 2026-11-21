import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Globe,
  Loader2,
  Maximize2,
  Minimize2,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  CornerModelId,
  CornerOracleMessage,
  SiteAssessment,
  SiteQuery,
} from '../types/site';

interface CornerFutureAIProps {
  siteQuery: SiteQuery;
  assessment: SiteAssessment | null;
}

export function CornerFutureAI({ siteQuery, assessment }: CornerFutureAIProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedModel, setSelectedModel] = useState<CornerModelId>('gemini-4-hydrogen');
  const [messages, setMessages] = useState<CornerOracleMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending, isOpen]);

  const buildCompactSiteContext = () => {
    if (!assessment) {
      return {
        label: siteQuery.label,
        region: siteQuery.region,
        lat: siteQuery.lat,
        lng: siteQuery.lng,
        projectType: siteQuery.projectType,
        areaHectares: siteQuery.areaHectares,
      };
    }
    const t = assessment.telemetry;
    return {
      label: t.query.label,
      region: t.query.region,
      coordinates: { lat: t.query.lat, lng: t.query.lng },
      projectType: t.query.projectType,
      areaHectares: t.query.areaHectares,
      overallSuitability: assessment.overallSuitability,
      overallVerdict: assessment.overallVerdict,
      tempDeltaC: t.climate.tempDeltaC,
      extremeHeatDaysPerYr: t.climate.futureExtremeHeatDaysPerYr,
      pm25: t.airQuality.pm25,
      usAqi: t.airQuality.usAqi,
      elevationMeters: t.elevation.centerMeters,
      floodPeakRatio: t.flood.peakToMeanRatio,
      nasaSolarKwhM2Day: t.nasaPower.solarIrradianceKwhM2Day,
      net25YrAvoidedCostInrCr: assessment.costProjection.net25YrAvoidedCostInrCr,
    };
  };

  const askFutureOracle = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || isSending) return;

    const userMsg: CornerOracleMessage = {
      id: `${Date.now()}_u`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsSending(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/ai/corner-oracle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          question: trimmed,
          horizonYears: 10,
          siteContext: buildCompactSiteContext(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Unable to query live internet intelligence.');
      }

      const aiMsg: CornerOracleMessage = {
        id: `${Date.now()}_m`,
        role: 'model',
        text: data.reply,
        model: data.model || selectedModel,
        sources: data.sources || [],
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Future AI request failed.');
    } finally {
      setIsSending(false);
    }
  };

  const quickPresets = [
    {
      label: '10-Yr Future (2036)',
      prompt: `What will ${siteQuery.label} (${siteQuery.region}) look like 10 years from now (by 2036) for a ${siteQuery.projectType.replace(
        '_',
        ' '
      )}? Include urban growth, temperature/heat trends, water stress, and real infrastructure projects found online.`,
    },
    {
      label: 'Masterplans & Zoning',
      prompt: `Search live internet records for current government urban masterplans, zoning rules, upcoming metro/highway corridors, and industrial or environmental clearances near ${siteQuery.label}, ${siteQuery.region}.`,
    },
    {
      label: 'Flood & Water History',
      prompt: `Search real online reports for historical flooding, water table depletion, air quality episodes, and municipal resilience advisories around ${siteQuery.label}, ${siteQuery.region}.`,
    },
  ];

  if (!isOpen) {
    return (
      <div className="fixed bottom-5 right-5 z-40 print:hidden">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2.5 px-4 py-3 bg-[#141820] hover:bg-[#1a1f29] text-white border border-brand-500/70 rounded-lg shadow-2xl transition-colors"
        >
          <Globe className="w-4 h-4 text-brand-400 shrink-0" />
          <div className="text-left">
            <div className="text-xs font-display font-bold tracking-tight leading-none text-white">
              10-Year Future AI
            </div>
            <div className="text-[10px] font-mono text-brand-400 mt-0.5">
              Live Web Search · Free
            </div>
          </div>
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="10-Year Future & Live Internet AI Assistant"
      className={`fixed bottom-4 right-4 z-40 flex flex-col bg-[#141820] border border-[#2a3140] rounded-lg shadow-2xl overflow-hidden transition-all print:hidden ${
        isExpanded
          ? 'w-[calc(100vw-2rem)] sm:w-[540px] h-[640px] max-h-[86vh]'
          : 'w-[calc(100vw-2rem)] sm:w-[410px] h-[540px] max-h-[82vh]'
      }`}
    >
      {/* Dark Telemetry Header */}
      <div className="bg-[#0e1116] border-b border-[#232936] text-white px-4 py-3 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-brand-400 shrink-0" />
            <h2 className="text-xs font-display font-bold tracking-tight truncate">
              10-Year Future &amp; Live Web AI
            </h2>
          </div>
          <p className="text-[11px] font-mono text-brand-400 truncate mt-0.5">
            {siteQuery.label} · Google Search Grounded
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            title={isExpanded ? 'Compact size' : 'Expand panel'}
            className="p-1.5 text-slate-400 hover:text-white rounded"
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            title="Minimize assistant"
            className="p-1.5 text-slate-400 hover:text-white rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Free Model Switcher & Quick 10-Yr Presets */}
      <div className="bg-[#0e1116]/70 border-b border-[#232936] px-3 py-2.5 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-slate-300">
            Free AI + Google Search Model:
          </span>
          <select
            aria-label="Select free AI model"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value as CornerModelId)}
            className="text-[11px] font-mono font-semibold text-slate-100 bg-[#141820] border border-[#2a3140] rounded-md px-2 py-1 focus:outline-none focus:border-brand-500"
          >
            <option value="gemini-4-hydrogen">Gemini 4 Hydrogen (Web)</option>
            <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Web)</option>
          </select>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {quickPresets.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={isSending}
              onClick={() => askFutureOracle(p.prompt)}
              className="px-2.5 py-1 text-[11px] font-semibold bg-brand-500/15 hover:bg-brand-500/25 text-brand-300 border border-brand-500/40 rounded-md transition-colors disabled:opacity-50"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Message History */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 bg-[#0b0d11]">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col justify-center text-left space-y-2.5 px-1">
            <h3 className="text-sm font-display font-bold text-white">
              Inspect {siteQuery.region} 10 Years Ahead
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Ask any organizational requirement, future climate outlook, zoning policy, infrastructure corridor, or land viability question. Answers combine live internet search results with your active site telemetry.
            </p>
            <div className="p-2.5 bg-brand-950/30 border border-brand-500/30 rounded-md text-[11px] text-brand-300">
              Click a quick preset above or type your custom question below.
            </div>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div className="text-[10px] font-mono text-slate-500 mb-0.5 px-1">
                {m.role === 'user' ? 'Organization' : `${m.model || selectedModel} + Search`} ·{' '}
                {m.timestamp}
              </div>
              <div
                className={`max-w-[92%] rounded-lg px-3 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-brand-500 text-slate-950 font-medium'
                    : 'bg-[#141820] border border-[#232936] text-slate-200'
                }`}
              >
                {m.text}

                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-[#232936] space-y-1">
                    <div className="text-[10px] font-mono font-semibold uppercase text-brand-400">
                      Live Internet Sources
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.sources.map((src, idx) => (
                        <a
                          key={idx}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-[#0e1116] border border-[#2a3140] hover:border-brand-500/60 text-slate-200 rounded transition-colors"
                        >
                          <span className="truncate max-w-[160px]">{src.title}</span>
                          <ExternalLink className="w-2.5 h-2.5 text-brand-400 shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {isSending && (
          <div className="flex items-center gap-2 text-xs text-slate-300 px-1">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
            <span>Searching live internet &amp; 10-year projections...</span>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-950/40 border border-amber-500/40 rounded-md text-xs text-amber-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div ref={scrollEndRef} />
      </div>

      {/* Prompt Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          askFutureOracle(input);
        }}
        className="p-2.5 border-t border-[#232936] bg-[#0e1116] flex items-center gap-2 shrink-0"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about 10-yr future, costs, roads, water..."
          className="flex-1 px-3 py-2 text-xs text-slate-100 bg-[#141820] border border-[#2a3140] rounded-md placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="px-3 py-2 bg-brand-500 hover:bg-brand-300 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-md transition-colors inline-flex items-center gap-1 shrink-0"
        >
          <Send className="w-3.5 h-3.5" /> Ask
        </button>
      </form>
    </aside>
  );
}
