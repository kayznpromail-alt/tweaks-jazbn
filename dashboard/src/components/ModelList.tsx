import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { CATALOG } from '@/lib/catalog';

export default function ModelList() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      {CATALOG.providers.map(p => (
        <div key={p.name}>
          <button
            onClick={() => setExpanded(expanded === p.name ? null : p.name)}
            className="flex items-center w-full px-3 py-2.5 rounded-lg border-none transition-all duration-150 hover:bg-white/[0.03]"
            style={{ background: expanded === p.name ? 'var(--color-bg2)' : 'transparent' }}
          >
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0"
              style={{ background: 'var(--color-accent-surface)', color: 'var(--color-accent2)' }}
            >
              {p.badge}
            </span>
            <span className="text-[13px] font-semibold ml-2.5 flex-1 text-left">{p.name}</span>
            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md mr-2" style={{ background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
              {p.models.length}
            </span>
            <ChevronRight
              size={14}
              className="text-muted transition-transform duration-200"
              style={{ transform: expanded === p.name ? 'rotate(90deg)' : 'none' }}
            />
          </button>
          {expanded === p.name && (
            <div className="ml-9 mr-2 mb-1">
              {p.models.map(m => (
                <div key={m.id} className="flex justify-between py-1.5 px-2 text-[12px] text-muted">
                  <span>{m.id}</span>
                  <span className="font-medium">&times;{m.rate}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="text-[11px] text-muted mt-2 px-3">20M tokens = €1. Model multipliers apply.</div>
    </div>
  );
}
