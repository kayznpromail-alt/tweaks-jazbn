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
    <div style={{ animation: 'pageIn 0.45s cubic-bezier(0.2,0.8,0.2,1)' }}>
      <div className="text-[10px] font-semibold uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em', color: 'var(--color-accent)' }}>
        WORKSPACE / REQUESTS
      </div>

      <h1 className="font-bold mb-1" style={{ fontSize: 'clamp(28px, 5vw, 38px)', letterSpacing: '-.035em', lineHeight: 1.1 }}>
        Requests
      </h1>
      <p className="text-muted text-[13px] mb-6">View and search your API request history.</p>
      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', marginBottom: 32 }} />

      <div className="flex gap-2 mb-5 flex-wrap">
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

      <div className="rounded-[14px] p-6" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
        {rows.length === 0 ? (
          <div className="text-center py-10 text-muted text-[12px]">No requests found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {['ID', 'Model', 'Route', 'Tokens', 'Charged', 'Latency', 'Key', 'Status', 'Time'].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-muted font-medium text-[10px] uppercase tracking-wider whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="transition-colors hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>#{r.id}</td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.model}</td>
                    <td className="px-3 py-2.5 text-muted text-[11px] whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.route}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{fmtNum(r.input_tokens)} + {fmtNum(r.output_tokens)} = {fmtNum(r.total_tokens)}</td>
                    <td className="px-3 py-2.5 text-muted text-[11px] whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtNum(r.total_tokens)} &times; {r.rate} = {fmtNum(r.charged)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-text2" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{fmtMs(r.duration_ms)}</span>
                        <span className="h-[3px] rounded-full inline-block" style={{ width: `${Math.min(50, Math.max(6, r.duration_ms / 120))}px`, background: r.duration_ms < 3000 ? 'var(--color-accent)' : r.duration_ms < 8000 ? 'var(--color-yellow)' : 'var(--color-red)', opacity: 0.5 }} />
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[10px] text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)' }}>{r.key_masked || '--'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-[6px] h-[6px] rounded-full" style={{ background: r.status >= 200 && r.status < 300 ? '#4ade80' : 'var(--color-red)', boxShadow: r.status >= 200 && r.status < 300 ? '0 0 6px rgba(74,222,128,0.4)' : 'none' }} />
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
