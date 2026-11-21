import { useState } from 'react';
import type { SiteAssessment } from '../types/site';

export type ComparisonScenarioMode = 'baseline' | 'retrofit';

interface CompareChartsProps {
  siteA: SiteAssessment;
  siteB: SiteAssessment;
  scenarioMode: ComparisonScenarioMode;
}

type PieMode = 'lifecycle' | 'penalties';

interface PieSlice {
  label: string;
  value: number;
  color: string;
}

function describeArc(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  const x1 = cx + rOuter * Math.cos(startAngle);
  const y1 = cy + rOuter * Math.sin(startAngle);
  const x2 = cx + rOuter * Math.cos(endAngle);
  const y2 = cy + rOuter * Math.sin(endAngle);
  const x3 = cx + rInner * Math.cos(endAngle);
  const y3 = cy + rInner * Math.sin(endAngle);
  const x4 = cx + rInner * Math.cos(startAngle);
  const y4 = cy + rInner * Math.sin(startAngle);

  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function SingleSitePieChart({
  title,
  subtitle,
  slices,
  centerLabel,
  centerValue,
}: {
  title: string;
  subtitle: string;
  slices: PieSlice[];
  centerLabel: string;
  centerValue: string;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const total = Math.max(0.1, slices.reduce((acc, s) => acc + Math.max(0, s.value), 0));

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 82;
  const rInner = 48;

  let currentAngle = -Math.PI / 2;
  const paths = slices.map((slice, idx) => {
    const portion = Math.max(0, slice.value) / total;
    const sweep = Math.max(0.02, portion * Math.PI * 2);
    const startAngle = currentAngle;
    const endAngle = idx === slices.length - 1 ? -Math.PI / 2 + Math.PI * 2 - 0.001 : currentAngle + sweep;
    currentAngle += sweep;
    return {
      ...slice,
      pct: portion * 100,
      d: describeArc(cx, cy, hoveredIdx === idx ? rOuter + 4 : rOuter, rInner, startAngle, endAngle),
    };
  });

  const activeSlice = hoveredIdx !== null ? paths[hoveredIdx] : null;

  return (
    <div className="p-4 border border-[#232936] rounded-lg bg-[#0e1116] space-y-4">
      <div>
        <h4 className="text-sm font-display font-bold text-white truncate">{title}</h4>
        <p className="text-xs text-slate-400 truncate">{subtitle}</p>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-5">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-[180px] h-[180px] shrink-0 select-none">
          {paths.map((slice, idx) => (
            <path
              key={slice.label}
              d={slice.d}
              fill={slice.color}
              stroke="#0e1116"
              strokeWidth="2"
              className="transition-opacity cursor-pointer"
              opacity={hoveredIdx === null || hoveredIdx === idx ? 1 : 0.45}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          ))}
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            className="fill-slate-400 text-[10px] font-medium"
          >
            {activeSlice ? activeSlice.label.slice(0, 14) : centerLabel}
          </text>
          <text
            x={cx}
            y={cy + 13}
            textAnchor="middle"
            className="fill-white text-[15px] font-mono font-bold tabular-nums"
          >
            {activeSlice ? `₹${activeSlice.value.toFixed(1)} Cr` : centerValue}
          </text>
        </svg>

        <div className="w-full space-y-2">
          {paths.map((slice, idx) => (
            <div
              key={slice.label}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={`flex items-center justify-between gap-2 text-xs px-2 py-1 rounded transition-colors cursor-default ${
                hoveredIdx === idx ? 'bg-[#141820] border border-[#2a3140]' : ''
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-xs shrink-0"
                  style={{ backgroundColor: slice.color }}
                />
                <span className="text-slate-300 font-medium truncate">{slice.label}</span>
              </span>
              <span className="font-mono tabular-nums font-bold text-white shrink-0">
                ₹{slice.value.toFixed(1)} Cr ({slice.pct.toFixed(0)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CompareCharts({ siteA, siteB, scenarioMode }: CompareChartsProps) {
  const [pieMode, setPieMode] = useState<PieMode>('penalties');
  const [hoverMonthIdx, setHoverMonthIdx] = useState<number | null>(null);
  const [hoverYear, setHoverYear] = useState<number | null>(null);

  const shortA = siteA.telemetry.query.label.split('—')[0].split(',')[0].trim();
  const shortB = siteB.telemetry.query.label.split('—')[0].split(',')[0].trim();
  const isRetrofit = scenarioMode === 'retrofit';

  // 1. Pie chart slices
  const getSlices = (site: SiteAssessment): { slices: PieSlice[]; centerLabel: string; centerValue: string } => {
    const c = site.costProjection;
    const residualPenalty = Math.max(
      0,
      +(c.assumptions.reduce((acc, a) => acc + a.mitigatedInrCr, 0)).toFixed(1)
    );

    if (pieMode === 'lifecycle') {
      if (isRetrofit) {
        const totalBudget = c.baselineCapexInrCr + c.preventiveGreenCapexInrCr + residualPenalty;
        return {
          slices: [
            { label: 'Base Infra CapEx', value: c.baselineCapexInrCr, color: '#38bdf8' },
            { label: 'Preventive Green Infra', value: c.preventiveGreenCapexInrCr, color: '#5C99EE' },
            { label: 'Mitigated 25-Yr OpEx', value: residualPenalty, color: '#64748b' },
          ],
          centerLabel: 'Retrofit 25-Yr',
          centerValue: `₹${totalBudget.toFixed(0)} Cr`,
        };
      }
      const totalBaseline = c.baselineCapexInrCr + c.unmitigated25YrPenaltyInrCr;
      return {
        slices: [
          { label: 'Base Infra CapEx', value: c.baselineCapexInrCr, color: '#38bdf8' },
          { label: 'Unmitigated 25-Yr Penalty', value: c.unmitigated25YrPenaltyInrCr, color: '#ef4444' },
        ],
        centerLabel: 'Baseline 25-Yr',
        centerValue: `₹${totalBaseline.toFixed(0)} Cr`,
      };
    }

    const [hvac, flood, water, air] = c.assumptions;
    const pickVal = (item?: { unmitigatedInrCr: number; mitigatedInrCr: number }) =>
      isRetrofit ? item?.mitigatedInrCr ?? 0 : item?.unmitigatedInrCr ?? 0;

    return {
      slices: [
        { label: 'Cooling & UHI Load', value: pickVal(hvac), color: '#f97316' },
        { label: 'Flood & Drainage', value: pickVal(flood), color: '#38bdf8' },
        { label: 'Water & Aquifer', value: pickVal(water), color: '#5C99EE' },
        { label: 'Air Filtration', value: pickVal(air), color: '#eab308' },
      ],
      centerLabel: isRetrofit ? 'Mitigated OpEx' : '25-Yr Penalty',
      centerValue: `₹${(isRetrofit ? residualPenalty : c.unmitigated25YrPenaltyInrCr).toFixed(1)} Cr`,
    };
  };

  const pieDataA = getSlices(siteA);
  const pieDataB = getSlices(siteB);

  const residualA = +siteA.costProjection.assumptions.reduce((acc, a) => acc + a.mitigatedInrCr, 0).toFixed(1);
  const residualB = +siteB.costProjection.assumptions.reduce((acc, a) => acc + a.mitigatedInrCr, 0).toFixed(1);

  // 2. Grouped Budget & Infrastructure Bar Chart data
  const budgetMetrics = [
    {
      label: 'Base CapEx',
      valA: siteA.costProjection.baselineCapexInrCr,
      valB: siteB.costProjection.baselineCapexInrCr,
    },
    {
      label: 'Preventive Infra',
      valA: siteA.costProjection.preventiveGreenCapexInrCr,
      valB: siteB.costProjection.preventiveGreenCapexInrCr,
    },
    {
      label: isRetrofit ? 'Mitigated OpEx' : '25-Yr Unmitigated',
      valA: isRetrofit ? residualA : siteA.costProjection.unmitigated25YrPenaltyInrCr,
      valB: isRetrofit ? residualB : siteB.costProjection.unmitigated25YrPenaltyInrCr,
    },
    {
      label: 'Net Avoided Cost',
      valA: siteA.costProjection.net25YrAvoidedCostInrCr,
      valB: siteB.costProjection.net25YrAvoidedCostInrCr,
    },
  ];
  const maxBarVal = Math.max(
    10,
    ...budgetMetrics.flatMap((m) => [m.valA, m.valB])
  );

  const barW = 580;
  const barH = 240;
  const bPadL = 52;
  const bPadR = 16;
  const bPadT = 22;
  const bPadB = 36;
  const bPlotW = barW - bPadL - bPadR;
  const bPlotH = barH - bPadT - bPadB;

  // 3. 25-Year Cumulative Unmitigated vs Preventive Cost Trajectory
  const years = [0, 5, 10, 15, 20, 25];
  const calcCumulative = (site: SiteAssessment, yr: number) => {
    const frac = yr / 25;
    const accelFrac = 0.72 * frac + 0.28 * frac * frac;
    const unmitigated = +(site.costProjection.unmitigated25YrPenaltyInrCr * accelFrac).toFixed(1);
    const residual = site.costProjection.assumptions.reduce((acc, a) => acc + a.mitigatedInrCr, 0);
    const mitigatedTotal = +(
      site.costProjection.preventiveGreenCapexInrCr +
      residual * accelFrac
    ).toFixed(1);
    return { yr, unmitigated, mitigatedTotal };
  };

  const cumA = years.map((y) => calcCumulative(siteA, y));
  const cumB = years.map((y) => calcCumulative(siteB, y));
  const maxCum = Math.max(
    10,
    ...cumA.flatMap((d) => [d.unmitigated, d.mitigatedTotal]),
    ...cumB.flatMap((d) => [d.unmitigated, d.mitigatedTotal])
  );

  const lineW = 540;
  const lineH = 220;
  const lPadL = 48;
  const lPadR = 16;
  const lPadT = 18;
  const lPadB = 30;
  const lPlotW = lineW - lPadL - lPadR;
  const lPlotH = lineH - lPadT - lPadB;

  const cumX = (idx: number) => lPadL + (idx / (years.length - 1)) * lPlotW;
  const cumY = (val: number) => lPadT + lPlotH - (val / maxCum) * lPlotH;

  const buildPath = (pts: number[]) =>
    pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${cumX(i).toFixed(1)} ${cumY(v).toFixed(1)}`).join(' ');

  // 4. Monthly Peak Temperature Overlay Graph
  const seriesA = siteA.telemetry.climate.monthlySeries;
  const seriesB = siteB.telemetry.climate.monthlySeries;
  const monthCount = Math.min(seriesA.length, seriesB.length);
  const allTemps = [
    ...seriesA.map((d) => d.futureMaxC),
    ...seriesB.map((d) => d.futureMaxC),
  ];
  const minT = allTemps.length ? Math.floor(Math.min(...allTemps) / 5) * 5 : 15;
  const maxT = allTemps.length ? Math.ceil(Math.max(...allTemps) / 5) * 5 + 2 : 48;
  const tSpan = Math.max(5, maxT - minT);

  const txPos = (i: number) => lPadL + (i / Math.max(1, monthCount - 1)) * lPlotW;
  const tyPos = (t: number) => lPadT + lPlotH - ((t - minT) / tSpan) * lPlotH;

  const tempPathA = seriesA
    .slice(0, monthCount)
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${txPos(i).toFixed(1)} ${tyPos(d.futureMaxC).toFixed(1)}`)
    .join(' ');
  const tempPathB = seriesB
    .slice(0, monthCount)
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${txPos(i).toFixed(1)} ${tyPos(d.futureMaxC).toFixed(1)}`)
    .join(' ');

  const hoveredYrIdx = hoverYear !== null ? years.indexOf(hoverYear) : -1;

  return (
    <div className="space-y-6">
      {/* Row 1: Pie / Donut Charts for Budget & Infrastructure Cost Breakdown */}
      <section className="bg-[#141820] border border-[#232936] rounded-lg p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#232936] pb-3">
          <div>
            <h3 className="text-base font-display font-bold text-white">
              Budget &amp; Infrastructure Cost Distribution (Pie Charts)
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Hover any slice to inspect exact ₹ Crore allocations across {shortA} and {shortB}.
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#0e1116] border border-[#232936] rounded-md self-start sm:self-auto">
            <button
              type="button"
              onClick={() => setPieMode('penalties')}
              className={`px-3 py-1.5 text-xs font-bold rounded-sm transition-colors whitespace-nowrap shrink-0 ${
                pieMode === 'penalties'
                  ? 'bg-brand-500 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Infrastructure Penalty Split
            </button>
            <button
              type="button"
              onClick={() => setPieMode('lifecycle')}
              className={`px-3 py-1.5 text-xs font-bold rounded-sm transition-colors whitespace-nowrap shrink-0 ${
                pieMode === 'lifecycle'
                  ? 'bg-brand-500 text-slate-950'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Total Budget Split
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SingleSitePieChart
            title={`Location A: ${shortA}`}
            subtitle={`${siteA.telemetry.query.projectType.replace(/_/g, ' ')} · ${siteA.telemetry.query.areaHectares} ha`}
            slices={pieDataA.slices}
            centerLabel={pieDataA.centerLabel}
            centerValue={pieDataA.centerValue}
          />
          <SingleSitePieChart
            title={`Location B: ${shortB}`}
            subtitle={`${siteB.telemetry.query.projectType.replace(/_/g, ' ')} · ${siteB.telemetry.query.areaHectares} ha`}
            slices={pieDataB.slices}
            centerLabel={pieDataB.centerLabel}
            centerValue={pieDataB.centerValue}
          />
        </div>
      </section>

      {/* Row 2: Grouped Bar Chart (Budgets & Costs) + 5-Pillar Suitability Bars */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Grouped Budget & Infrastructure Cost Bar Chart */}
        <section className="xl:col-span-7 bg-[#141820] border border-[#232936] rounded-lg p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-display font-bold text-white">
                Budget, Infrastructure &amp; Avoided Cost Comparison (Bar Chart)
              </h3>
              <p className="text-xs text-slate-400">
                Side-by-side ₹ Crore comparison across upfront CapEx, resilience infra, and 25-year savings
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-sky-300">
                <span className="inline-block w-3 h-3 bg-sky-400 rounded-xs" />
                {shortA}
              </span>
              <span className="flex items-center gap-1.5 text-brand-400">
                <span className="inline-block w-3 h-3 bg-brand-500 rounded-xs" />
                {shortB}
              </span>
            </div>
          </div>

          <svg viewBox={`0 0 ${barW} ${barH}`} className="w-full h-auto overflow-visible select-none">
            {[0, 0.25, 0.5, 0.75, 1].map((step) => {
              const val = step * maxBarVal;
              const y = bPadT + bPlotH - step * bPlotH;
              return (
                <g key={step}>
                  <line x1={bPadL} y1={y} x2={barW - bPadR} y2={y} stroke="#232936" strokeWidth="1" />
                  <text
                    x={bPadL - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono tabular-nums"
                  >
                    ₹{val.toFixed(0)}
                  </text>
                </g>
              );
            })}

            {budgetMetrics.map((m, idx) => {
              const groupW = bPlotW / budgetMetrics.length;
              const groupCenter = bPadL + groupW * idx + groupW / 2;
              const singleW = Math.min(34, groupW * 0.3);
              const gap = 6;
              const hA = (m.valA / maxBarVal) * bPlotH;
              const hB = (m.valB / maxBarVal) * bPlotH;
              const yA = bPadT + bPlotH - hA;
              const yB = bPadT + bPlotH - hB;

              return (
                <g key={m.label}>
                  <rect
                    x={groupCenter - singleW - gap / 2}
                    y={yA}
                    width={singleW}
                    height={Math.max(2, hA)}
                    rx="2"
                    fill="#38bdf8"
                  />
                  <text
                    x={groupCenter - singleW / 2 - gap / 2}
                    y={yA - 5}
                    textAnchor="middle"
                    className="fill-sky-300 text-[9px] font-mono font-bold tabular-nums"
                  >
                    {m.valA.toFixed(0)}
                  </text>

                  <rect
                    x={groupCenter + gap / 2}
                    y={yB}
                    width={singleW}
                    height={Math.max(2, hB)}
                    rx="2"
                    fill="#5C99EE"
                  />
                  <text
                    x={groupCenter + singleW / 2 + gap / 2}
                    y={yB - 5}
                    textAnchor="middle"
                    className="fill-brand-400 text-[9px] font-mono font-bold tabular-nums"
                  >
                    {m.valB.toFixed(0)}
                  </text>

                  <text
                    x={groupCenter}
                    y={barH - 12}
                    textAnchor="middle"
                    className="fill-slate-300 text-[10px] font-semibold"
                  >
                    {m.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </section>

        {/* Five-Pillar Suitability Horizontal Bar Chart */}
        <section className="xl:col-span-5 bg-[#141820] border border-[#232936] rounded-lg p-5 space-y-4">
          <div>
            <h3 className="text-base font-display font-bold text-white">
              Five-Pillar Suitability Score Bars{' '}
              <span className="text-xs font-medium text-brand-400">
                ({isRetrofit ? 'Post-Retrofit Projection' : 'Baseline'})
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              0–100 score per pillar (higher score indicates lower long-term site risk)
            </p>
          </div>

          <div className="space-y-3.5">
            {siteA.pillars.map((pillarA, idx) => {
              const pillarB = siteB.pillars[idx];
              const boost = isRetrofit && pillarA.id !== 'geography' ? 11 : isRetrofit ? 7 : 0;
              const scoreA = Math.min(96, pillarA.score + boost);
              const scoreB = Math.min(96, (pillarB?.score ?? 0) + boost);
              const diff = scoreA - scoreB;
              return (
                <div key={pillarA.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">{pillarA.title}</span>
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">
                      {diff === 0
                        ? 'Tied'
                        : diff > 0
                          ? `${shortA} +${diff} pts`
                          : `${shortB} +${Math.abs(diff)} pts`}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-20 text-[11px] font-medium text-sky-300 truncate">
                        {shortA}
                      </span>
                      <div className="flex-1 h-2.5 bg-[#0e1116] border border-[#232936] rounded-xs overflow-hidden">
                        <div
                          className="h-full bg-sky-400 rounded-xs transition-all"
                          style={{ width: `${scoreA}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-[11px] font-mono tabular-nums font-bold text-sky-300">
                        {scoreA}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="w-20 text-[11px] font-medium text-brand-400 truncate">
                        {shortB}
                      </span>
                      <div className="flex-1 h-2.5 bg-[#0e1116] border border-[#232936] rounded-xs overflow-hidden">
                        <div
                          className="h-full bg-brand-500 rounded-xs transition-all"
                          style={{ width: `${scoreB}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-[11px] font-mono tabular-nums font-bold text-brand-400">
                        {scoreB}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Row 3: 25-Year Cumulative Cost Graph + 12-Month Temperature Trajectory Comparison Graph */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* 25-Year Cumulative Infrastructure Penalty vs Preventive Total Cost */}
        <section className="bg-[#141820] border border-[#232936] rounded-lg p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-display font-bold text-white">
                25-Year Cumulative Climate &amp; Infra Penalty Graph
              </h3>
              <p className="text-xs text-slate-400">
                Solid lines: unmitigated penalty · Dashed lines: preventive green infra + mitigated OpEx
              </p>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${lineW} ${lineH}`}
            className="w-full h-auto overflow-visible select-none"
            onMouseLeave={() => setHoverYear(null)}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((step) => {
              const val = step * maxCum;
              const y = cumY(val);
              return (
                <g key={step}>
                  <line x1={lPadL} y1={y} x2={lineW - lPadR} y2={y} stroke="#232936" strokeWidth="1" />
                  <text
                    x={lPadL - 6}
                    y={y + 3}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-mono tabular-nums"
                  >
                    ₹{val.toFixed(0)}
                  </text>
                </g>
              );
            })}

            <path
              d={buildPath(cumA.map((d) => d.unmitigated))}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2.5"
            />
            <path
              d={buildPath(cumA.map((d) => d.mitigatedTotal))}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.75"
              strokeDasharray="4 3"
            />

            <path
              d={buildPath(cumB.map((d) => d.unmitigated))}
              fill="none"
              stroke="#5C99EE"
              strokeWidth="2.5"
            />
            <path
              d={buildPath(cumB.map((d) => d.mitigatedTotal))}
              fill="none"
              stroke="#5C99EE"
              strokeWidth="1.75"
              strokeDasharray="4 3"
            />

            {years.map((yr, idx) => {
              const x = cumX(idx);
              const isHover = hoverYear === yr;
              return (
                <g key={yr}>
                  <text
                    x={x}
                    y={lineH - 8}
                    textAnchor="middle"
                    className={`text-[10px] font-mono ${
                      isHover ? 'fill-brand-400 font-bold' : 'fill-slate-400'
                    }`}
                  >
                    Yr {yr}
                  </text>
                  {isHover && (
                    <line
                      x1={x}
                      y1={lPadT}
                      x2={x}
                      y2={lPadT + lPlotH}
                      stroke="#64748b"
                      strokeDasharray="2 2"
                    />
                  )}
                  <circle cx={x} cy={cumY(cumA[idx].unmitigated)} r={isHover ? 4.5 : 3} fill="#38bdf8" />
                  <circle cx={x} cy={cumY(cumB[idx].unmitigated)} r={isHover ? 4.5 : 3} fill="#5C99EE" />
                  <rect
                    x={x - lPlotW / 12}
                    y={lPadT}
                    width={lPlotW / 6}
                    height={lPlotH + 20}
                    fill="transparent"
                    onMouseEnter={() => setHoverYear(yr)}
                  />
                </g>
              );
            })}
          </svg>

          <div className="pt-2 border-t border-[#232936] flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-300 min-h-[26px]">
            {hoveredYrIdx >= 0 ? (
              <>
                <span className="font-bold text-brand-400">Year {years[hoveredYrIdx]} Cumulative</span>
                <span>
                  {shortA}: ₹{cumA[hoveredYrIdx].unmitigated} Cr unmitigated / ₹{cumA[hoveredYrIdx].mitigatedTotal} Cr mitigated
                </span>
                <span>
                  {shortB}: ₹{cumB[hoveredYrIdx].unmitigated} Cr unmitigated / ₹{cumB[hoveredYrIdx].mitigatedTotal} Cr mitigated
                </span>
              </>
            ) : (
              <span className="text-slate-500">
                Hover year markers (Yr 0–Yr 25) to compare cumulative unmitigated vs preventive spend.
              </span>
            )}
          </div>
        </section>

        {/* 12-Month Future Peak Temperature Comparison Graph */}
        <section className="bg-[#141820] border border-[#232936] rounded-lg p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-display font-bold text-white">
                Monthly Peak Temperature Comparison ({siteA.telemetry.query.horizonYear})
              </h3>
              <p className="text-xs text-slate-400">
                CMIP6 projected monthly peak °C for {shortA} vs {shortB}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold">
              <span className="flex items-center gap-1.5 text-sky-300">
                <span className="inline-block w-3.5 border-t-2 border-sky-400" />
                {shortA}
              </span>
              <span className="flex items-center gap-1.5 text-brand-400">
                <span className="inline-block w-3.5 border-t-2 border-brand-500" />
                {shortB}
              </span>
            </div>
          </div>

          {monthCount === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-xs text-slate-500 border border-dashed border-[#2a3140] rounded-md">
              Monthly climate comparison unavailable for one or both sites.
            </div>
          ) : (
            <>
              <svg
                viewBox={`0 0 ${lineW} ${lineH}`}
                className="w-full h-auto overflow-visible select-none"
                onMouseLeave={() => setHoverMonthIdx(null)}
              >
                {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                  const tVal = minT + step * tSpan;
                  const y = tyPos(tVal);
                  return (
                    <g key={step}>
                      <line x1={lPadL} y1={y} x2={lineW - lPadR} y2={y} stroke="#232936" strokeWidth="1" />
                      <text
                        x={lPadL - 6}
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
                      x1={lPadL}
                      y1={tyPos(40)}
                      x2={lineW - lPadR}
                      y2={tyPos(40)}
                      stroke="#ef4444"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    <text
                      x={lineW - lPadR}
                      y={tyPos(40) - 4}
                      textAnchor="end"
                      className="fill-rose-400 text-[9px] font-mono font-semibold"
                    >
                      40°C Extreme Heat
                    </text>
                  </g>
                )}

                <path d={tempPathA} fill="none" stroke="#38bdf8" strokeWidth="2.25" />
                <path d={tempPathB} fill="none" stroke="#5C99EE" strokeWidth="2.25" />

                {seriesA.slice(0, monthCount).map((d, idx) => {
                  const x = txPos(idx);
                  const isHover = hoverMonthIdx === idx;
                  return (
                    <g key={d.month}>
                      <text
                        x={x}
                        y={lineH - 8}
                        textAnchor="middle"
                        className={`text-[10px] font-mono ${
                          isHover ? 'fill-brand-400 font-bold' : 'fill-slate-400'
                        }`}
                      >
                        {d.month}
                      </text>
                      {isHover && (
                        <line
                          x1={x}
                          y1={lPadT}
                          x2={x}
                          y2={lPadT + lPlotH}
                          stroke="#64748b"
                          strokeDasharray="2 2"
                        />
                      )}
                      <circle cx={x} cy={tyPos(d.futureMaxC)} r={isHover ? 4.5 : 2.5} fill="#38bdf8" />
                      <circle
                        cx={x}
                        cy={tyPos(seriesB[idx].futureMaxC)}
                        r={isHover ? 4.5 : 2.5}
                        fill="#5C99EE"
                      />
                      <rect
                        x={x - lPlotW / 24}
                        y={lPadT}
                        width={lPlotW / 12}
                        height={lPlotH + 20}
                        fill="transparent"
                        onMouseEnter={() => setHoverMonthIdx(idx)}
                      />
                    </g>
                  );
                })}
              </svg>

              <div className="pt-2 border-t border-[#232936] flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums text-slate-300 min-h-[26px]">
                {hoverMonthIdx !== null ? (
                  <>
                    <span className="font-bold text-white">
                      {seriesA[hoverMonthIdx].month} Comparison
                    </span>
                    <span className="text-sky-300">
                      {shortA}: <strong>{seriesA[hoverMonthIdx].futureMaxC.toFixed(1)}°C</strong> (
                      {seriesA[hoverMonthIdx].futurePrecipMm} mm)
                    </span>
                    <span className="text-brand-400">
                      {shortB}: <strong>{seriesB[hoverMonthIdx].futureMaxC.toFixed(1)}°C</strong> (
                      {seriesB[hoverMonthIdx].futurePrecipMm} mm)
                    </span>
                  </>
                ) : (
                  <span className="text-slate-500">
                    Move cursor across months to compare peak heat and rainfall across both locations.
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
