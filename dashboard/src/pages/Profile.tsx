import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
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
    <div style={{ animation: 'pageIn 0.32s cubic-bezier(0.23,1,0.32,1)' }}>
      <h2 className="text-[22px] font-bold mb-6 tracking-tight flex items-center gap-3">
        Profile
        <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, var(--color-border2), transparent)' }} />
      </h2>

      <div className="rounded-2xl p-7 mb-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-5 mb-6">
          <div className="w-[68px] h-[68px] rounded-full flex items-center justify-center text-2xl font-bold text-white shrink-0" style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)', boxShadow: '0 4px 16px rgba(108,92,231,0.3)' }}>
            {initials}
          </div>
          <div>
            <div className="text-xl font-bold tracking-tight">{me.username}</div>
            <div className="text-[13px] text-muted mt-0.5">Customer account</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
          <ProfileField label="Access" value="Active" color="var(--color-green)" />
          <ProfileField label="Token Balance" value={fmtTokens(me.balance)} color="var(--color-cyan)" />
          <ProfileField label="API Keys" value={`${me.keyCount ?? 0} / ${me.maxKeys ?? 6}`} />
          <ProfileField label="Total Spent" value={fmtEur(me.paidEur)} />
        </div>
      </div>

      {me.modelAccess && me.modelAccess.length > 0 && (
        <div className="rounded-2xl p-7 mb-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-sm font-semibold mb-3.5">Model Subscriptions</h3>
          <div className="grid gap-3">
            {me.modelAccess.map(ma => (
              <div key={ma.model} className="flex items-center justify-between p-4 rounded-xl" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
                <div>
                  <div className="text-sm font-semibold">{ma.model}</div>
                  <div className="text-[11px] text-muted">{fmtTokens(ma.used)} / {fmtTokens(ma.quota)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-bold" style={{ color: ma.remaining > 0 ? 'var(--color-accent2)' : 'var(--color-red)' }}>{fmtTokens(ma.remaining)}</div>
                  <div className="text-[10px] text-muted">remaining</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl p-7 mb-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-3.5">Getting Started</h3>
        <ul className="list-none">
          {checks.map((c, i) => (
            <li key={i} className="flex items-center gap-3 py-3 text-sm transition-colors" style={{ borderBottom: i < checks.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs transition-all duration-200"
                style={c.done
                  ? { background: 'var(--color-green-bg)', color: 'var(--color-green)' }
                  : { background: 'rgba(255,255,255,0.04)', color: 'var(--color-muted2)', border: '1px solid var(--color-border)' }
                }
              >
                {c.done && <Check size={12} />}
              </span>
              <span style={{ color: c.done ? 'var(--color-text)' : 'var(--color-muted)' }}>{c.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3.5 mt-5">
        <Stat label="Requests (24h)" value={fmtNum(me.requests24h)} />
        <Stat label="Success Rate (24h)" value={me.requests24h ? fmtPct(me.successful24h, me.requests24h) : '--'} color="var(--color-green)" />
        <Stat label="Requests (90d)" value={fmtNum(me.requests90d)} />
        <Stat label="Token Balance" value={fmtTokens(me.balance)} color="var(--color-cyan)" />
      </div>
    </div>
  );
}

function ProfileField({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-4 rounded-xl transition-all duration-200 hover:border-border2" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">{label}</div>
      <div className="text-[15px] font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">{label}</div>
      <div className="text-[26px] font-bold tracking-tight" style={{ color }}>{value}</div>
    </div>
  );
}
