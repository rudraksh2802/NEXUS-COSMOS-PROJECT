import { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface MetricHelpTooltipProps {
  title: string;
  explanation: string;
  budgetImpact: string;
}

export function MetricHelpTooltip({
  title,
  explanation,
  budgetImpact,
}: MetricHelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <span
      ref={containerRef}
      className="relative inline-flex items-center align-middle print:hidden"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`Explain ${title}`}
        aria-expanded={open}
        className="inline-flex items-center justify-center p-0.5 text-slate-500 hover:text-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded transition-colors"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="tooltip"
          className="absolute left-0 bottom-full mb-2 z-50 w-64 sm:w-72 p-3 bg-[#141820] border border-[#2c3444] rounded-lg shadow-2xl text-left font-sans font-normal normal-case tracking-normal"
        >
          <div className="text-xs font-semibold text-white">{title}</div>
          <p className="text-[11px] text-slate-300 leading-relaxed mt-1">{explanation}</p>
          <div className="mt-2 pt-2 border-t border-[#232936] text-[11px] text-slate-200 bg-[#1a202c] p-2 rounded">
            <strong className="text-brand-400">Budget impact:</strong> {budgetImpact}
          </div>
        </div>
      )}
    </span>
  );
}
