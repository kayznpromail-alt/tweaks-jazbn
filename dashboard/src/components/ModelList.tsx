import { CATALOG } from '@/lib/catalog';

export default function ModelList() {
  return (
    <div>
      {CATALOG.providers.map(p => (
        <div key={p.name} className="mb-4">
          <div className="text-[13px] font-semibold mb-2.5 flex items-center gap-2.5">
            <span
              className="w-[26px] h-[26px] rounded-[7px] inline-flex items-center justify-center text-[10px] font-bold text-accent2"
              style={{ background: 'var(--color-accent-surface)' }}
            >
              {p.badge}
            </span>
            {p.name}
          </div>
          {p.models.map(m => (
            <div key={m.id} className="flex justify-between py-[7px] px-3 text-[13px] rounded-md transition-colors hover:bg-white/[0.025]">
              <span>{m.id}</span>
              <span className="text-muted text-xs font-medium">&times;{m.rate}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
