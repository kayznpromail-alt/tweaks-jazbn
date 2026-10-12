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
    <div style={{ animation: 'pageIn 0.32s cubic-bezier(0.23,1,0.32,1)' }}>
      <h2 className="text-[22px] font-bold mb-6 tracking-tight flex items-center gap-3">
        API Keys
        <span className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, var(--color-border2), transparent)' }} />
      </h2>

      <div className="grid grid-cols-[1fr_300px] gap-4 max-md:grid-cols-1">
        <div>
          <div className="mb-4">
            <button
              onClick={() => { setKeyName(''); setModalOpen(true); }}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white border-none"
              style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)', boxShadow: '0 2px 8px rgba(108,92,231,0.3)' }}
            >
              <Plus size={14} /> Create New Key
            </button>
          </div>

          {revealed && (
            <div className="rounded-xl p-5 mb-4 text-center" style={{ background: 'var(--color-accent-surface)', border: '1px solid rgba(108,92,231,0.2)' }}>
              <p className="text-[13px] text-text mb-2">Your new API key:</p>
              <code className="text-[13px] text-accent2 break-all" style={{ fontFamily: 'var(--font-mono)' }}>{revealed}</code>
              <p className="text-xs text-yellow mt-2.5 font-medium">Save this key now - you won't be able to see it again!</p>
              <button onClick={() => copyText(revealed)} className="mt-3 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white border-none" style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)' }}>Copy Key</button>
            </div>
          )}

          {keys.length === 0 && <div className="text-center py-11 text-muted text-sm">No API keys yet. Create one to get started.</div>}

          {keys.map(k => (
            <div
              key={k.id}
              className="flex items-center justify-between px-4 py-4 rounded-xl mb-2.5 transition-all duration-200 hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_4px_16px_rgba(0,0,0,0.2)]"
              style={{ background: 'var(--color-card2)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold mb-1">{k.name}</div>
                <div className="text-xs text-muted" style={{ fontFamily: 'var(--font-mono)' }}>{k.masked}</div>
                <div className="flex gap-4 mt-2 text-[11px] text-muted">
                  <span>Created {fmtDate(k.createdAt)}</span>
                  <span>Last used {k.lastUsedAt ? fmtAgo(k.lastUsedAt) : 'never'}</span>
                </div>
              </div>
              <div className="flex gap-2 items-center shrink-0 ml-3.5">
                <button
                  onClick={() => toggleKey(k.id, !k.enabled)}
                  className="relative w-[38px] h-[22px] rounded-full border-none transition-colors duration-200"
                  style={{ background: k.enabled ? 'var(--color-accent)' : 'var(--color-muted2)' }}
                  title={k.enabled ? 'Disable' : 'Enable'}
                >
                  <span
                    className="absolute w-4 h-4 rounded-full bg-white top-[3px] left-[3px] transition-transform duration-200"
                    style={{ transform: k.enabled ? 'translateX(16px)' : 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
                  />
                </button>
                <button
                  onClick={() => deleteKey(k.id, k.name)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-red border-none"
                  style={{ background: 'var(--color-red-bg)', border: '1px solid rgba(248,113,113,0.12)' }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl p-5" style={{ background: 'var(--color-card2)', border: '1px solid var(--color-border)' }}>
          <h4 className="text-[13px] font-semibold mb-3.5 flex items-center gap-2">
            <Link size={15} className="text-accent2" /> Connect your app
          </h4>
          <div className="mb-3.5">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">Base URL</div>
            <div
              onClick={() => copyText('https://api.edgey.shop/v1')}
              className="px-3 py-2.5 rounded-lg text-xs cursor-pointer break-all transition-all duration-150 hover:border-accent hover:bg-accent-surface"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
            >
              https://api.edgey.shop/v1
            </div>
          </div>
          <div className="mb-3.5">
            <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">Your first key</div>
            <div
              onClick={() => firstKey && copyText(firstKey)}
              className="px-3 py-2.5 rounded-lg text-xs cursor-pointer break-all transition-all duration-150 hover:border-accent hover:bg-accent-surface"
              style={{ fontFamily: 'var(--font-mono)', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
            >
              {firstKey || (keys[0]?.masked ?? '--')}
            </div>
          </div>
          <p className="text-xs text-muted leading-relaxed mt-4">Compatible with OpenAI and Anthropic SDKs. Click to copy.</p>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }} onClick={() => setModalOpen(false)}>
          <div className="rounded-2xl p-8 w-full max-w-[400px]" style={{ background: 'var(--color-card)', border: '1px solid var(--color-border2)', boxShadow: '0 4px 24px rgba(0,0,0,0.4)', animation: 'modalIn 0.25s cubic-bezier(0.23,1,0.32,1)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-[17px] font-bold mb-5 tracking-tight">Create API Key</h3>
            <div className="mb-4">
              <label className="block text-[11.5px] font-semibold text-muted mb-1.5 uppercase tracking-wide">Key name</label>
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
              <button onClick={() => setModalOpen(false)} className="px-5 py-2.5 rounded-lg text-[13px] font-semibold" style={{ background: 'var(--color-card2)', border: '1px solid var(--color-border2)', color: 'var(--color-text)' }}>Cancel</button>
              <button onClick={createKey} className="px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white border-none" style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)', boxShadow: '0 2px 8px rgba(108,92,231,0.3)' }}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
