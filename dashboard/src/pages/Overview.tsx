import { useEffect, useState, useRef } from 'react';
import { Copy, ExternalLink, ChevronDown, ChevronRight, Plus, Activity, Key as KeyIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtTokens, fmtNum, fmtPct, fmtEur } from '@/lib/utils';
import { copyText, toast } from '@/components/Toast';
import { CATALOG } from '@/lib/catalog';

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

export default function Overview() {
  const [me, setMe] = useState<MeData | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);

  useEffect(() => {
    api<MeData>('/me').then(d => { if (d) setMe(d); });
  }, []);

  const usagePct = me ? Math.min(100, ((me.requests90d || 0) / Math.max(me.balance + (me.requests90d || 0), 1)) * 100) : 0;
  const keyState = me?.firstKey ? 'active' : 'none';

  return (
    <div style={{ animation: 'pageIn 0.45s cubic-bezier(0.2,0.8,0.2,1)' }}>
      {/* Breadcrumb */}
      <p className="crumb" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em', color: 'var(--color-accent)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: 14 }}>
        WORKSPACE / OVERVIEW
      </p>

      <h1 style={{ fontSize: 'clamp(28px, 5vw, 38px)', letterSpacing: '-.035em', lineHeight: 1.1, fontWeight: 700, marginTop: 14 }}>
        Welcome back.
      </h1>
      <p style={{ color: 'var(--color-muted)', marginTop: 10, fontSize: 13 }}>
        Your tokens, keys, and usage in one place.
      </p>
      <hr style={{ border: 0, borderTop: '1px solid var(--color-border)', margin: '28px 0' }} />

      {/* Top 3 stat cards */}
      <div className="top-grid" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1.1fr', gap: 20 }}>
        {/* Tokens available */}
        <div className="card" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)', borderRadius: 14, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <p className="card-title" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase' as const }}>Tokens available</p>
            <button
              onClick={() => setTopupOpen(true)}
              style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border2)', background: 'none', color: 'var(--color-text)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
              aria-label="Top up"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M17 7 7 17M17 17H7V7"/></svg>
            </button>
          </div>
          <p style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-.04em', lineHeight: 1, margin: '28px 0 22px', display: 'flex', alignItems: 'baseline', gap: 10, background: 'linear-gradient(90deg, var(--color-text), var(--color-accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            <span>{fmtTokens(me?.balance)}</span>
            <span style={{ WebkitTextFillColor: 'var(--color-muted)', letterSpacing: '.12em', fontSize: 12, fontWeight: 600 }}>tokens</span>
          </p>
          <button
            onClick={() => setTopupOpen(true)}
            style={{ width: '100%', height: 44, borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: '#031217', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            Top up <Plus size={14} />
          </button>
        </div>

        {/* Usage */}
        <div className="card" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)', borderRadius: 14, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <p style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase' as const }}>Usage</p>
            <a href="#" onClick={e => { e.preventDefault(); }} style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border2)', background: 'none', color: 'var(--color-text)', display: 'grid', placeItems: 'center', textDecoration: 'none' }}>
              <Activity size={16} />
            </a>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <p style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-.04em', lineHeight: 1, margin: '28px 0 22px', display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span>{fmtNum(me?.requests24h)}</span>
              <span style={{ color: 'var(--color-muted)', letterSpacing: '.12em', fontSize: 12, fontWeight: 600 }}>used</span>
            </p>
            <div style={{ textAlign: 'right', marginBottom: 22 }}>
              <p style={{ fontSize: 18, fontWeight: 600 }}>{me ? fmtTokens(me.balance) : '–'}</p>
              <p style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.12em', color: 'var(--color-muted)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const }}>limit</p>
            </div>
          </div>
          <div style={{ background: 'var(--color-bg2)', borderRadius: 6, height: 6, margin: '-8px 0 12px', overflow: 'hidden' }}>
            <i style={{ display: 'block', height: '100%', borderRadius: 6, width: `${usagePct}%`, background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent2))', transition: 'width 0.8s cubic-bezier(0.2,0.8,0.2,1)' }} />
          </div>
          <p style={{ color: 'var(--color-muted)', fontSize: 10.5 }}>
            <span>{fmtNum(me?.requests90d)}</span> requests &middot; {me?.requests24h ? fmtPct(me.successful24h, me.requests24h) : '–'}
          </p>
        </div>

        {/* CLI key */}
        <div className="card" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)', borderRadius: 14, padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <p style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase' as const }}>Your CLI key</p>
            <span style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border2)', background: 'none', color: 'var(--color-text)', display: 'grid', placeItems: 'center' }}>
              <KeyIcon size={16} />
            </span>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, margin: '26px 0 16px', fontSize: 13, fontWeight: 600 }}>
            <i style={{ width: 8, height: 8, borderRadius: '50%', display: 'block', background: keyState === 'active' ? '#4ade80' : 'var(--color-muted)', boxShadow: keyState === 'active' ? '0 0 10px #4ade80' : 'none' }} />
            <span>{keyState === 'active' ? 'Active' : 'Not linked'}</span>
          </div>
          {me?.firstKey ? (
            <div
              onClick={() => { if (me.firstKey) copyText(me.firstKey); }}
              style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer', transition: 'border-color 0.15s' }}
            >
              <code style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.firstKey}</code>
              <Copy size={14} style={{ flexShrink: 0, marginLeft: 8, color: 'var(--color-muted)' }} />
            </div>
          ) : (
            <div style={{ border: '1px dashed var(--color-border)', background: 'var(--color-bg)', borderRadius: 8, padding: '12px 14px', fontSize: 11, color: 'var(--color-muted)', textAlign: 'center' }}>
              No CLI key yet
            </div>
          )}
          <p style={{ color: 'var(--color-muted)', fontSize: 10.5, marginTop: 12 }}>
            Plan <span>{me?.keyCount ? 'active' : '–'}</span>
          </p>
        </div>
      </div>

      {/* Responsive: stack on mobile */}
      <style>{`@media (max-width: 1000px) { .top-grid { grid-template-columns: 1fr !important; } }`}</style>

      {/* Discord */}
      <a
        href="https://discord.gg/edgey"
        target="_blank"
        rel="noopener"
        className="discord-card"
        style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 24, borderRadius: 14, marginTop: 20, background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)', textDecoration: 'none', color: 'inherit', transition: 'border-color 0.15s' }}
      >
        <span style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0, background: 'var(--color-accent-surface)', border: '1px solid var(--color-accent-line)', color: 'var(--color-accent)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase' as const }}>Discord community</span>
          <span style={{ color: 'var(--color-muted)', fontSize: 12, marginTop: 4 }}>Service news, model updates, and promo codes.</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid var(--color-border2)', color: 'var(--color-text)', background: 'none' }}>
          Open <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>
        </span>
      </a>

      {/* Model Rates — collapsible by provider */}
      <div style={{ marginTop: 20 }}>
        <div className="card" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 24, borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase' as const }}>Model rates</p>
              <p style={{ color: 'var(--color-muted)', fontSize: 12, marginTop: 4 }}>API units per token &middot; by provider</p>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, maxHeight: 340, overflowY: 'auto' }}>
            {CATALOG.providers.map(provider => (
              <ProviderGroup key={provider.name} name={provider.name} badge={provider.badge} models={provider.models} />
            ))}
          </div>
          <a href="#" onClick={e => e.preventDefault()} style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 24px', fontSize: 11, textDecoration: 'none', transition: 'color 0.15s' }}>
            View all models <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>
          </a>
        </div>
      </div>

      {/* Footer */}
      <footer style={{ maxWidth: 1256, margin: '40px auto 0', padding: '0 0 40px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--color-muted)', borderTop: '1px solid var(--color-border)', paddingTop: 20 }}>
        <span>cli.eminencehw.com</span>
        <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em', color: 'var(--color-accent)', fontSize: 9.5, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: '0 0 8px var(--color-accent)', display: 'block' }} />
          ONE WORKSPACE. YOUR AI TOOLS.
        </span>
        <a href="#" onClick={e => e.preventDefault()} style={{ justifySelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-muted)', textDecoration: 'none' }}>
          Client setup <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>
        </a>
      </footer>

      {topupOpen && <TopupModal onClose={() => setTopupOpen(false)} onSuccess={() => { setTopupOpen(false); window.location.reload(); }} />}
    </div>
  );
}

function ProviderGroup({ name, badge, models }: { name: string; badge: string; models: { id: string; rate: number }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)', borderRadius: 10 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', fontSize: 12, fontWeight: 600, listStyle: 'none' }}
      >
        <span style={{ width: 22, height: 22, fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', background: 'var(--color-accent-surface)', border: '1px solid var(--color-accent-line)', borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 11 }}>{badge}</span>
        <span style={{ flex: 1 }}>{name}</span>
        <span style={{ fontFamily: 'var(--font-mono)', border: '1px solid var(--color-border2)', color: 'var(--color-muted)', borderRadius: 4, padding: '1px 6px', fontSize: 9 }}>{models.length}</span>
        <ChevronDown size={14} style={{ color: 'var(--color-muted)', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }} />
      </div>
      {open && (
        <ul style={{ borderTop: '1px solid var(--color-border)', padding: '6px 14px 10px', listStyle: 'none', margin: 0 }}>
          {models.map((m, i) => (
            <li key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 11.5, color: 'var(--color-muted)', borderTop: i > 0 ? '1px dashed var(--color-border)' : 'none' }}>
              <code style={{ fontFamily: 'var(--font-mono)' }}>{m.id}</code>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>&times;{m.rate}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TopupModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [method, setMethod] = useState<'crypto' | 'paypal' | 'card'>('crypto');
  const [selectedPack, setSelectedPack] = useState(1);
  const [selectedCoin, setSelectedCoin] = useState('ltc');
  const [loading, setLoading] = useState(false);

  const coin = CATALOG.coins.find(c => c.id === selectedCoin)!;
  const pack = CATALOG.packs[selectedPack];

  async function submit() {
    if (method !== 'crypto') {
      window.open('https://discord.gg/edgey', '_blank', 'noopener');
      return;
    }
    setLoading(true);
    const r = await api<{ invoiceUrl?: string; error?: string }>('/topup', { method: 'POST', body: JSON.stringify({ pack: selectedPack, coin: selectedCoin }) });
    setLoading(false);
    if (!r) { toast('Payment failed'); return; }
    if (r.error) { toast(r.error); return; }
    if (r.invoiceUrl) window.open(r.invoiceUrl, '_blank');
    toast('Payment initiated!');
    onSuccess();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(2,6,8,0.7)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(880px, 100% - 24px)', maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto', background: 'linear-gradient(180deg, var(--color-bg2), var(--color-bg))', border: '1px solid var(--color-border2)', borderRadius: 18, padding: 22, boxShadow: '0 40px 120px -30px rgba(0,0,0,0.9), 0 0 0 1px rgba(34,211,238,0.05)', animation: 'modalIn 0.34s cubic-bezier(0.2,0.8,0.2,1)' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
          <span style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0, background: 'var(--color-accent-surface)', border: '1px solid var(--color-accent-line)', color: 'var(--color-accent)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v3M21 12v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5"/><path d="M17 13h4v4h-4a2 2 0 0 1 0-4z"/></svg>
          </span>
          <div style={{ flex: 1 }}>
            <p style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5 }}>YOUR WORKSPACE, REFUELLED</p>
            <h2 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', marginTop: 4 }}>Top up your wallet</h2>
            <p style={{ color: 'var(--color-muted)', fontSize: 12, marginTop: 4 }}>More room to build. One balance for all your API keys.</p>
          </div>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--color-border2)', background: 'none', color: 'var(--color-muted)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* Two columns */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 14 }}>
          {/* Left */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Payment method */}
            <div style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', borderRadius: 14, padding: 16 }}>
              <p style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5, marginBottom: 10 }}>PAYMENT METHOD</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
                {([['crypto', 'Crypto', 'Pay with cryptocurrency'], ['paypal', 'PayPal', 'Arrange on Discord'], ['card', 'Card', 'Arrange on Discord']] as const).map(([val, label, sub]) => (
                  <div
                    key={val}
                    onClick={() => setMethod(val)}
                    style={{ border: `1px solid ${method === val ? 'var(--color-accent-line)' : 'var(--color-border2)'}`, background: method === val ? 'var(--color-accent-surface)' : 'var(--color-bg)', borderRadius: 11, padding: 12, cursor: 'pointer', position: 'relative' }}
                  >
                    <b style={{ fontSize: 12.5, display: 'block' }}>{label}</b>
                    <small style={{ color: 'var(--color-muted)', fontSize: 10 }}>{sub}</small>
                    {method === val && (
                      <span style={{ position: 'absolute', top: 10, right: 10, width: 18, height: 18, borderRadius: '50%', background: 'var(--color-accent)', color: '#031217', display: 'grid', placeItems: 'center' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {method === 'crypto' && (
                <>
                  <p style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5, marginBottom: 10 }}>CRYPTOCURRENCY & NETWORK</p>
                  <div style={{ border: '1px solid var(--color-border2)', background: 'var(--color-bg)', borderRadius: 11, display: 'flex', alignItems: 'center', gap: 10, height: 50, padding: '0 12px' }}>
                    <span style={{ minWidth: 34, height: 26, fontFamily: 'var(--font-mono)', color: '#031217', background: 'var(--color-accent)', borderRadius: 7, display: 'grid', placeItems: 'center', padding: '0 6px', fontSize: 10.5, fontWeight: 700 }}>{coin.symbol}</span>
                    <select
                      value={selectedCoin}
                      onChange={e => setSelectedCoin(e.target.value)}
                      style={{ flex: 1, appearance: 'none', background: 'none', border: 0, outline: 'none', color: 'var(--color-text)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      {CATALOG.coins.map(c => <option key={c.id} value={c.id}>{c.name} &middot; {c.symbol}</option>)}
                    </select>
                    <span style={{ border: '1px solid var(--color-border2)', color: 'var(--color-muted)', borderRadius: 6, padding: '3px 7px', fontSize: 10 }}>{coin.network}</span>
                  </div>
                </>
              )}
              {method !== 'crypto' && (
                <p style={{ color: 'var(--color-muted)', fontSize: 11, lineHeight: 1.5, marginTop: 10 }}>PayPal and card payments are handled by our team on Discord. Open a ticket with the pack you want.</p>
              )}
            </div>

            {/* Pack selection */}
            <div style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', borderRadius: 14, padding: 16 }}>
              <p style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5, marginBottom: 10 }}>CHOOSE A PACK</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                {CATALOG.packs.map((p, i) => {
                  const perEur = (p.tokens / p.eur / 1e6).toFixed(p.tokens / p.eur / 1e6 >= 10 ? 0 : 2);
                  const isLast = i === CATALOG.packs.length - 1;
                  return (
                    <div
                      key={i}
                      onClick={() => setSelectedPack(i)}
                      style={{
                        border: `1px solid ${selectedPack === i ? 'var(--color-accent)' : 'var(--color-border2)'}`,
                        background: selectedPack === i ? 'var(--color-accent-surface)' : 'var(--color-bg)',
                        boxShadow: selectedPack === i ? '0 0 0 3px rgba(34,211,238,0.08)' : 'none',
                        borderRadius: 12, padding: 14, cursor: 'pointer', position: 'relative',
                        display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'baseline', gap: '2px 8px',
                        transition: 'border-color 0.15s, background 0.15s',
                        ...(isLast && CATALOG.packs.length % 2 === 1 ? { gridColumn: 'span 2' } : {}),
                      }}
                    >
                      {isLast && <span style={{ position: 'absolute', top: -8, right: 10, fontFamily: 'var(--font-mono)', letterSpacing: '.1em', textTransform: 'uppercase' as const, color: '#031217', background: 'var(--color-accent)', borderRadius: 5, padding: '2px 7px', fontSize: 8.5 }}>Best value</span>}
                      <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.03em' }}>{fmtTokens(p.tokens)}</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', fontSize: 14, fontWeight: 700, gridArea: '1/2' }}>{fmtEur(p.eur)}</span>
                      <span style={{ color: 'var(--color-muted)', fontSize: 10, gridRow: 2 }}>tokens</span>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-muted)', fontSize: 9.5, textAlign: 'right', gridArea: '2/2', whiteSpace: 'nowrap' }}>{perEur}M / &euro;</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', borderRadius: 14, padding: 16 }}>
              <p style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5 }}>YOU PAY</p>
              <p style={{ fontSize: 38, fontWeight: 700, letterSpacing: '-.04em', marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span>{fmtEur(pack.eur)}</span>
                <small style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.1em', color: 'var(--color-muted)', fontSize: 10 }}>EUR</small>
              </p>
              <p style={{ color: 'var(--color-muted)', fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>Network and processing fees are shown at checkout.</p>

              <dl style={{ borderTop: '1px solid var(--color-border)', marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', fontSize: 11.5, borderBottom: '1px solid var(--color-border)' }}>
                  <dt style={{ color: 'var(--color-muted)' }}>You receive</dt>
                  <dd style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--color-accent)' }}>+{fmtNum(pack.tokens)} tokens</dd>
                </div>
              </dl>

              <button
                onClick={submit}
                disabled={loading}
                style={{ width: '100%', height: 46, marginTop: 16, borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: '#031217', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, position: 'relative', overflow: 'hidden' }}
              >
                <span>{loading ? 'Processing...' : method === 'crypto' ? 'Proceed to payment' : 'Continue on Discord'}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M7 7h10v10"/></svg>
              </button>
              <p style={{ textAlign: 'center', color: 'var(--color-muted)', marginTop: 12, fontSize: 10 }}>Tokens are billed as weighted API units. Model multipliers apply.</p>
            </div>

            <div style={{ border: '1px solid var(--color-border)', background: 'var(--color-card)', borderRadius: 14, padding: 16 }}>
              <p style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)', fontSize: 9.5, marginBottom: 10 }}>PROMO CODE</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input placeholder="Enter code" style={{ flex: 1, minWidth: 0, height: 40, padding: '0 12px', fontSize: 12, border: '1px solid var(--color-border2)', background: 'var(--color-bg)', borderRadius: 9, outline: 'none', color: 'var(--color-text)', fontFamily: 'inherit' }} />
                <button style={{ height: 40, padding: '0 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid var(--color-border2)', background: 'none', color: 'var(--color-text)', cursor: 'pointer' }}>Apply</button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal footer */}
        <div style={{ borderTop: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)', color: 'var(--color-muted)', display: 'flex', justifyContent: 'space-between', marginTop: 18, paddingTop: 14, fontSize: 9.5 }}>
          <span>cli.eminencehw.com</span>
          <span style={{ letterSpacing: '.14em', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <i style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-accent)', boxShadow: '0 0 8px var(--color-accent)', display: 'block' }} />
            ONE WALLET. EVERY MODEL.
          </span>
        </div>
      </div>
    </div>
  );
}
