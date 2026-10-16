import { useEffect, useState } from 'react';
import { Plus, Link, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtAgo } from '@/lib/utils';
import { toast, copyText } from '@/components/Toast';

interface Key {
  id: number;
  name: string;
  masked: string;
  enabled: boolean;
  createdAt: number;
  lastUsedAt?: number;
}

export default function Keys() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [firstKey, setFirstKey] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [revealed, setRevealed] = useState('');

  async function load() {
    const r = await api<{ keys: Key[] }>('/keys');
    if (r?.keys) setKeys(r.keys);
    const me = await api<{ firstKey?: string }>('/me');
    if (me?.firstKey) setFirstKey(me.firstKey);
  }

  useEffect(() => { load(); }, []);

  async function createKey() {
    const name = keyName.trim() || 'API key';
    const r = await api<{ key?: string; error?: string }>('/keys', { method: 'POST', body: JSON.stringify({ name }) });
    if (!r) return;
    if (r.error) { toast(r.error === 'key_limit' ? 'Key limit reached (max 6)' : r.error); return; }
    setModalOpen(false);
    setKeyName('');
    if (r.key) setRevealed(r.key);
    load();
  }

  async function toggleKey(id: number, enabled: boolean) {
    await api('/keys/' + id, { method: 'PATCH', body: JSON.stringify({ enabled }) });
    load();
  }

  async function deleteKey(id: number, name: string) {
    if (!confirm('Delete key "' + name + '"? This cannot be undone.')) return;
    await api('/keys/' + id, { method: 'DELETE' });
    setRevealed('');
    load();
  }

  return (
    <div style={{ animation: 'pageIn 0.45s cubic-bezier(0.2,0.8,0.2,1)' }}>
      <div className="text-[10px] font-semibold uppercase mb-3" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em', color: 'var(--color-accent)' }}>
        WORKSPACE / KEYS
      </div>

      <div className="flex justify-between items-center mb-2">
        <h1 className="font-bold" style={{ fontSize: 'clamp(28px, 5vw, 38px)', letterSpacing: '-.035em', lineHeight: 1.1 }}>
          API Keys
        </h1>
        <button
          onClick={() => { setKeyName(''); setModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-semibold transition-all duration-150 hover:brightness-110"
          style={{ background: 'var(--color-accent)', color: '#031217', border: 'none' }}
        >
          <Plus size={13} /> Create Key
        </button>
      </div>
      <p className="text-muted text-[13px] mb-6">Manage your API keys for authentication.</p>
      <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', marginBottom: 32 }} />

      <div className="flex gap-5 max-md:flex-col">
        <div className="flex-1 min-w-0">
          {revealed && (
            <div className="rounded-[14px] p-5 mb-4 text-center" style={{ background: 'var(--color-accent-surface)', border: '1px solid var(--color-accent-line)' }}>
              <p className="text-[12px] text-text2 mb-2">Your new API key:</p>
              <code className="text-[12px] break-all" style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>{revealed}</code>
              <p className="text-[11px] mt-2 font-medium" style={{ color: 'var(--color-yellow)' }}>Save this key now - you won't see it again!</p>
              <button onClick={() => copyText(revealed)} className="mt-2.5 px-4 py-1.5 rounded-lg text-[11px] font-semibold border-none" style={{ background: 'var(--color-accent)', color: '#031217' }}>Copy Key</button>
            </div>
          )}

          {keys.length === 0 && <div className="text-center py-10 text-muted text-[12px]">No API keys yet. Create one to get started.</div>}

          {keys.map(k => (
            <div
              key={k.id}
              className="flex items-center justify-between px-4 py-3.5 rounded-[14px] mb-3 transition-all duration-150 hover:bg-white/[0.02]"
              style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold mb-0.5">{k.name}</div>
                <div className="text-[11px] text-muted" style={{ fontFamily: 'var(--font-mono)' }}>{k.masked}</div>
                <div className="flex gap-3.5 mt-1.5 text-[10px] text-muted" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.05em' }}>
                  <span>Created {fmtDate(k.createdAt)}</span>
                  <span>Last used {k.lastUsedAt ? fmtAgo(k.lastUsedAt) : 'never'}</span>
                </div>
              </div>
              <div className="flex gap-2 items-center shrink-0 ml-3">
                <button
                  onClick={() => toggleKey(k.id, !k.enabled)}
                  className="relative w-[34px] h-[20px] rounded-full border-none transition-colors duration-200"
                  style={{ background: k.enabled ? 'var(--color-accent)' : 'var(--color-muted2)' }}
                  title={k.enabled ? 'Disable' : 'Enable'}
                >
                  <span
                    className="absolute w-3.5 h-3.5 rounded-full bg-white top-[3px] left-[3px] transition-transform duration-200"
                    style={{ transform: k.enabled ? 'translateX(14px)' : 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
                  />
                </button>
                <button
                  onClick={() => deleteKey(k.id, k.name)}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border-none transition-all duration-150"
                  style={{ background: 'var(--color-red-bg)', color: 'var(--color-red)' }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="w-[280px] max-md:w-full shrink-0 rounded-[14px] p-5" style={{ background: 'linear-gradient(180deg, var(--color-card), var(--color-bg2))', border: '1px solid var(--color-border)' }}>
          <h4 className="text-[9.5px] font-semibold uppercase mb-4 flex items-center gap-2" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em', color: 'var(--color-muted)' }}>
            <Link size={13} className="text-accent" /> Connect your app
          </h4>
          <div className="mb-3">
            <div className="text-[9px] font-semibold text-muted uppercase mb-1" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em' }}>Base URL</div>
            <div
              onClick={() => copyText('https://gw.edgey.shop/v1')}
              className="px-3 py-2 rounded-lg text-[11px] cursor-pointer break-all transition-all duration-150 hover:border-accent"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
            >
              https://gw.edgey.shop/v1
            </div>
          </div>
          <div className="mb-3">
            <div className="text-[9px] font-semibold text-muted uppercase mb-1" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.14em' }}>Your first key</div>
            <div
              onClick={() => firstKey && copyText(firstKey)}
              className="px-3 py-2 rounded-lg text-[11px] cursor-pointer break-all transition-all duration-150 hover:border-accent"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
            >
              {firstKey || (keys[0]?.masked ?? '--')}
            </div>
          </div>
          <p className="text-[10px] text-muted leading-relaxed mt-3">Compatible with OpenAI and Anthropic SDKs. Click to copy.</p>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }} onClick={() => setModalOpen(false)}>
          <div className="rounded-2xl p-7 w-full max-w-[380px]" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border2)', boxShadow: '0 4px 32px rgba(0,0,0,0.5)', animation: 'modalIn 0.25s cubic-bezier(0.23,1,0.32,1)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold mb-5 tracking-tight">Create API Key</h3>
            <div className="mb-4">
              <label className="block text-[9.5px] font-semibold text-muted mb-1.5 uppercase" style={{ fontFamily: 'var(--font-mono)', letterSpacing: '.18em' }}>Key name</label>
              <input
                value={keyName}
                onChange={e => setKeyName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createKey()}
                placeholder="e.g. My App"
                maxLength={40}
                autoFocus
              />
            </div>
            <div className="flex gap-2.5 justify-end mt-5">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 rounded-lg text-[12px] font-semibold" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border2)', color: 'var(--color-text)' }}>Cancel</button>
              <button onClick={createKey} className="px-4 py-2 rounded-lg text-[12px] font-semibold border-none transition-all duration-150 hover:brightness-110" style={{ background: 'var(--color-accent)', color: '#031217' }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
