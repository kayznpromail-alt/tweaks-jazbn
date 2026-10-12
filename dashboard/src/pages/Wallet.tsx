import { useEffect, useState, useRef } from 'react';
import { Plus, ChevronDown } from 'lucide-react';
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

export default function Wallet() {
  const [balance, setBalance] = useState<number | null>(null);
  const [requests24h, setRequests24h] = useState<number | null>(null);
  const [keyCount, setKeyCount] = useState<number | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [filter, setFilter] = useState('all');
  const [topupOpen, setTopupOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const [me, pay] = await Promise.all([
        api<{ balance: number; requests24h: number; keyCount: number }>('/me'),
        api<{ payments: Payment[] }>('/payments'),
      ]);
      if (me) { setBalance(me.balance); setRequests24h(me.requests24h); setKeyCount(me.keyCount); }
      if (pay?.payments) setPayments(pay.payments);
    })();
  }, []);

  const filtered = filter === 'all' ? payments : payments.filter(p => filter === 'credited' ? p.status === 'credited' : p.status === 'pending');

  return (
    <div style={{ animation: 'pageIn 0.32s cubic-bezier(0.23,1,0.32,1)' }}>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-[22px] font-bold tracking-tight">Wallet</h2>
        <button onClick={() => setTopupOpen(true)} className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white border-none" style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)', boxShadow: '0 2px 8px rgba(108,92,231,0.3)' }}>
          <Plus size={14} /> Add Tokens
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3.5 mb-6 max-md:grid-cols-1">
        <WalletStat label="Available Balance" value={fmtTokens(balance)} color="var(--color-cyan)" />
        <WalletStat label="Requests (24h)" value={fmtNum(requests24h)} />
        <WalletStat label="Active API Keys" value={keyCount != null ? String(keyCount) : '--'} />
      </div>

      <div className="rounded-xl px-7 py-6 mb-6 flex items-center justify-between relative overflow-hidden" style={{ background: 'linear-gradient(135deg, rgba(108,92,231,0.12) 0%, rgba(139,92,246,0.08) 50%, rgba(108,92,231,0.05) 100%)', border: '1px solid rgba(108,92,231,0.15)' }}>
        <div className="absolute -top-[30%] -right-[5%] w-[180px] h-[180px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(108,92,231,0.12), transparent 70%)' }} />
        <div>
          <h3 className="text-base font-semibold mb-1.5">One balance for every model</h3>
          <p className="text-[13px] text-muted">Your tokens work across all supported models. Rates vary by model.</p>
        </div>
      </div>

      <div className="rounded-xl p-6" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-sm font-semibold mb-3.5">Recent Activity</h3>
        <div className="flex gap-0.5 mb-4 w-fit rounded-md p-0.5" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
          {(['all', 'credited', 'pending'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-4 py-1.5 rounded-[5px] text-xs font-semibold border-none transition-all duration-150"
              style={filter === f
                ? { background: 'var(--color-accent)', color: '#fff', boxShadow: '0 1px 4px rgba(108,92,231,0.3)' }
                : { background: 'none', color: 'var(--color-muted)' }
              }
            >
              {f === 'all' ? 'All' : f === 'credited' ? 'Confirmed' : 'Pending'}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-11 text-muted text-sm">No transactions yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg2)' }}>
            <table className="w-full border-collapse text-[13px]">
              <thead><tr>{['ID', 'Amount', 'Tokens', 'Method', 'Status', 'Date'].map(h => <th key={h} className="text-left px-3.5 py-2.5 text-muted font-semibold text-[11px] uppercase tracking-wide whitespace-nowrap" style={{ background: 'var(--color-card)', borderBottom: '1px solid var(--color-border)' }}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-white/[0.015]">
                    <td className="px-3.5 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>#{p.id}</td>
                    <td className="px-3.5 py-2.5 font-medium whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtEur(p.amount_eur)}</td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtTokens(p.tokens)}</td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{p.note || p.provider}</td>
                    <td className="px-3.5 py-2.5 whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold capitalize ${p.status === 'credited' ? 'bg-green-bg text-green' : p.status === 'pending' ? 'bg-yellow-bg text-yellow' : 'bg-red-bg text-red'}`}>{p.status}</span>
                    </td>
                    <td className="px-3.5 py-2.5 text-muted whitespace-nowrap" style={{ borderBottom: '1px solid var(--color-border)' }}>{fmtDate(p.created_at)}</td>
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

function WalletStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl p-5 transition-all duration-200 hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_rgba(0,0,0,0.2)]" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)' }}>
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">{label}</div>
      <div className="text-[28px] font-bold tracking-tight" style={{ color }}>{value}</div>
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="rounded-2xl p-8 w-full max-w-[440px]" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border2)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)', animation: 'modalIn 0.25s cubic-bezier(0.23,1,0.32,1)' }} onClick={e => e.stopPropagation()}>
        <h3 className="text-[17px] font-bold mb-5 tracking-tight">Add Tokens</h3>

        <div className="mb-4">
          <label className="block text-[11.5px] font-semibold text-muted mb-1.5 uppercase tracking-wide">Pay with</label>
          <div className="relative" ref={ddRef}>
            <div onClick={() => setCoinOpen(!coinOpen)} className="flex items-center justify-between px-3.5 py-3 rounded-lg cursor-pointer text-sm transition-all duration-150" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border2)' }}>
              <span>{coin ? `${coin.symbol} - ${coin.name}` : 'Select cryptocurrency'}</span>
              <ChevronDown size={16} className="text-muted" style={{ transform: coinOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </div>
            {coinOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg z-10 max-h-[220px] overflow-y-auto" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border2)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)' }}>
                {CATALOG.coins.map(c => (
                  <div key={c.id} onClick={() => { setSelectedCoin(c.id); setCoinOpen(false); }} className="flex items-center gap-2.5 px-3.5 py-3 cursor-pointer text-[13px] transition-colors hover:bg-accent-surface">
                    <span className="font-bold min-w-[44px] text-accent2">{c.symbol}</span>
                    <span>{c.name}</span>
                    <span className="text-muted text-[11px]">{c.network}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-[11.5px] font-semibold text-muted mb-1.5 uppercase tracking-wide">Token pack</label>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2">
            {CATALOG.packs.map((p, i) => (
              <button
                key={i}
                onClick={() => setSelectedPack(i)}
                className="py-3.5 px-2 rounded-lg text-center text-[13px] transition-all duration-200 border-none"
                style={selectedPack === i
                  ? { borderColor: 'var(--color-accent)', background: 'var(--color-accent-surface2)', boxShadow: '0 0 0 3px var(--color-accent-glow)', border: '1px solid var(--color-accent)' }
                  : { background: 'var(--color-card2)', border: '1px solid var(--color-border2)' }
                }
              >
                <div className="font-bold text-[15px] tracking-tight">{fmtEur(p.eur)}</div>
                <div className="text-[11px] text-muted mt-0.5">{fmtTokens(p.tokens)} tokens</div>
              </button>
            ))}
          </div>
        </div>

        {ready && (
          <div className="rounded-xl p-4 mt-4" style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}>
            <div className="flex justify-between text-[13px] mb-2"><span className="text-muted">Pack</span><span>{fmtEur(pack!.eur)}</span></div>
            <div className="flex justify-between text-[13px] mb-2"><span className="text-muted">Payment</span><span>{coin!.symbol} ({coin!.network})</span></div>
            <div className="flex justify-between text-[13px] pt-2.5 mt-2 font-bold" style={{ borderTop: '1px solid var(--color-border)' }}><span className="text-muted">You receive</span><span className="text-accent2">{fmtTokens(pack!.tokens)} tokens</span></div>
          </div>
        )}

        <div className="flex gap-2.5 justify-end mt-5">
          <button onClick={onClose} className="px-5 py-2.5 rounded-lg text-[13px] font-semibold" style={{ background: 'var(--color-card2)', border: '1px solid var(--color-border2)', color: 'var(--color-text)' }}>Cancel</button>
          <button onClick={submit} disabled={!ready || loading} className="px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white border-none disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)', boxShadow: '0 2px 8px rgba(108,92,231,0.3)' }}>
            {loading ? 'Processing...' : 'Continue to Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
