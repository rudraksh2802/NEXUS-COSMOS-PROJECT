import { useState } from 'react';
import type { MonthlyClimatePoint, PillarEvaluation } from '../types/site';

interface ClimateChartsProps {
  monthlySeries: MonthlyClimatePoint[];
  horizonYear: number;
  pillars: PillarEvaluation[];
}

export function ClimateCharts({ monthlySeries, horizonYear, pillars }: ClimateChartsProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const width = 560;
  const height = 220;
  const padL = 42;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const temps = monthlySeries.flatMap((d) => [d.historicalMaxC, d.futureMaxC]);
  const minT = temps.length ? Math.floor(Math.min(...temps) / 5) * 5 : 10;
  const maxT = temps.length ? Math.ceil(Math.max(...temps) / 5) * 5 + 2 : 48;
  const tSpan = Math.max(5, maxT - minT);

  const xPos = (i: number) => padL + (i / Math.max(1, monthlySeries.length - 1)) * plotW;
  const yPos = (t: number) => padT + plotH - ((t - minT) / tSpan) * plotH;

  const histPath = monthlySeries
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(d.historicalMaxC).toFixed(1)}`)
    .join(' ');

  const futPath = monthlySeries
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i).toFixed(1)} ${yPos(d.futureMaxC).toFixed(1)}`)
    .join(' ');

  const areaPath =
    monthlySeries.length > 1
      ? `${futPath} L ${xPos(monthlySeries.length - 1).toFixed(1)} ${yPos(minT).toFixed(1)} L ${xPos(0).toFixed(
          1
        )} ${yPos(minT).toFixed(1)} Z`
      : '';

  const hovered = hoverIdx !== null ? monthlySeries[hoverIdx] : null;

  const radarSize = 230;
  const cx = radarSize / 2;
  const cy = radarSize / 2;
  const rMax = 78;
  const angles = pillars.map((_, idx) => -Math.PI / 2 + (idx * 2 * Math.PI) / Math.max(1, pillars.length));

  const radarPoint = (ratio: number, angle: number) => ({
    x: cx + Math.cos(angle) * rMax * ratio,
    y: cy + Math.sin(angle) * rMax * ratio,
  });

  const radarPolygon =
    pillars
      .map((p, idx) => {
        const pt = radarPoint(p.score / 100, angles[idx]);
        return `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
      })
      .join(' ') + ' Z';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      {/* Thermal Trajectory SVG Chart */}
      <div className="xl:col-span-7 bg-[#141820] border border-[#232936] rounded-lg p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <h3 className="text-sm font-display font-bold text-white">
              CMIP6 Monthly Peak Temperature Trajectory
            </h3>
            <p className="text-xs text-slate-400">
              Baseline (2000–2004) vs. {horizonYear} Projection · Hover points for rainfall shift
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3.5 border-t-2 border-dashed border-slate-500" />
              2000–04
            </span>
            <span className="flex items-center gap-1.5 text-sky-300">
              <span className="inline-block w-3.5 border-t-2 border-sky-400" />
              {horizonYear} Projected
            </span>
          </div>
        </div>

        {monthlySeries.length === 0 ? (
          <div className="h-[220px] flex items-center justify-center text-xs text-slate-500 border border-dashed border-[#2a3140] rounded-md">
            Monthly CMIP6 trajectory unavailable for these coordinates.
          </div>
        ) : (
          <div className="relative">
            <svg
              viewBox={`0 0 ${width} ${height}`}
              className="w-full h-auto overflow-visible select-none"
              onMouseLeave={() => setHoverIdx(null)}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                const tVal = minT + step * tSpan;
                const y = yPos(tVal);
                return (
                  <g key={step}>
                    <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#232936" strokeWidth="1" />
                    <text
                      x={padL - 8}
                      y={y + 3}
                      textAnchor="end"
                      className="fill-slate-400 text-[10px] font-mono tabular-nums"
                    >
                      {tVal.toFixed(0)}°
                    </text>
                  </g>
                );
              })}

              {40 >= minT && 40 <= maxT && (
                <g>
                  <line
                    x1={padL}
                    y1={yPos(40)}
                    x2={width - padR}
                    y2={yPos(40)}
                    stroke="#f97316"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  <text
                    x={width - padR}
                    y={yPos(40) - 4}
                    textAnchor="end"
                    className="fill-orange-400 text-[9px] font-mono font-semibold"
                  >
                    40°C Heat Stress Threshold
                  </text>
                </g>
              )}

              {areaPath && <path d={areaPath} fill="#38bdf8" fillOpacity="0.1" />}

              <path
                d={histPath}
                fill="none"
                stroke="#64748b"
                strokeWidth="1.75"
                strokeDasharray="4 3"
              />

              <path d={futPath} fill="none" stroke="#38bdf8" strokeWidth="2.25" />

              {monthlySeries.map((d, i) => {
                const cxPt = xPos(i);
                const cyFut = yPos(d.futureMaxC);
                const cyHist = yPos(d.historicalMaxC);
                const isHovered = hoverIdx === i;
                return (
                  <g key={d.month}>
                    <text
                      x={cxPt}
                      y={height - 8}
                      textAnchor="middle"
                      className={`text-[10px] font-mono ${
                        isHovered ? 'fill-brand-400 font-bold' : 'fill-slate-400'
                      }`}
                    >
                      {d.month}
                    </text>
                    {isHovered && (
                      <line
                        x1={cxPt}
                        y1={padT}
                        x2={cxPt}
                        y2={padT + plotH}
                        stroke="#5C99EE"
                        strokeWidth="1.25"
                        strokeDasharray="2 2"
                      />
                    )}
                    <circle cx={cxPt} cy={cyHist} r={isHovered ? 4 : 2.5} fill="#64748b" />
                    <circle
                      cx={cxPt}
                      cy={cyFut}
                      r={isHovered ? 5 : 3}
                      fill="#5C99EE"
                      stroke="#141820"
                      strokeWidth="1.5"
                    />
                    <rect
                      x={cxPt - plotW / 24}
                      y={padT}
                      width={plotW / 12}
                      height={plotH + 20}
                      fill="transparent"
                      onMouseEnter={() => setHoverIdx(i)}
                    />
                  </g>
                );
              })}
            </svg>

            <div className="mt-2 pt-2 border-t border-[#232936] flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-300 min-h-[26px]">
              {hovered ? (
                <>
                  <span className="font-bold text-brand-400">{hovered.month} Snapshot</span>
                  <span>
                    Max Temp: {hovered.historicalMaxC.toFixed(1)}°C →{' '}
                    <strong className="text-white">{hovered.futureMaxC.toFixed(1)}°C</strong> (
                    <span className="text-orange-400">
                      {hovered.futureMaxC - hovered.historicalMaxC >= 0 ? '+' : ''}
                      {(hovered.futureMaxC - hovered.historicalMaxC).toFixed(1)}°C
                    </span>
                    )
                  </span>
                  <span>
                    Rainfall: {hovered.historicalPrecipMm} mm → {hovered.futurePrecipMm} mm
                  </span>
                </>
              ) : (
                <span className="text-slate-500">
                  Move cursor across months to inspect exact temperature delta and rainfall shift.
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 5-Axis Suitability Radar Chart */}
      <div className="xl:col-span-5 bg-[#141820] border border-[#232936] rounded-lg p-5 flex flex-col justify-between">
        <div>
          <h3 className="text-sm font-display font-bold text-white">
            Five-Pillar Site Suitability
          </h3>
          <p className="text-xs text-slate-400">0–100 scale (higher = lower future structural risk)</p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 my-2">
          <svg viewBox={`0 0 ${radarSize} ${radarSize}`} className="w-[210px] h-[210px] shrink-0">
            {[0.25, 0.5, 0.75, 1].map((ring) => {
              const path =
                angles
                  .map((a, idx) => {
                    const pt = radarPoint(ring, a);
                    return `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
                  })
                  .join(' ') + ' Z';
              return <path key={ring} d={path} fill="none" stroke="#232936" strokeWidth="1" />;
            })}

            {angles.map((a, idx) => {
              const outer = radarPoint(1, a);
              const lbl = radarPoint(1.22, a);
              const shortNames = ['Climate', 'Environ.', 'Geo', 'Sustain.', 'Feasib.'];
              return (
                <g key={idx}>
                  <line x1={cx} y1={cy} x2={outer.x} y2={outer.y} stroke="#2a3140" strokeWidth="1" />
                  <text
                    x={lbl.x}
                    y={lbl.y + 3}
                    textAnchor="middle"
                    className="fill-slate-300 text-[9px] font-mono font-semibold uppercase"
                  >
                    {shortNames[idx] || pillars[idx]?.title}
                  </text>
                </g>
              );
            })}

            <path d={radarPolygon} fill="#5C99EE" fillOpacity="0.2" stroke="#5C99EE" strokeWidth="2" />

            {pillars.map((p, idx) => {
              const pt = radarPoint(p.score / 100, angles[idx]);
              return (
                <circle
                  key={p.id}
                  cx={pt.x}
                  cy={pt.y}
                  r="3.5"
                  fill="#87b5f4"
                  stroke="#141820"
                  strokeWidth="1.5"
                />
              );
            })}
          </svg>

          <div className="w-full space-y-2">
            {pillars.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between text-xs border-b border-[#232936] pb-1.5 last:border-b-0"
              >
                <span className="text-slate-300 font-medium truncate pr-2">{p.title}</span>
                <span className="font-mono tabular-nums font-bold text-brand-400 shrink-0">
                  {p.score}/100
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
