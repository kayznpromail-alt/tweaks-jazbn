import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { CATALOG } from '@/lib/catalog';

const PROVIDER_COLORS: Record<string, { bg: string; color: string }> = {
  GPT: { bg: 'rgba(16,185,129,0.12)', color: '#34d399' },
  Claude: { bg: 'rgba(167,139,250,0.12)', color: '#a78bfa' },
  Google: { bg: 'rgba(96,165,250,0.12)', color: '#60a5fa' },
  xAI: { bg: 'rgba(248,113,113,0.12)', color: '#f87171' },
  Chinese: { bg: 'rgba(251,191,36,0.12)', color: '#fbbf24' },
  Edgey: { bg: 'rgba(99,102,241,0.12)', color: '#818cf8' },
};

export default function ModelList() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      {CATALOG.providers.map(p => {
        const colors = PROVIDER_COLORS[p.name] || { bg: 'rgba(167,139,250,0.1)', color: '#a78bfa' };
        return (
          <div key={p.name}>
            <button
              onClick={() => setExpanded(expanded === p.name ? null : p.name)}
              className="flex items-center w-full px-3 py-2.5 rounded-lg border-none transition-all duration-150 hover:bg-white/[0.04]"
              style={{ background: expanded === p.name ? 'var(--color-bg2)' : 'transparent' }}
            >
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0"
                style={{ background: colors.bg, color: colors.color }}
              >
                {p.badge}
              </span>
              <span className="text-[13px] font-semibold ml-2.5 flex-1 text-left">{p.name}</span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md mr-2" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
                {p.models.length}
              </span>
              <ChevronRight
                size={14}
                className="text-muted transition-transform duration-200"
                style={{ transform: expanded === p.name ? 'rotate(90deg)' : 'none' }}
              />
            </button>
            {expanded === p.name && (
              <div className="ml-10 mr-2 mb-1">
                {p.models.map(m => (
                  <div key={m.id} className="flex justify-between py-1.5 px-2 text-[12px] text-muted rounded hover:bg-white/[0.02] transition-colors">
                    <span>{m.id}</span>
                    <span className="font-medium tabular-nums">&times;{m.rate}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="text-[11px] text-muted mt-2 px-3">20M tokens = &euro;1. Model multipliers apply.</div>
    </div>
  );
}
