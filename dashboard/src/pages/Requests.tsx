import { useEffect, useState, useRef } from 'react';
import { api } from '@/lib/api';
import { fmtNum, fmtAgo, fmtMs, fmtTokens } from '@/lib/utils';

interface Req {
  id: number;
  model: string;
  route: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  rate: number;
  charged: number;
  duration_ms: number;
  key_masked?: string;
  status: number;
  created_at: number;
}

export default function Requests() {
  const [rows, setRows] = useState<Req[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const timer = useRef<ReturnType<typeof setTimeout>>();

  function load() {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const r = await api<{ requests: Req[] }>('/requests?q=' + encodeURIComponent(search) + '&status=' + status);
      if (r?.requests) setRows(r.requests);
    }, 200);
  }

  useEffect(() => { load(); }, [search, status]);

  return (
    <div style={{ animation: 'pageIn 0.35s cubic-bezier(0.23,1,0.32,1)' }}>
      <h2 className="text-[18px] font-bold mb-5 tracking-tight">Requests</h2>

      <div className="flex gap-2 mb-4 flex-wrap">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by model or key..."
          className="flex-1 min-w-[200px] text-[12px] py-2 px-3"
        />
        <select value={status} onChange={e => setStatus(e.target.value)} className="w-auto min-w-[130px] text-[12px] py-2 px-3">
          <option value="all">All status</option>
          <option value="ok">Success</option>
          <option value="error">Error</option>
        </select>
      </div>

      <div className="rounded-xl p-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
        {rows.length === 0 ? (
          <div className="text-center py-10 text-muted text-[12px]">No requests found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['ID', 'Model', 'Route', 'Tokens', 'Charged', 'Latency', 'Key', 'Status', 'Time'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-muted font-medium text-[10.5px] uppercase tracking-wider whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="transition-colors hover:bg-white/[0.015]">
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>#{r.id}</td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.model}</td>
                    <td className="px-3 py-2.5 text-muted text-[11px] whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.route}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtNum(r.input_tokens)} + {fmtNum(r.output_tokens)} = {fmtNum(r.total_tokens)}</td>
                    <td className="px-3 py-2.5 text-muted text-[11px] whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtNum(r.total_tokens)} &times; {r.rate} = {fmtNum(r.charged)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-text2">{fmtMs(r.duration_ms)}</span>
                        <span className="h-[3px] rounded-full inline-block" style={{ width: `${Math.min(50, Math.max(6, r.duration_ms / 120))}px`, background: r.duration_ms < 3000 ? 'var(--color-accent)' : r.duration_ms < 8000 ? 'var(--color-yellow)' : 'var(--color-red)', opacity: 0.5 }} />
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[10.5px] text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.key_masked || '--'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-[6px] h-[6px] rounded-full" style={{ background: r.status >= 200 && r.status < 300 ? 'var(--color-green)' : 'var(--color-red)' }} />
                        <span className="text-muted">{r.status}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
