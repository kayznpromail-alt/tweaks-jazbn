import { useEffect, useState } from 'react';
import { Check, Activity, CheckCircle, TrendingUp, Coins } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtTokens, fmtNum, fmtEur, fmtPct } from '@/lib/utils';

interface ModelAccess {
  model: string;
  quota: number;
  used: number;
  remaining: number;
  grantedAt: number;
}

interface MeData {
  username: string;
  balance: number;
  keyCount: number;
  maxKeys: number;
  paidEur: number;
  requests24h: number;
  successful24h: number;
  requests90d: number;
  modelAccess?: ModelAccess[];
}

export default function Profile() {
  const [me, setMe] = useState<MeData | null>(null);

  useEffect(() => {
    api<MeData>('/me').then(d => { if (d) setMe(d); });
  }, []);

  if (!me) return null;

  const initials = (me.username || 'U').slice(0, 2).toUpperCase();
  const checks = [
    { done: true, text: 'Create your account' },
    { done: (me.keyCount ?? 0) > 0, text: 'Generate an API key' },
    { done: me.balance > 0, text: 'Add tokens to your wallet' },
    { done: (me.requests24h ?? 0) > 0 || (me.requests90d ?? 0) > 0, text: 'Make your first API request' },
  ];

  return (
    <div style={{ animation: 'pageIn 0.35s cubic-bezier(0.23,1,0.32,1)' }}>
      {/* Profile Header */}
      <div className="rounded-xl p-6 mb-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-xl font-bold text-white shrink-0" style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)', boxShadow: '0 3px 12px rgba(108,92,231,0.25)' }}>
            {initials}
          </div>
          <div>
            <div className="text-[17px] font-bold tracking-tight">{me.username}</div>
            <div className="text-[12px] text-muted mt-0.5">Customer account</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
          <InfoField label="Access" value="Active" color="var(--color-green)" />
          <InfoField label="Token Balance" value={fmtTokens(me.balance)} color="var(--color-accent2)" />
          <InfoField label="API Keys" value={`${me.keyCount ?? 0} / ${me.maxKeys ?? 6}`} />
          <InfoField label="Total Spent" value={fmtEur(me.paidEur)} />
        </div>
      </div>

      {/* Model Quotas */}
      {me.modelAccess && me.modelAccess.length > 0 && (
        <div className="rounded-xl p-6 mb-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-[13px] font-semibold mb-3">Model Quotas</h3>
          <div className="grid gap-2.5">
            {me.modelAccess.map(ma => (
              <div key={ma.model} className="flex items-center gap-3 p-3.5 rounded-lg" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: 'var(--color-accent-surface)', color: 'var(--color-accent2)' }}>
                  {ma.model.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold">{ma.model}</div>
                  <div className="text-[10.5px] text-muted">{fmtTokens(ma.used)} / {fmtTokens(ma.quota)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-bold" style={{ color: ma.remaining > 0 ? 'var(--color-accent2)' : 'var(--color-red)' }}>{fmtTokens(ma.remaining)}</div>
                  <div className="text-[10px] text-muted">left</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Getting Started */}
      <div className="rounded-xl p-6 mb-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-[13px] font-semibold mb-3">Getting Started</h3>
        <ul className="list-none">
          {checks.map((c, i) => (
            <li key={i} className="flex items-center gap-2.5 py-2.5 text-[12.5px]" style={{ borderBottom: i < checks.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                style={c.done
                  ? { background: 'var(--color-green-bg)', color: 'var(--color-green)' }
                  : { background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)' }
                }
              >
                {c.done && <Check size={10} />}
              </span>
              <span style={{ color: c.done ? 'var(--color-text)' : 'var(--color-muted)' }}>{c.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <StatCard icon={<Activity size={15} />} label="Requests (24h)" value={fmtNum(me.requests24h)} />
        <StatCard icon={<CheckCircle size={15} />} label="Success Rate (24h)" value={me.requests24h ? fmtPct(me.successful24h, me.requests24h) : '--'} accent="var(--color-green)" />
        <StatCard icon={<TrendingUp size={15} />} label="Requests (90d)" value={fmtNum(me.requests90d)} />
        <StatCard icon={<Coins size={15} />} label="Token Balance" value={fmtTokens(me.balance)} accent="var(--color-accent2)" />
      </div>
    </div>
  );
}

function InfoField({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-3.5 rounded-lg" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
      <div className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className="text-[14px] font-semibold" style={{ color }}>{value}</div>
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
