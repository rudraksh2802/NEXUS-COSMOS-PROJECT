import { useState, useEffect } from 'react';
import { Download, Image as ImageIcon, Maximize2, X, AlertCircle, Loader2 } from 'lucide-react';
import {
  BENCHMARK_CORRIDORS,
  type GeneratedConcept,
  type ImageAspectRatio,
  type ImageSizeOption,
  type SiteAssessment,
} from '../types/site';

interface ConceptStudioProps {
  assessment: SiteAssessment | null;
  concepts: GeneratedConcept[];
  onConceptCreated: (concept: GeneratedConcept) => void;
}

const MITIGATION_PRESETS = [
  {
    id: 'cool-township',
    label: 'Heat-Resilient Courtyard Township',
    template: (loc: string, tempDelta: string, aqi: string) =>
      `High-resolution aerial architectural visualization of a heat-resilient residential township in ${loc}, designed to counter +${tempDelta}°C warming and AQI ${aqi}. Features shaded courtyard clusters, high-albedo cool white roofs, dense native tree canopies, rooftop solar arrays, and permeable stone alleys in crisp natural daylight.`,
  },
  {
    id: 'sponge-flood-park',
    label: 'Sponge-City Flood & Wetland Buffer',
    template: (loc: string, _tempDelta: string, _aqi: string) =>
      `High-resolution aerial architectural rendering of an urban sponge-city green infrastructure corridor in ${loc}, featuring terraced retention wetlands, bioswale drainage parks, elevated boardwalks, and flood-resilient mid-rise eco-buildings in clear morning light.`,
  },
  {
    id: 'solar-commercial',
    label: 'Solar-Shaded Medical & Civic Spine',
    template: (loc: string, tempDelta: string, _aqi: string) =>
      `High-resolution aerial architectural visualization of a sustainable low-carbon medical campus and commercial hub in ${loc} engineered for +${tempDelta}°C climate resilience, with cantilevered photovoltaic solar canopies shading pedestrian plazas, living green facades, misted microclimate courtyards, and rainwater harvesting cisterns.`,
  },
];

export function ConceptStudio({ assessment, concepts, onConceptCreated }: ConceptStudioProps) {
  const siteLabel = assessment?.telemetry.query.label || 'New Delhi — Dwarka Fringe';
  const tempDelta = assessment?.telemetry.climate.tempDeltaC?.toFixed(1) || '1.8';
  const aqi = assessment?.telemetry.airQuality.usAqi
    ? String(Math.round(assessment.telemetry.airQuality.usAqi))
    : '145';

  const [selectedPreset, setSelectedPreset] = useState(MITIGATION_PRESETS[0].id);
  const [prompt, setPrompt] = useState(() =>
    MITIGATION_PRESETS[0].template(siteLabel, tempDelta, aqi)
  );
  const [imageSize, setImageSize] = useState<ImageSizeOption>('1K');
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>('16:9');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lightboxItem, setLightboxItem] = useState<{
    url: string;
    title: string;
    subtitle: string;
  } | null>(null);

  useEffect(() => {
    const preset =
      MITIGATION_PRESETS.find((p) => p.id === selectedPreset) || MITIGATION_PRESETS[0];
    setPrompt(preset.template(siteLabel, tempDelta, aqi));
  }, [siteLabel, tempDelta, aqi, selectedPreset]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setErrorMsg(null);

    try {
      const res = await fetch('/api/ai/generate-concept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim(), imageSize, aspectRatio }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Concept generation failed.');
      }

      const presetName =
        MITIGATION_PRESETS.find((p) => p.id === selectedPreset)?.label || 'Custom Urban Concept';
      onConceptCreated({
        id: `${Date.now()}`,
        siteLabel,
        prompt: prompt.trim(),
        strategyLabel: presetName,
        imageSize,
        aspectRatio,
        imageUrl: data.imageUrl,
        caption: data.caption,
        createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to generate concept rendering.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-[1360px] mx-auto px-4 sm:px-6 py-6 space-y-8">
      <div className="border-b border-[#232936] pb-5">
        <h1 className="text-2xl font-display font-extrabold text-white tracking-tight">
          Preventive Urban Design Concept Studio
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Render site-specific mitigation architecture grounded in {siteLabel} telemetry using{' '}
          <span className="font-mono text-xs text-brand-400 font-semibold">
            gemini-3-pro-image-preview
          </span>{' '}
          at 1K, 2K, or 4K resolution.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleGenerate}
          className="lg:col-span-5 bg-[#141820] border border-[#232936] rounded-lg p-5 space-y-5"
        >
          <div>
            <label className="block text-xs font-bold text-slate-200 mb-2">
              Mitigation Strategy Preset
            </label>
            <div className="grid grid-cols-1 gap-2">
              {MITIGATION_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedPreset(preset.id)}
                  className={`text-left px-3 py-2.5 rounded-md border text-xs font-semibold transition-colors ${
                    selectedPreset === preset.id
                      ? 'border-brand-500/70 bg-brand-500/10 text-brand-300'
                      : 'border-[#232936] bg-[#0e1116] text-slate-300 hover:border-[#3b4459] hover:text-white'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-200 mb-2">
                Output Resolution
              </label>
              <div className="flex items-center gap-1 p-1 bg-[#0e1116] border border-[#232936] rounded-md">
                {(['1K', '2K', '4K'] as ImageSizeOption[]).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setImageSize(sz)}
                    className={`flex-1 py-1.5 text-xs font-mono font-bold rounded-sm transition-colors ${
                      imageSize === sz
                        ? 'bg-brand-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-200 mb-2">Aspect Ratio</label>
              <div className="flex items-center gap-1 p-1 bg-[#0e1116] border border-[#232936] rounded-md">
                {(['16:9', '4:3', '1:1'] as ImageAspectRatio[]).map((ar) => (
                  <button
                    key={ar}
                    type="button"
                    onClick={() => setAspectRatio(ar)}
                    className={`flex-1 py-1.5 text-xs font-mono font-bold rounded-sm transition-colors ${
                      aspectRatio === ar
                        ? 'bg-brand-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {ar}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label htmlFor="concept-prompt" className="block text-xs font-bold text-slate-200 mb-1.5">
              Architectural &amp; Ecological Prompt
            </label>
            <textarea
              id="concept-prompt"
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full px-3 py-2 text-xs leading-relaxed text-slate-100 bg-[#0e1116] border border-[#2a3140] rounded-md placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
              placeholder="Describe the preventive urban masterplan to render..."
            />
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3 bg-amber-950/40 border border-amber-500/40 rounded-md text-xs text-amber-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isGenerating || !prompt.trim()}
            className="w-full py-2.5 px-4 bg-brand-500 hover:bg-brand-300 disabled:opacity-60 text-slate-950 text-xs font-bold rounded-md transition-colors flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Rendering {imageSize} Concept...
              </>
            ) : (
              <>
                <ImageIcon className="w-4 h-4" /> Generate {imageSize} Site Rendering
              </>
            )}
          </button>
        </form>

        <div className="lg:col-span-7 space-y-6">
          {concepts.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-display font-bold text-white">
                Session Generated Concept Renders ({concepts.length})
              </h2>
              <div className="grid grid-cols-1 gap-4">
                {concepts.map((item) => (
                  <div
                    key={item.id}
                    className="bg-[#141820] border border-[#232936] rounded-lg overflow-hidden"
                  >
                    <div className="relative bg-[#0e1116] aspect-video">
                      <img
                        src={item.imageUrl}
                        alt={item.strategyLabel}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-3 right-3 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setLightboxItem({
                              url: item.imageUrl,
                              title: `${item.siteLabel} — ${item.strategyLabel}`,
                              subtitle: `${item.imageSize} · ${item.aspectRatio} · ${item.createdAt}`,
                            })
                          }
                          className="p-2 bg-[#0e1116]/90 backdrop-blur-md border border-[#2a3140] rounded-md text-slate-200 hover:text-brand-400 shadow-lg"
                          title="Expand view"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                        <a
                          href={item.imageUrl}
                          download={`terrasight_${item.imageSize.toLowerCase()}_${item.id}.png`}
                          className="p-2 bg-[#0e1116]/90 backdrop-blur-md border border-[#2a3140] rounded-md text-slate-200 hover:text-brand-400 shadow-lg"
                          title="Download image"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                    <div className="p-4">
                      <div className="text-xs text-slate-400 font-mono">
                        {item.siteLabel} · {item.imageSize} · {item.aspectRatio} · {item.createdAt}
                      </div>
                      <h3 className="text-sm font-bold text-white mt-1">
                        {item.strategyLabel}
                      </h3>
                      {item.caption && <p className="text-xs text-slate-300 mt-1">{item.caption}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-display font-bold text-white">
                Indian Urban Corridor Mitigation Reference Plates
              </h2>
              <p className="text-xs text-slate-400">
                Bioclimatic planning archetypes for New Delhi, Bengaluru, and Ahmedabad corridors.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {BENCHMARK_CORRIDORS.map((corridor) => (
                <div
                  key={corridor.id}
                  className="bg-[#141820] border border-[#232936] rounded-lg overflow-hidden flex flex-col"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setLightboxItem({
                        url: corridor.previewImage,
                        title: corridor.name,
                        subtitle: corridor.corridor,
                      })
                    }
                    className="relative aspect-video bg-[#0e1116] overflow-hidden group text-left"
                  >
                    <img
                      src={corridor.previewImage}
                      alt={corridor.name}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                    />
                  </button>
                  <div className="p-3.5 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="text-xs font-mono font-bold text-brand-400">
                        {corridor.city}
                      </div>
                      <h3 className="text-xs font-bold text-white mt-0.5">
                        {corridor.corridor}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                        {corridor.focusSummary}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 bg-[#0b0d11]/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxItem(null)}
        >
          <div
            className="bg-[#141820] rounded-lg max-w-5xl w-full overflow-hidden border border-[#2a3140] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#232936]">
              <div>
                <h3 className="text-sm font-bold text-white">{lightboxItem.title}</h3>
                <p className="text-xs text-slate-400">{lightboxItem.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setLightboxItem(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-[#0b0d11] max-h-[75vh] overflow-hidden flex items-center justify-center">
              <img
                src={lightboxItem.url}
                alt={lightboxItem.title}
                referrerPolicy="no-referrer"
                className="max-h-[75vh] w-auto object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
