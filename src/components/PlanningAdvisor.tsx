import { useEffect, useRef, useState } from 'react';
import { Send, RotateCcw, AlertCircle, Loader2 } from 'lucide-react';
import type { ChatMessage, ChatModelId, SiteAssessment } from '../types/site';

interface PlanningAdvisorProps {
  assessment: SiteAssessment | null;
  messages: ChatMessage[];
  selectedModel: ChatModelId;
  onModelChange: (model: ChatModelId) => void;
  onMessagesChange: (messages: ChatMessage[]) => void;
  compact?: boolean;
}

const MODEL_OPTIONS: Array<{ id: ChatModelId; label: string; roleNote: string }> = [
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (Free)', roleNote: 'General planning & site synthesis' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite (Free)', roleNote: 'Fast data lookup & quick checks' },
  { id: 'gemini-4-neon', label: 'Gemini 4 Neon', roleNote: 'Complex interactive cost modeling' },
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', roleNote: 'Deep climate & civil reasoning' },
];

const STARTER_PROMPTS = [
  'Which single environmental constraint poses the largest 10-to-25 year financial risk here?',
  'How should we orient buildings and green buffers to cut peak cooling demand?',
  'Should we relocate this project 10–15 km away or mitigate on-site?',
  'Explain the stormwater and drainage engineering needed for this terrain relief.',
];

export function PlanningAdvisor({
  assessment,
  messages,
  selectedModel,
  onModelChange,
  onMessagesChange,
  compact = false,
}: PlanningAdvisorProps) {
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  const buildSiteContextPayload = () => {
    if (!assessment) return null;
    const t = assessment.telemetry;
    return {
      site: t.query,
      overallSuitability: assessment.overallSuitability,
      overallVerdict: assessment.overallVerdict,
      pillars: assessment.pillars.map((p) => ({
        title: p.title,
        score: p.score,
        riskLevel: p.riskLevel,
        headline: `${p.headlineMetric} ${p.headlineUnit}`,
        findings: p.findings,
      })),
      climate: {
        tempDeltaC: t.climate.tempDeltaC,
        futureExtremeHeatDaysPerYr: t.climate.futureExtremeHeatDaysPerYr,
        precipChangePct: t.climate.precipChangePct,
      },
      elevation: {
        centerMeters: t.elevation.centerMeters,
        reliefMeters: t.elevation.reliefMeters,
        slopePct: t.elevation.estimatedSlopePct,
      },
      airQuality: t.airQuality,
      flood: t.flood,
      nasaSolarKwhM2Day: t.nasaPower.solarIrradianceKwhM2Day,
      landUse2Km: {
        greenFeaturesCount: t.landUse2Km.greenFeaturesCount,
        waterFeaturesCount: t.landUse2Km.waterFeaturesCount,
        urbanBuiltCount: t.landUse2Km.urbanBuiltCount,
        industrialCount: t.landUse2Km.industrialCount,
      },
      costProjectionInrCr: assessment.costProjection,
    };
  };

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || isSending) return;

    const userMsg: ChatMessage = {
      id: `${Date.now()}_u`,
      role: 'user',
      text: trimmed,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const nextMessages = [...messages, userMsg];
    onMessagesChange(nextMessages);
    setInput('');
    setIsSending(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: nextMessages.map((m) => ({ role: m.role, text: m.text })),
          siteContext: buildSiteContextPayload(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Chat request failed.');
      }

      const modelMsg: ChatMessage = {
        id: `${Date.now()}_m`,
        role: 'model',
        text: data.reply,
        model: selectedModel,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      onMessagesChange([...nextMessages, modelMsg]);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to reach Planning Advisor.');
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const containerClass = compact
    ? 'flex flex-col h-full bg-[#141820] border border-[#232936] rounded-lg overflow-hidden'
    : 'max-w-[1040px] mx-auto px-4 sm:px-6 py-6 h-[calc(100vh-80px)] flex flex-col';

  return (
    <div className={containerClass}>
      <div
        className={`flex flex-col flex-1 min-h-0 bg-[#141820] ${
          compact ? '' : 'border border-[#232936] rounded-lg overflow-hidden'
        }`}
      >
        <div className="px-4 py-3 border-b border-[#232936] bg-[#0e1116] text-white flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-display font-bold text-white">
              Urban Planning &amp; Climate Advisor
            </h2>
            <p className="text-xs text-brand-400">
              {assessment
                ? `Grounded in ${assessment.telemetry.query.label} (${assessment.overallSuitability}/100 suitability)`
                : 'Select or analyze a site to attach live telemetry context'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Select Gemini reasoning model"
              value={selectedModel}
              onChange={(e) => onModelChange(e.target.value as ChatModelId)}
              className="text-xs font-medium text-slate-100 bg-[#141820] border border-[#2a3140] rounded-md px-2.5 py-1.5 focus:outline-none focus:border-brand-500"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label} — {opt.roleNote}
                </option>
              ))}
            </select>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onMessagesChange([]);
                  setErrorMsg(null);
                }}
                title="Clear conversation"
                className="p-1.5 text-slate-300 hover:text-white border border-[#2a3140] bg-[#1a1f29] rounded-md"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0b0d11]">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col justify-center items-start max-w-xl mx-auto space-y-4 py-6">
              <div>
                <h3 className="text-base font-display font-bold text-white">
                  Ask about climate trade-offs, engineering fixes, or alternative siting
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Conversation history persists across turns and includes the active site’s Copernicus elevation, CMIP6 projections, CAMS air quality, GloFAS flood ratio, NASA solar insolation, and 25-year cost numbers.
                </p>
              </div>
              <div className="w-full space-y-2">
                {STARTER_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => sendMessage(q)}
                    className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-slate-200 bg-[#141820] hover:bg-brand-500/10 hover:border-brand-500/60 hover:text-white border border-[#232936] rounded-md transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className="text-[11px] font-mono text-slate-500 mb-1 px-1">
                  {msg.role === 'user' ? 'Planner' : msg.model || selectedModel} · {msg.timestamp}
                </div>
                <div
                  className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-brand-500 text-slate-950 font-medium'
                      : 'bg-[#141820] border border-[#232936] text-slate-200'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))
          )}

          {isSending && (
            <div className="flex items-center gap-2 text-xs text-slate-400 px-1">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
              <span>Evaluating site telemetry with {selectedModel}...</span>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2 p-3 bg-amber-950/40 border border-amber-500/40 rounded-md text-xs text-amber-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div ref={scrollEndRef} />
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-3 border-t border-[#232936] bg-[#0e1116] flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about heat mitigation, flood setbacks, CapEx ROI, or nearby alternatives..."
            className="flex-1 px-3 py-2 text-xs text-slate-100 bg-[#141820] border border-[#2a3140] rounded-md placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="px-3.5 py-2 bg-brand-500 hover:bg-brand-300 disabled:opacity-50 text-slate-950 text-xs font-bold rounded-md transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" /> Send
          </button>
        </form>
      </div>
    </div>
  );
}
