import { useEffect, useState, useCallback } from 'react';
import { Activity, CheckCircle, Coins, TrendingUp, Zap, Clock } from 'lucide-react';
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
      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6 max-md:grid-cols-1">
        <StatCard
          icon={<Activity size={18} />}
          label="Requests 24h"
          value={fmtNum(me?.requests24h)}
          iconBg="rgba(99,102,241,0.12)"
          iconColor="#818cf8"
        />
        <StatCard
          icon={<CheckCircle size={18} />}
          label="Success Rate"
          value={me?.requests24h ? fmtPct(me.successful24h, me.requests24h) : '--'}
          iconBg="rgba(52,211,153,0.12)"
          iconColor="#34d399"
          accent={successRate != null && successRate >= 99 ? 'var(--color-green)' : successRate != null && successRate >= 95 ? 'var(--color-yellow)' : undefined}
        />
        <StatCard
          icon={<Coins size={18} />}
          label="Token Balance"
          value={fmtTokens(me?.balance)}
          iconBg="rgba(167,139,250,0.12)"
          iconColor="#a78bfa"
          accent="var(--color-accent2)"
        />
      </div>

      {/* Model Access Quotas */}
      {me?.modelAccess && me.modelAccess.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 mb-6">
          {me.modelAccess.map(ma => {
            const pct = Math.min(100, (ma.used / ma.quota) * 100);
            return (
              <div
                key={ma.model}
                className="rounded-xl px-5 py-4 flex items-center gap-4"
                style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: 'rgba(167,139,250,0.1)', color: '#a78bfa' }}>
                  {ma.model.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold truncate mb-1">{ma.model}</div>
                  <div className="w-full h-[5px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ma.remaining > 0 ? 'var(--color-accent)' : 'var(--color-red)', transition: 'width 0.5s ease' }} />
                  </div>
                  <div className="text-[10.5px] text-muted mt-1">{fmtTokens(ma.used)} / {fmtTokens(ma.quota)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[16px] font-bold" style={{ color: ma.remaining > 0 ? 'var(--color-accent2)' : 'var(--color-red)' }}>{fmtTokens(ma.remaining)}</div>
                  <div className="text-[10px] text-muted">remaining</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Chart + Model Rates */}
      <div className="flex gap-4 mb-6 max-lg:flex-col">
        <div className="flex-[3] rounded-xl p-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
          <div className="flex justify-between items-center mb-4">
            <div>
              <h3 className="text-[14px] font-bold tracking-tight">Tokens spent</h3>
              {usage && (
                <div className="text-[11.5px] text-muted mt-0.5">
                  {fmtTokens(usage.tokens)} total &middot; {fmtNum(usage.requests)} requests
                </div>
              )}
            </div>
            <div className="flex gap-0.5 rounded-lg p-[3px]" style={{ background: 'var(--color-bg2)' }}>
              {['24h', '7d', '30d'].map(r => (
                <button
                  key={r}
                  onClick={() => changeRange(r)}
                  className="px-3.5 py-[6px] rounded-md text-[11px] font-semibold border-none transition-all duration-150"
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
        </div>

        <div className="flex-[1.3] rounded-xl p-5 max-h-[400px] overflow-y-auto" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
          <h3 className="text-[14px] font-bold tracking-tight mb-0.5">How tokens are charged</h3>
          <p className="text-[11px] text-muted mb-3">Rate multipliers applied to raw usage.</p>
          <ModelList />
        </div>
      </div>

      {/* Recent Requests */}
      <div className="rounded-xl p-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
        <h3 className="text-[14px] font-bold tracking-tight mb-4">Recent requests</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Model', 'Tokens', 'Spent', 'Latency', 'Status', 'Time'].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-muted font-medium text-[10.5px] uppercase tracking-wider" style={{ borderBottom: '1px solid var(--color-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reqs.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-muted text-[12px]">No requests yet</td></tr>
              )}
              {reqs.map((r, i) => (
                <tr key={i} className="transition-colors hover:bg-white/[0.02]">
                  <td className="px-3 py-3 font-semibold whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    {r.model}
                  </td>
                  <td className="px-3 py-3 tabular-nums whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                    {fmtTokens(r.total_tokens)}
                  </td>
                  <td className="px-3 py-3 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)', fontSize: '11px' }}>
                    {fmtNum(r.total_tokens)} &times; {r.rate} = <span className="text-text2 font-medium">{fmtNum(r.charged)}</span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-text2 font-medium">{fmtMs(r.duration_ms)}</span>
                      <span className="h-[4px] rounded-full inline-block" style={{ width: `${Math.min(60, Math.max(8, r.duration_ms / 100))}px`, background: r.duration_ms < 3000 ? 'var(--color-accent)' : r.duration_ms < 8000 ? 'var(--color-yellow)' : 'var(--color-red)', opacity: 0.6 }} />
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-[7px] h-[7px] rounded-full"
                        style={{ background: r.status >= 200 && r.status < 300 ? 'var(--color-green)' : 'var(--color-red)', boxShadow: r.status >= 200 && r.status < 300 ? '0 0 6px rgba(52,211,153,0.4)' : '0 0 6px rgba(248,113,113,0.4)' }}
                      />
                      <span className="text-muted">{r.status}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtAgo(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, accent, iconBg, iconColor }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
  iconBg?: string;
  iconColor?: string;
}) {
  return (
    <div
      className="rounded-xl px-5 py-5 flex items-center gap-4"
      style={{
        background: 'var(--color-card)',
        border: '1px solid var(--color-border)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
      }}
    >
      <div
        className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: iconBg || 'var(--color-accent-surface)', color: iconColor || 'var(--color-accent2)' }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11.5px] font-medium text-muted mb-1.5">{label}</div>
        <div className="text-[24px] font-bold tracking-tight leading-none" style={{ color: accent }}>{value}</div>
      </div>
    </div>
  );
}
