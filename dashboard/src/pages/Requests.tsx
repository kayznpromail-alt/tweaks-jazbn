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
    <div style={{ animation: 'pageIn 0.32s cubic-bezier(0.23,1,0.32,1)' }}>
      <h2 className="text-[22px] font-bold mb-6 tracking-tight flex items-center gap-3">
        Requests
        <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, var(--color-border2), transparent)' }} />
      </h2>

      <div className="flex gap-2.5 mb-4 flex-wrap">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by model or key..."
          className="flex-1 min-w-[200px] text-[13px] py-2.5 px-3.5"
        />
        <select value={status} onChange={e => setStatus(e.target.value)} className="w-auto min-w-[140px] text-[13px] py-2.5 px-3.5">
          <option value="all">All status</option>
          <option value="ok">Success</option>
          <option value="error">Error</option>
        </select>
      </div>

      <div className="rounded-xl p-6" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
        {rows.length === 0 ? (
          <div className="text-center py-11 text-muted text-sm">No requests found.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg2)' }}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {['ID', 'Model', 'Route', 'Tokens', 'Charged', 'Latency', 'Key', 'Status', 'Time'].map(h => (
                    <th key={h} className="text-left px-3.5 py-2.5 text-muted font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap" style={{ background: 'var(--color-card)', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="transition-colors hover:bg-white/[0.015]">
                    <td className="px-3.5 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>#{r.id}</td>
                    <td className="px-3.5 py-2.5 font-medium whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.model}</td>
                    <td className="px-3.5 py-2.5 text-muted text-xs whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.route}</td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtNum(r.input_tokens)} + {fmtNum(r.output_tokens)} = {fmtNum(r.total_tokens)}</td>
                    <td className="px-3.5 py-2.5 text-muted text-xs whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtNum(r.total_tokens)} &times; {r.rate} = {fmtNum(r.charged)}</td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtMs(r.duration_ms)}</td>
                    <td className="px-3.5 py-2.5 text-xs text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.key_masked || '--'}</td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${r.status >= 200 && r.status < 300 ? 'bg-green-bg text-green' : 'bg-red-bg text-red'}`}>{r.status}</span>
                    </td>
                    <td className="px-3.5 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtAgo(r.created_at)}</td>
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
