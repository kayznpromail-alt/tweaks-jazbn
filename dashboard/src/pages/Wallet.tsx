import { useEffect, useState, useRef } from 'react';
import { Plus, ChevronDown, Coins, Activity, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtTokens, fmtNum, fmtEur, fmtDate } from '@/lib/utils';
import { toast } from '@/components/Toast';
import { CATALOG } from '@/lib/catalog';

interface Payment {
  id: number;
  amount_eur: number;
  tokens: number;
  note?: string;
  provider: string;
  status: string;
  created_at: number;
}

interface ModelAccess {
  model: string;
  quota: number;
  used: number;
  remaining: number;
  grantedAt: number;
}

export default function Wallet() {
  const [balance, setBalance] = useState<number | null>(null);
  const [requests24h, setRequests24h] = useState<number | null>(null);
  const [keyCount, setKeyCount] = useState<number | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [modelAccess, setModelAccess] = useState<ModelAccess[]>([]);
  const [filter, setFilter] = useState('all');
  const [topupOpen, setTopupOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [me, pay] = await Promise.all([
        api<{ balance: number; requests24h: number; keyCount: number; modelAccess?: ModelAccess[] }>('/me'),
        api<{ payments: Payment[] }>('/payments'),
      ]);
      if (me) { setBalance(me.balance); setRequests24h(me.requests24h); setKeyCount(me.keyCount); if (me.modelAccess) setModelAccess(me.modelAccess); }
      if (pay?.payments) setPayments(pay.payments);
    })();
  }, []);

  const filtered = filter === 'all' ? payments : payments.filter(p => filter === 'credited' ? p.status === 'credited' : p.status === 'pending');

  return (
    <div style={{ animation: 'pageIn 0.45s cubic-bezier(0.2,0.8,0.2,1)' }}>
      <div className="text-[10px] font-semibold uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em', color: 'var(--color-accent)' }}>
        WORKSPACE / WALLET
      </div>

      <div className="flex justify-between items-center mb-2">
        <h1 className="font-bold" style={{ fontSize: 'clamp(28px, 5vw, 38px)', letterSpacing: '-.035em', lineHeight: 1.1 }}>
          Wallet
        </h1>
        <button
          onClick={() => setTopupOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-150 hover:brightness-110"
          style={{ background: 'var(--color-accent)', color: '#031217', border: 'none' }}
        >
          <Plus size={13} /> Add Tokens
        </button>
      </div>
      <p className="text-muted text-[13px] mb-6">Manage your token balance and payment history.</p>
      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', marginBottom: 32 }} />

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-5 mb-8 max-md:grid-cols-1">
        <WalletStat label="Available balance" value={fmtTokens(balance)} accent />
        <WalletStat label="Requests (24h)" value={fmtNum(requests24h)} />
        <WalletStat label="Active keys" value={keyCount != null ? String(keyCount) : '--'} />
      </div>

      {modelAccess.length > 0 && (
        <div className="rounded-[14px] p-6 mb-8" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
          <div className="text-[9.5px] font-semibold uppercase mb-4" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
            Model quotas
          </div>
          <div className="grid gap-2.5">
            {modelAccess.map(ma => (
              <div key={ma.model} className="flex items-center gap-3.5 p-3.5 rounded-lg" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold">{ma.model}</div>
                  <div className="text-[10px] text-muted">{fmtTokens(ma.used)} used of {fmtTokens(ma.quota)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 rounded-full overflow-hidden" style={{ height: 4, background: 'var(--color-bg2)' }}>
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, (ma.used / ma.quota) * 100)}%`, background: ma.remaining > 0 ? 'var(--color-accent)' : 'var(--color-red)' }} />
                  </div>
                  <div className="text-right min-w-[60px]">
                    <div className="text-[14px] font-bold" style={{ color: ma.remaining > 0 ? 'var(--color-accent)' : 'var(--color-red)' }}>{fmtTokens(ma.remaining)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity */}
      <div className="rounded-[14px] p-6" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-[9.5px] font-semibold uppercase" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
            Activity
          </div>
          <div className="flex gap-0.5 rounded-lg p-[3px]" style={{ background: 'var(--color-bg)' }}>
            {(['all', 'credited', 'pending'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-3 py-[5px] rounded-md text-[11px] font-semibold border-none transition-all duration-150"
                style={filter === f
                  ? { background: 'var(--color-accent)', color: '#031217' }
                  : { background: 'none', color: 'var(--color-muted)' }
                }
              >
                {f === 'all' ? 'All' : f === 'credited' ? 'Confirmed' : 'Pending'}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-10 text-muted text-[12px]">No transactions yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead><tr>{['ID', 'Amount', 'Tokens', 'Method', 'Status', 'Date'].map(h => <th key={h} className="text-left px-3 py-2 text-muted font-medium text-[10px] uppercase tracking-wider whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>#{p.id}</td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtEur(p.amount_eur)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{fmtTokens(p.tokens)}</td>
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{p.note || p.provider}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-[7px] h-[7px] rounded-full" style={{ background: p.status === 'credited' ? '#4ade80' : p.status === 'pending' ? 'var(--color-yellow)' : 'var(--color-red)', boxShadow: p.status === 'credited' ? '0 0 6px rgba(74,222,128,0.4)' : p.status === 'pending' ? '0 0 6px rgba(251,191,36,0.4)' : '0 0 6px rgba(248,113,113,0.4)' }} />
                        <span className="text-[11px] capitalize">{p.status}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {topupOpen && <TopupModal onClose={() => { setTopupOpen(false); }} onSuccess={() => { setTopupOpen(false); window.location.reload(); }} />}
    </div>
  );
}

function WalletStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="p-6 rounded-[14px]" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
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

function TopupModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [selectedPack, setSelectedPack] = useState<number | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [coinOpen, setCoinOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ddRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ddRef.current && !ddRef.current.contains(e.target as Node)) setCoinOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const coin = selectedCoin ? CATALOG.coins.find(c => c.id === selectedCoin) : null;
  const pack = selectedPack != null ? CATALOG.packs[selectedPack] : null;
  const ready = selectedPack != null && selectedCoin;

  async function submit() {
    if (!ready) return;
    setLoading(true);
    const r = await api<{ invoiceUrl?: string; error?: string }>('/topup', { method: 'POST', body: JSON.stringify({ pack: selectedPack, coin: selectedCoin }) });
    setLoading(false);
    if (!r) { toast('Payment failed'); return; }
    if (r.error) { toast(r.error); return; }
    if (r.invoiceUrl) window.open(r.invoiceUrl, '_blank');
    toast('Payment initiated! Complete it in the opened window.');
    onSuccess();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div className="rounded-2xl p-7 w-full max-w-[480px]" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border2)', boxShadow: '0 4px 32px rgba(0,0,0,0.5)', animation: 'modalIn 0.25s cubic-bezier(0.23,1,0.32,1)' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-[18px] font-bold mb-1 tracking-tight">Add Tokens</h3>
        <p className="text-[12px] text-muted mb-5">Select a payment method and token pack.</p>

        <div className="mb-5">
          <div className="text-[9.5px] font-semibold uppercase mb-2" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>Pay with</div>
          <div className="relative" ref={ddRef}>
            <div onClick={() => setCoinOpen(!coinOpen)} className="flex items-center justify-between px-3.5 py-2.5 rounded-lg cursor-pointer text-[13px] transition-all duration-150" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border2)' }}>
              <span>{coin ? `${coin.symbol} - ${coin.name}` : 'Select cryptocurrency'}</span>
              <ChevronDown size={14} className="text-muted" style={{ transform: coinOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {coinOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg z-10 max-h-[200px] overflow-y-auto" style={{ background: 'var(--color-card2)', border: '1px solid var(--color-border2)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
                {CATALOG.coins.map(c => (
                  <div key={c.id} onClick={() => { setSelectedCoin(c.id); setCoinOpen(false); }} className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer text-[12.5px] transition-colors hover:bg-white/[0.03]">
                    <span className="font-bold min-w-[40px]" style={{ color: 'var(--color-accent)' }}>{c.symbol}</span>
                    <span>{c.name}</span>
                    <span className="text-muted text-[10px] ml-auto" style={{ fontFamily: 'var(--font-mono)' }}>{c.network}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mb-5">
          <div className="text-[9.5px] font-semibold uppercase mb-2" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>Token pack</div>
          <div className="grid grid-cols-2 gap-2.5">
            {CATALOG.packs.map((p, i) => (
              <button
                key={i}
                onClick={() => setSelectedPack(i)}
                className="py-3.5 px-3 rounded-xl text-left transition-all duration-150 border-none"
                style={selectedPack === i
                  ? { background: 'var(--color-accent-surface2)', border: '2px solid var(--color-accent)' }
                  : { background: 'var(--color-bg)', border: '1px solid var(--color-border)' }
                }
              >
                <div className="font-bold text-[15px] tracking-tight">{fmtEur(p.eur)}</div>
                <div className="text-[10px] text-muted mt-0.5" style={{ fontFamily: 'var(--font-mono)' }}>{fmtTokens(p.tokens)} tokens</div>
              </button>
            ))}
          </div>
        </div>

        {ready && (
          <div className="rounded-xl p-4 mb-5" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
            <div className="flex justify-between text-[12px] mb-2"><span className="text-muted">Pack</span><span>{fmtEur(pack!.eur)}</span></div>
            <div className="flex justify-between text-[12px] mb-2"><span className="text-muted">Payment</span><span>{coin!.symbol} ({coin!.network})</span></div>
            <div className="flex justify-between text-[12px] pt-2.5 mt-2 font-bold" style={{ borderTop: '1px solid var(--color-border)' }}><span className="text-muted">You receive</span><span style={{ color: 'var(--color-accent)' }}>{fmtTokens(pack!.tokens)} tokens</span></div>
          </div>
        )}

        <div className="flex gap-2.5 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-150" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border2)', color: 'var(--color-text)' }}>Cancel</button>
          <button onClick={submit} disabled={!ready || loading} className="px-5 py-2 rounded-lg text-[12px] font-semibold border-none disabled:opacity-50 transition-all duration-150 hover:brightness-110" style={{ background: 'var(--color-accent)', color: '#031217' }}>
            {loading ? 'Processing...' : 'Continue to Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
