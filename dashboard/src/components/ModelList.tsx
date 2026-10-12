import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { CATALOG } from '@/lib/catalog';

const PROVIDER_COLORS: Record<string, string> = {
  GPT: '#4ade80',
  Claude: '#a78bfa',
  Google: '#60a5fa',
  xAI: '#f87171',
  Chinese: '#fbbf24',
  Edgey: '#22d3ee',
};

export default function ModelList() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1">
      {CATALOG.providers.map(p => {
        const color = PROVIDER_COLORS[p.name] || '#22d3ee';
        return (
          <div key={p.name}>
            <button
              onClick={() => setExpanded(expanded === p.name ? null : p.name)}
              className="flex items-center w-full px-3 py-2.5 rounded-lg border-none transition-all duration-150 hover:bg-white/[0.04]"
              style={{ background: expanded === p.name ? 'var(--color-bg)' : 'transparent' }}
            >
              <span
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold shrink-0"
                style={{ background: color + '18', color }}
              >
                {p.badge}
              </span>
              <span className="text-[12px] font-semibold ml-2.5 flex-1 text-left">{p.name}</span>
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-md mr-2"
                style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-bg)', color: 'var(--color-muted)' }}
              >
                {p.models.length}
              </span>
              <ChevronRight
                size={13}
                className="text-muted transition-transform duration-200"
                style={{ transform: expanded === p.name ? 'rotate(90deg)' : 'none' }}
              />
            </button>
            {expanded === p.name && (
              <div className="ml-9 mr-2 mb-1">
                {p.models.map(m => (
                  <div key={m.id} className="flex justify-between py-1.5 px-2 text-[11px] rounded hover:bg-white/[0.02] transition-colors">
                    <span className="text-text2" style={{ fontFamily: 'var(--font-mono)' }}>{m.id}</span>
                    <span className="font-semibold tabular-nums" style={{ color: 'var(--color-accent)' }}>&times;{m.rate}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="text-[10px] text-muted mt-2 px-3" style={{ fontFamily: 'var(--font-mono)' }}>20M tokens = 1 EUR. Multipliers apply.</div>
    </div>
  );
}
