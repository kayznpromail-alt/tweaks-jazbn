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
    <div style={{ animation: 'pageIn 0.45s cubic-bezier(0.2,0.8,0.2,1)' }}>
      <div className="text-[10px] font-semibold uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em', color: 'var(--color-accent)' }}>
        WORKSPACE / PROFILE
      </div>

      <h1 className="font-bold mb-1" style={{ fontSize: 'clamp(28px, 5vw, 38px)', letterSpacing: '-.035em', lineHeight: 1.1 }}>
        Profile
      </h1>
      <p className="text-muted text-[13px] mb-6">Your account details and progress.</p>
      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', marginBottom: 32 }} />

      {/* Profile Header */}
      <div className="rounded-[14px] p-6 mb-5" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-4 mb-5">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-xl font-bold shrink-0" style={{ background: 'var(--color-accent)', color: '#031217' }}>
            {initials}
          </div>
          <div>
            <div className="text-[17px] font-bold tracking-tight">{me.username}</div>
            <div className="text-[12px] text-muted mt-0.5">Customer account</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 max-md:grid-cols-1">
          <InfoField label="Access" value="Active" color="#4ade80" />
          <InfoField label="Token Balance" value={fmtTokens(me.balance)} color="var(--color-accent)" />
          <InfoField label="API Keys" value={`${me.keyCount ?? 0} / ${me.maxKeys ?? 6}`} />
          <InfoField label="Total Spent" value={fmtEur(me.paidEur)} />
        </div>
      </div>

      {/* Model Quotas */}
      {me.modelAccess && me.modelAccess.length > 0 && (
        <div className="rounded-[14px] p-6 mb-5" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
          <div className="text-[9.5px] font-semibold uppercase mb-4" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
            Model quotas
          </div>
          <div className="grid gap-2.5">
            {me.modelAccess.map(ma => (
              <div key={ma.model} className="flex items-center gap-3 p-3.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold">{ma.model}</div>
                  <div className="text-[10px] text-muted" style={{ fontFamily: 'var(--font-mono)' }}>{fmtTokens(ma.used)} / {fmtTokens(ma.quota)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[14px] font-bold" style={{ color: ma.remaining > 0 ? 'var(--color-accent)' : 'var(--color-red)' }}>{fmtTokens(ma.remaining)}</div>
                  <div className="text-[9px] text-muted uppercase" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.1em' }}>left</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Getting Started */}
      <div className="rounded-[14px] p-6 mb-5" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
        <div className="text-[9.5px] font-semibold uppercase mb-4" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
          Getting started
        </div>
        <ul className="list-none">
          {checks.map((c, i) => (
            <li key={i} className="flex items-center gap-2.5 py-2.5 text-[12.5px]" style={{ borderBottom: i < checks.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                style={c.done
                  ? { background: 'rgba(74,222,128,0.12)', color: '#4ade80' }
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
      <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1">
        <StatCard label="Requests (24h)" value={fmtNum(me.requests24h)} />
        <StatCard label="Success rate (24h)" value={me.requests24h ? fmtPct(me.successful24h, me.requests24h) : '--'} accent />
        <StatCard label="Requests (90d)" value={fmtNum(me.requests90d)} />
        <StatCard label="Token balance" value={fmtTokens(me.balance)} accent />
      </div>
    </div>
  );
}

function InfoField({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-3.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <div className="text-[9px] font-semibold text-muted uppercase mb-1" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em' }}>{label}</div>
      <div className="text-[14px] font-semibold" style={{ color }}>{value}</div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-[14px] p-6" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
      <div className="text-[9.5px] font-semibold uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
        {label}
      </div>
      <div
        className="text-[28px] font-semibold leading-none"
        style={accent ? {
          letterSpacing: '-.03em',
          background: 'linear-gradient(90deg, var(--color-text), var(--color-accent))',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        } : { letterSpacing: '-.03em' }}
      >
        {value}
      </div>
    </div>
  );
}
