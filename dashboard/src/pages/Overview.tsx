import { useEffect, useState, useCallback } from 'react';
import { Activity, CheckCircle, Coins, TrendingUp } from 'lucide-react';
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

  const successRate = me?.requests24h ? (me.successful24h / me.requests24h * 100) : null;

  return (
    <div style={{ animation: 'pageIn 0.35s cubic-bezier(0.23,1,0.32,1)' }}>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-5 max-md:grid-cols-1">
        <StatCard
          icon={<Activity size={15} />}
          label="Requests 24h"
          value={fmtNum(me?.requests24h)}
        />
        <StatCard
          icon={<CheckCircle size={15} />}
          label="Success Rate"
          value={me?.requests24h ? fmtPct(me.successful24h, me.requests24h) : '--'}
          accent={successRate != null && successRate >= 99 ? 'var(--color-green)' : successRate != null && successRate >= 95 ? 'var(--color-yellow)' : undefined}
        />
        <StatCard
          icon={<Coins size={15} />}
          label="Token Balance"
          value={fmtTokens(me?.balance)}
          accent="var(--color-accent2)"
        />
      </div>

      {/* Model Access Quotas */}
      {me?.modelAccess && me.modelAccess.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 mb-5">
          {me.modelAccess.map(ma => (
            <div key={ma.model} className="rounded-xl px-5 py-4 flex items-center gap-4" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: 'var(--color-accent-surface)', color: 'var(--color-accent2)' }}>
                {ma.model.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold truncate">{ma.model}</div>
                <div className="text-[11px] text-muted">{fmtTokens(ma.used)} / {fmtTokens(ma.quota)}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[15px] font-bold" style={{ color: ma.remaining > 0 ? 'var(--color-accent2)' : 'var(--color-red)' }}>{fmtTokens(ma.remaining)}</div>
                <div className="text-[10px] text-muted">left</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Chart + Model Rates */}
      <div className="flex gap-3 mb-5 max-lg:flex-col">
        <div className="flex-[3] rounded-xl p-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-[13px] font-semibold">Tokens spent</h3>
              {usage && (
                <div className="text-[11px] text-muted mt-0.5">
                  {fmtTokens(usage.tokens)} total &middot; {fmtNum(usage.requests)} requests
                </div>
              )}
            </div>
            <div className="flex gap-0.5 rounded-lg p-[3px]" style={{ background: 'var(--color-bg2)' }}>
              {['24h', '7d', '30d'].map(r => (
                <button
                  key={r}
                  onClick={() => changeRange(r)}
                  className="px-3 py-[5px] rounded-md text-[11px] font-semibold border-none transition-all duration-150"
                  style={range === r
                    ? { background: 'var(--color-accent)', color: '#fff', boxShadow: '0 1px 4px rgba(108,92,231,0.25)' }
                    : { background: 'none', color: 'var(--color-muted)', cursor: 'pointer' }
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <Chart buckets={usage?.buckets || []} range={usage?.range || range} />
        </div>

        <div className="flex-[1.2] rounded-xl p-5 max-h-[380px] overflow-y-auto" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-[13px] font-semibold mb-0.5">How tokens are charged</h3>
          <p className="text-[11px] text-muted mb-3">Rate multipliers applied to raw usage.</p>
          <ModelList />
        </div>
      </div>

      {/* Recent Requests */}
      <div className="rounded-xl p-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-[13px] font-semibold mb-4">Recent requests</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Model', 'Tokens', 'Spent', 'Latency', 'Status', 'Time'].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-muted font-medium text-[10.5px] uppercase tracking-wider" style={{ borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reqs.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted text-[12px]">No requests yet</td></tr>
              )}
              {reqs.map((r, i) => (
                <tr key={i} className="transition-colors hover:bg-white/[0.015]">
                  <td className="px-3 py-2.5 font-medium" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {r.model}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                    {fmtTokens(r.total_tokens)}
                  </td>
                  <td className="px-3 py-2.5 text-muted" style={{ borderBottom: '1px solid var(--color-border)', fontSize: '11px' }}>
                    {fmtNum(r.total_tokens)} &times; {r.rate} = <span className="text-text2">{fmtNum(r.charged)}</span>
                  </td>
                  <td className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-text2">{fmtMs(r.duration_ms)}</span>
                      <span className="h-[3px] rounded-full inline-block" style={{ width: `${Math.min(60, Math.max(8, r.duration_ms / 100))}px`, background: r.duration_ms < 3000 ? 'var(--color-accent)' : r.duration_ms < 8000 ? 'var(--color-yellow)' : 'var(--color-red)', opacity: 0.5 }} />
                    </span>
                  </td>
                  <td className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <span
                      className="inline-block w-[6px] h-[6px] rounded-full mr-1.5"
                      style={{ background: r.status >= 200 && r.status < 300 ? 'var(--color-green)' : 'var(--color-red)' }}
                    />
                    <span className="text-muted">{r.status}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl px-5 py-4 flex items-start gap-3.5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: 'var(--color-accent-surface)', color: 'var(--color-accent2)' }}>
        {icon}
      </div>
      <div>
        <div className="text-[11px] font-medium text-muted mb-1">{label}</div>
        <div className="text-[22px] font-bold tracking-tight leading-none" style={{ color: accent }}>{value}</div>
      </div>
    </div>
  );
}
