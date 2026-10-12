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
    <div style={{ animation: 'pageIn 0.35s cubic-bezier(0.23,1,0.32,1)' }}>
      <div className="flex justify-between items-center mb-5">
        <h2 className="text-[18px] font-bold tracking-tight">Wallet</h2>
        <button onClick={() => setTopupOpen(true)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white border-none transition-all duration-150 hover:brightness-110" style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)', boxShadow: '0 2px 8px rgba(108,92,231,0.25)' }}>
          <Plus size={13} /> Add Tokens
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5 max-md:grid-cols-1">
        <StatCard icon={<Coins size={15} />} label="Available Balance" value={fmtTokens(balance)} accent="var(--color-accent2)" />
        <StatCard icon={<Activity size={15} />} label="Requests (24h)" value={fmtNum(requests24h)} />
        <StatCard icon={<KeyRound size={15} />} label="Active API Keys" value={keyCount != null ? String(keyCount) : '--'} />
      </div>

      {modelAccess.length > 0 && (
        <div className="rounded-xl p-5 mb-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
          <h3 className="text-[13px] font-semibold mb-3.5">Model Quotas</h3>
          <div className="grid gap-2.5">
            {modelAccess.map(ma => (
              <div key={ma.model} className="flex items-center gap-3.5 p-3.5 rounded-lg" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0" style={{ background: 'var(--color-accent-surface)', color: 'var(--color-accent2)' }}>
                  {ma.model.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold">{ma.model}</div>
                  <div className="text-[10.5px] text-muted">{fmtTokens(ma.used)} used of {fmtTokens(ma.quota)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-[5px] rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(100, (ma.used / ma.quota) * 100)}%`, background: ma.remaining > 0 ? 'var(--color-accent)' : 'var(--color-red)' }} />
                  </div>
                  <div className="text-right min-w-[60px]">
                    <div className="text-[13px] font-bold" style={{ color: ma.remaining > 0 ? 'var(--color-accent2)' : 'var(--color-red)' }}>{fmtTokens(ma.remaining)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl p-5" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[13px] font-semibold">Activity</h3>
          <div className="flex gap-0.5 rounded-lg p-[3px]" style={{ background: 'var(--color-bg2)' }}>
            {(['all', 'credited', 'pending'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className="px-3 py-[5px] rounded-md text-[11px] font-semibold border-none transition-all duration-150"
                style={filter === f
                  ? { background: 'var(--color-accent)', color: '#fff', boxShadow: '0 1px 4px rgba(108,92,231,0.25)' }
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
              <thead><tr>{['ID', 'Amount', 'Tokens', 'Method', 'Status', 'Date'].map(h => <th key={h} className="text-left px-3 py-2 text-muted font-medium text-[10.5px] uppercase tracking-wider whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-white/[0.015] transition-colors">
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>#{p.id}</td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtEur(p.amount_eur)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtTokens(p.tokens)}</td>
                    <td className="px-3 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{p.note || p.provider}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-[6px] h-[6px] rounded-full" style={{ background: p.status === 'credited' ? 'var(--color-green)' : p.status === 'pending' ? 'var(--color-yellow)' : 'var(--color-red)' }} />
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
      <div className="rounded-2xl p-7 w-full max-w-[420px]" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border2)', boxShadow: '0 4px 32px rgba(0,0,0,0.5)', animation: 'modalIn 0.25s cubic-bezier(0.23,1,0.32,1)' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-[16px] font-bold mb-5 tracking-tight">Add Tokens</h3>

        <div className="mb-4">
          <label className="block text-[10.5px] font-semibold text-muted mb-1.5 uppercase tracking-wider">Pay with</label>
          <div className="relative" ref={ddRef}>
            <div onClick={() => setCoinOpen(!coinOpen)} className="flex items-center justify-between px-3.5 py-2.5 rounded-lg cursor-pointer text-[13px] transition-all duration-150" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border2)' }}>
              <span>{coin ? `${coin.symbol} - ${coin.name}` : 'Select cryptocurrency'}</span>
              <ChevronDown size={14} className="text-muted" style={{ transform: coinOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {coinOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg z-10 max-h-[200px] overflow-y-auto" style={{ background: 'var(--color-card2)', border: '1px solid var(--color-border2)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
                {CATALOG.coins.map(c => (
                  <div key={c.id} onClick={() => { setSelectedCoin(c.id); setCoinOpen(false); }} className="flex items-center gap-2.5 px-3.5 py-2.5 cursor-pointer text-[12.5px] transition-colors hover:bg-white/[0.03]">
                    <span className="font-bold min-w-[40px] text-accent2">{c.symbol}</span>
                    <span>{c.name}</span>
                    <span className="text-muted text-[10px] ml-auto">{c.network}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-[10.5px] font-semibold text-muted mb-1.5 uppercase tracking-wider">Token pack</label>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(85px,1fr))] gap-2">
            {CATALOG.packs.map((p, i) => (
              <button
                key={i}
                onClick={() => setSelectedPack(i)}
                className="py-3 px-2 rounded-lg text-center text-[12px] transition-all duration-150 border-none"
                style={selectedPack === i
                  ? { background: 'var(--color-accent-surface2)', boxShadow: '0 0 0 2px var(--color-accent)', border: '1px solid var(--color-accent)' }
                  : { background: 'var(--color-bg2)', border: '1px solid var(--color-border2)' }
                }
              >
                <div className="font-bold text-[14px] tracking-tight">{fmtEur(p.eur)}</div>
                <div className="text-[10px] text-muted mt-0.5">{fmtTokens(p.tokens)}</div>
              </button>
            ))}
          </div>
        </div>

        {ready && (
          <div className="rounded-xl p-4 mt-4" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
            <div className="flex justify-between text-[12px] mb-2"><span className="text-muted">Pack</span><span>{fmtEur(pack!.eur)}</span></div>
            <div className="flex justify-between text-[12px] mb-2"><span className="text-muted">Payment</span><span>{coin!.symbol} ({coin!.network})</span></div>
            <div className="flex justify-between text-[12px] pt-2.5 mt-2 font-bold" style={{ borderTop: '1px solid var(--color-border)' }}><span className="text-muted">You receive</span><span className="text-accent2">{fmtTokens(pack!.tokens)} tokens</span></div>
          </div>
        )}

        <div className="flex gap-2.5 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[12px] font-semibold" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border2)', color: 'var(--color-text)' }}>Cancel</button>
          <button onClick={submit} disabled={!ready || loading} className="px-4 py-2 rounded-lg text-[12px] font-semibold text-white border-none disabled:opacity-50 transition-all duration-150 hover:brightness-110" style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)', boxShadow: '0 2px 8px rgba(108,92,231,0.25)' }}>
            {loading ? 'Processing...' : 'Continue to Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
