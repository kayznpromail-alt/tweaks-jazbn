import { useEffect, useState, useCallback } from 'react';
import { Copy, ExternalLink, ChevronRight, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtTokens, fmtNum, fmtPct, fmtAgo } from '@/lib/utils';
import { copyText, toast } from '@/components/Toast';
import Chart from '@/components/Chart';
import ModelList from '@/components/ModelList';

interface ModelAccess {
  model: string;
  quota: number;
  used: number;
  remaining: number;
}

interface MeData {
  username: string;
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

  const usagePct = me && usage ? Math.min(100, (usage.tokens / Math.max(me.balance + usage.tokens, 1)) * 100) : 0;
  const keyState = me?.firstKey ? 'active' : 'none';

  return (
    <div style={{ animation: 'pageIn 0.45s cubic-bezier(0.2,0.8,0.2,1)' }}>
      {/* Breadcrumb */}
      <div
        className="text-[10px] font-semibold uppercase mb-3"
        style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em', color: 'var(--color-accent)' }}
      >
        WORKSPACE / OVERVIEW
      </div>

      {/* Welcome */}
      <h1
        className="font-bold mb-1"
        style={{ fontSize: 'clamp(28px, 5vw, 38px)', letterSpacing: '-.035em', lineHeight: 1.1 }}
      >
        Welcome back.
      </h1>
      <p className="text-muted text-[13px] mb-6">
        Here's your workspace at a glance.
      </p>
      <hr className="mb-8" style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: 0, marginBottom: 32 }} />

      {/* Main stat cards */}
      <div className="grid gap-5 mb-8" style={{ gridTemplateColumns: '1.3fr 1fr 1.1fr' }}>
        {/* Tokens available */}
        <div className="p-6 rounded-[14px]" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-[9.5px] font-semibold uppercase mb-2" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
                Tokens available
              </div>
              <div
                className="font-semibold leading-none"
                style={{
                  fontSize: 44,
                  letterSpacing: '-.04em',
                  background: 'linear-gradient(90deg, var(--color-text), var(--color-accent))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {fmtTokens(me?.balance)}
              </div>
            </div>
          </div>
          <div className="text-[12px] text-muted mt-3">
            20M tokens = 1 EUR
          </div>
        </div>

        {/* Usage */}
        <div className="p-6 rounded-[14px]" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
          <div className="text-[9.5px] font-semibold uppercase mb-4" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
            Usage
          </div>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-[28px] font-semibold leading-none" style={{ letterSpacing: '-.03em' }}>
              {usage ? fmtTokens(usage.tokens) : '--'}
            </span>
            <span className="text-[12px] text-muted">spent ({range})</span>
          </div>
          <div className="w-full rounded-full overflow-hidden mb-2" style={{ height: 6, background: 'var(--color-bg2)' }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${usagePct}%`,
                background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent2))',
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted">
            <span>{fmtNum(usage?.requests)} requests</span>
            <span>{me?.requests24h ? fmtPct(me.successful24h, me.requests24h) + ' success' : '--'}</span>
          </div>
        </div>

        {/* CLI Key */}
        <div className="p-6 rounded-[14px]" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
          <div className="text-[9.5px] font-semibold uppercase mb-4" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
            Your CLI key
          </div>
          <div className="flex items-center gap-2 mb-3">
            <span
              className="w-[10px] h-[10px] rounded-full shrink-0"
              style={{
                background: keyState === 'active' ? '#4ade80' : 'var(--color-muted2)',
                boxShadow: keyState === 'active' ? '0 0 10px #4ade80' : 'none',
              }}
            />
            <span className="text-[13px] font-medium">{keyState === 'active' ? 'Active' : 'No key yet'}</span>
          </div>
          {me?.firstKey ? (
            <div
              className="flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all duration-150 hover:border-accent"
              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)', fontSize: 11 }}
              onClick={() => { if (me.firstKey) copyText(me.firstKey); }}
            >
              <span className="truncate text-text2">{me.firstKey}</span>
              <Copy size={13} className="shrink-0 ml-2 text-muted" />
            </div>
          ) : (
            <p className="text-[12px] text-muted">Create an API key to get started.</p>
          )}
        </div>
      </div>

      {/* Mobile: stack stat cards */}
      <style>{`@media (max-width: 768px) { .grid[style*="1.3fr"] { grid-template-columns: 1fr !important; } }`}</style>

      {/* Model Access Quotas */}
      {me?.modelAccess && me.modelAccess.length > 0 && (
        <div className="rounded-[14px] p-6 mb-8" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
          <div className="text-[9.5px] font-semibold uppercase mb-4" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
            Model quotas
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {me.modelAccess.map(ma => {
              const pct = Math.min(100, (ma.used / ma.quota) * 100);
              return (
                <div key={ma.model} className="flex items-center gap-3 p-3.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold mb-1">{ma.model}</div>
                    <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: 'var(--color-bg2)' }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ma.remaining > 0 ? 'var(--color-accent)' : 'var(--color-red)', transition: 'width 0.5s ease' }} />
                    </div>
                    <div className="text-[10px] text-muted mt-1">{fmtTokens(ma.used)} / {fmtTokens(ma.quota)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[15px] font-bold" style={{ color: ma.remaining > 0 ? 'var(--color-accent)' : 'var(--color-red)' }}>{fmtTokens(ma.remaining)}</div>
                    <div className="text-[9px] text-muted uppercase" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.1em' }}>left</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Discord card */}
      <div
        className="flex items-center gap-4 p-5 rounded-[14px] mb-8 max-md:flex-col max-md:items-start"
        style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}
      >
        <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#5865F2' }}>
          <svg width="20" height="15" viewBox="0 0 71 55" fill="white"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5a.2.2 0 00-.1 0A59.7 59.7 0 00.2 45.3a.3.3 0 000 .2 58.8 58.8 0 0017.7 9a.2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.8 38.8 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 42 42 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.3.1A58.6 58.6 0 0070.4 45.5a.3.3 0 000-.2A59.2 59.2 0 0060.2 5a.2.2 0 00-.1 0zM23.7 37.3c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1c3.6 0 6.5 3.2 6.4 7.1 0 3.9-2.8 7.1-6.4 7.1zm23.6 0c-3.5 0-6.4-3.2-6.4-7.1s2.8-7.1 6.4-7.1c3.6 0 6.5 3.2 6.4 7.1 0 3.9-2.8 7.1-6.4 7.1z"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold">Join the community</div>
          <div className="text-[12px] text-muted">Chat with other developers, get help, and stay updated.</div>
        </div>
        <a
          href="https://discord.gg/edgey"
          target="_blank"
          rel="noopener"
          className="flex items-center gap-2 shrink-0 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-150"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border2)', color: 'var(--color-text)' }}
        >
          Open <ExternalLink size={12} />
        </a>
      </div>

      {/* Chart + Model Rates */}
      <div className="flex gap-5 mb-8 max-lg:flex-col">
        <div className="flex-[3] rounded-[14px] p-6" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
          <div className="flex justify-between items-center mb-4">
            <div>
              <div className="text-[9.5px] font-semibold uppercase mb-1" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
                Tokens spent
              </div>
              {usage && (
                <div className="text-[12px] text-muted">
                  {fmtTokens(usage.tokens)} total &middot; {fmtNum(usage.requests)} requests
                </div>
              )}
            </div>
            <div className="flex gap-0.5 rounded-lg p-[3px]" style={{ background: 'var(--color-bg)' }}>
              {['24h', '7d', '30d'].map(r => (
                <button
                  key={r}
                  onClick={() => changeRange(r)}
                  className="px-3.5 py-[6px] rounded-md text-[11px] font-semibold border-none transition-all duration-150"
                  style={range === r
                    ? { background: 'var(--color-accent)', color: '#031217' }
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

        <div className="flex-[1.3] rounded-[14px] p-6 max-h-[400px] overflow-y-auto" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
          <div className="text-[9.5px] font-semibold uppercase mb-1" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
            Model rates
          </div>
          <p className="text-[11px] text-muted mb-3">Rate multipliers applied to raw usage.</p>
          <ModelList />
        </div>
      </div>

      {/* Recent Requests */}
      <div className="rounded-[14px] p-6" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
        <div className="text-[9.5px] font-semibold uppercase mb-4" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
          Recent requests
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {['Model', 'Tokens', 'Spent', 'Latency', 'Status', 'Time'].map(h => (
                  <th key={h} className="text-left px-3 py-2.5 text-muted font-medium text-[10px] uppercase tracking-wider" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)' }}>{h}</th>
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
                  <td className="px-3 py-3 tabular-nums whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    {fmtTokens(r.total_tokens)}
                  </td>
                  <td className="px-3 py-3 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)', fontSize: '11px' }}>
                    {fmtNum(r.total_tokens)} &times; {r.rate} = <span className="text-text2 font-medium">{fmtNum(r.charged)}</span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-text2 font-medium" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{r.duration_ms < 1000 ? r.duration_ms + 'ms' : (r.duration_ms / 1000).toFixed(1) + 's'}</span>
                      <span className="h-[4px] rounded-full inline-block" style={{ width: `${Math.min(60, Math.max(8, r.duration_ms / 100))}px`, background: r.duration_ms < 3000 ? 'var(--color-accent)' : r.duration_ms < 8000 ? 'var(--color-yellow)' : 'var(--color-red)', opacity: 0.6 }} />
                    </span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-[7px] h-[7px] rounded-full"
                        style={{ background: r.status >= 200 && r.status < 300 ? '#4ade80' : 'var(--color-red)', boxShadow: r.status >= 200 && r.status < 300 ? '0 0 6px rgba(74,222,128,0.4)' : '0 0 6px rgba(248,113,113,0.4)' }}
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
