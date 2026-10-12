import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { fmtTokens, fmtNum, fmtPct, fmtAgo, fmtMs } from '@/lib/utils';
import Chart from '@/components/Chart';
import ModelList from '@/components/ModelList';

interface ModelAccess {
  model: string;
  quota: number;
  used: number;
  remaining: number;
}

interface MeData {
  requests24h: number;
  successful24h: number;
  requests90d: number;
  balance: number;
  firstKey?: string;
  keyCount?: number;
  modelAccess?: ModelAccess[];
}

interface Bucket { start: number; tokens: number; }
interface UsageData {
  buckets: Bucket[];
  range: string;
  tokens: number;
  requests: number;
  successful: number;
  peak: number;
}

interface Request {
  model: string;
  total_tokens: number;
  rate: number;
  charged: number;
  duration_ms: number;
  status: number;
  created_at: number;
}

export default function Overview() {
  const [me, setMe] = useState<MeData | null>(null);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [reqs, setReqs] = useState<Request[]>([]);
  const [range, setRange] = useState('24h');

  const load = useCallback(async (r: string) => {
    const [meData, usageData, reqData] = await Promise.all([
      api<MeData>('/me'),
      api<UsageData>('/usage?range=' + r),
      api<{ requests: Request[] }>('/requests?status=all'),
    ]);
    if (meData) setMe(meData);
    if (usageData) setUsage(usageData);
    if (reqData?.requests) setReqs(reqData.requests.slice(0, 8));
  }, []);

  useEffect(() => { load(range); }, [load, range]);

  const changeRange = (r: string) => {
    setRange(r);
    api<UsageData>('/usage?range=' + r).then(u => { if (u) setUsage(u); });
  };

  return (
    <div style={{ animation: 'pageIn 0.32s cubic-bezier(0.23,1,0.32,1)' }}>
      <h2 className="text-[22px] font-bold mb-6 tracking-tight flex items-center gap-3">
        Overview
        <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, var(--color-border2), transparent)' }} />
      </h2>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5 mb-6">
        <Stat label="Requests (24h)" value={fmtNum(me?.requests24h)} />
        <Stat label="Success Rate" value={me?.requests24h ? fmtPct(me.successful24h, me.requests24h) : '--'} color="var(--color-green)" />
        <Stat label="Token Balance" value={fmtTokens(me?.balance)} color="var(--color-cyan)" />
        <Stat label="Requests (90d)" value={fmtNum(me?.requests90d)} />
        {me?.modelAccess?.map(ma => (
          <Stat key={ma.model} label={ma.model} value={fmtTokens(ma.remaining)} hint={`${fmtTokens(ma.used)} used of ${fmtTokens(ma.quota)}`} color="var(--color-accent2)" />
        ))}
      </div>

      <div className="rounded-xl p-6 mb-4" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-sm font-semibold">Token Usage</h3>
          <div className="flex gap-0.5 rounded-lg p-0.5" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
            {['24h', '7d', '30d'].map(r => (
              <button
                key={r}
                onClick={() => changeRange(r)}
                className="px-3.5 py-1.5 rounded-md text-xs font-semibold border-none transition-all duration-150"
                style={range === r
                  ? { background: 'var(--color-accent)', color: '#fff', boxShadow: '0 1px 4px rgba(108,92,231,0.3)' }
                  : { background: 'none', color: 'var(--color-muted)', cursor: 'pointer' }
                }
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <Chart buckets={usage?.buckets || []} range={usage?.range || range} />
        {usage && (
          <div className="flex gap-6 mt-3.5 text-xs text-muted">
            <span>Total: <strong className="text-text">{fmtTokens(usage.tokens)}</strong> tokens</span>
            <span>Requests: <strong className="text-text">{fmtNum(usage.requests)}</strong></span>
            <span>Success: <strong className="text-text">{fmtPct(usage.successful, usage.requests)}</strong></span>
            <span>Peak: <strong className="text-text">{fmtTokens(usage.peak)}</strong></span>
          </div>
        )}
      </div>

      <div className="flex gap-4 max-md:flex-col">
        <div className="flex-[2] rounded-xl p-6" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-semibold mb-4">Recent Requests</h3>
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg2)' }}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {['Model', 'Tokens', 'Charged', 'Latency', 'Status', 'Time'].map(h => (
                    <th key={h} className="text-left px-3.5 py-2.5 text-muted font-semibold text-[11px] uppercase tracking-wide" style={{ background: 'var(--color-card)', borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reqs.map((r, i) => (
                  <tr key={i} className="transition-colors hover:bg-white/[0.015]">
                    <td className="px-3.5 py-2.5 font-medium" style={{ borderBottom: '1px solid var(--color-border)' }}>{r.model}</td>
                    <td className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtTokens(r.total_tokens)}</td>
                    <td className="px-3.5 py-2.5 text-muted text-xs" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtNum(r.total_tokens)} &times; {r.rate} = {fmtNum(r.charged)}</td>
                    <td className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtMs(r.duration_ms)}</td>
                    <td className="px-3.5 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${r.status >= 200 && r.status < 300 ? 'bg-green-bg text-green' : 'bg-red-bg text-red'}`}>{r.status}</span>
                    </td>
                    <td className="px-3.5 py-2.5 text-muted" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtAgo(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex-1 rounded-xl p-6 max-h-[420px] overflow-y-auto" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-semibold mb-1">How tokens are charged</h3>
          <p className="text-xs text-muted mb-3.5">Each model has a rate multiplier applied to raw token usage.</p>
          <ModelList />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="rounded-xl p-5 transition-all duration-200 hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_rgba(0,0,0,0.2)]" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">{label}</div>
      <div className="text-[26px] font-bold tracking-tight" style={{ color }}>{value}</div>
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </div>
  );
}
