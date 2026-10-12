import { useState, type FormEvent } from 'react';
import { User, Lock, KeyRound, ArrowRight } from 'lucide-react';
import SmokeyCanvas from './SmokeyCanvas';
import { api, setToken } from '@/lib/api';

interface Props {
  onAuth: () => void;
}

export default function AuthView({ onAuth }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [err, setErr] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [legacyId, setLegacyId] = useState('');

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (!user || !pass) return;
    const r = await api<{ token?: string; error?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (!r) return;
    if (r.error) {
      setErr(r.error === 'invalid_credentials' ? 'Invalid username or password' : r.error);
      return;
    }
    if (r.token) { setToken(r.token); onAuth(); }
  }

  async function handleLegacy(e: FormEvent) {
    e.preventDefault();
    if (!legacyId) return;
    const r = await api<{ token?: string; error?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ number: legacyId }),
    });
    if (!r) return;
    if (r.error) {
      setErr(r.error === 'unknown_number' ? 'Unknown edgey ID' : r.error);
      return;
    }
    if (r.token) { setToken(r.token); onAuth(); }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    if (!user || !pass) return;
    const r = await api<{ token?: string; error?: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (!r) return;
    if (r.error) {
      const msgs: Record<string, string> = {
        invalid_username: 'Username must be 3-20 chars, letters/numbers/underscores',
        password_too_short: 'Password must be at least 6 characters',
        username_taken: 'Username is already taken',
        registration_closed: 'Registration is currently closed',
      };
      setErr(msgs[r.error] || r.error);
      return;
    }
    if (r.token) { setToken(r.token); onAuth(); }
  }

  return (
    <div className="relative flex items-center justify-center min-h-screen overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <SmokeyCanvas />
      <div className="absolute inset-0 backdrop-blur-[14px] z-[1]" />

      <div
        className="relative z-[2] w-full max-w-[400px] rounded-2xl p-11"
        style={{
          background: 'rgba(255,255,255,0.07)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 80px rgba(34,211,238,0.08)',
          animation: 'authIn 0.5s cubic-bezier(0.23,1,0.32,1)',
        }}
      >
        <h2 className="text-[26px] font-bold text-center tracking-tight text-white mb-1">
          <span className="bg-gradient-to-r from-accent to-accent2 bg-clip-text text-transparent">edgey</span> dashboard
        </h2>
        <p className="text-center text-[13.5px] mb-7" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {mode === 'login' ? 'Sign in to manage your API keys and usage' : 'Create an account to get started'}
        </p>

        {err && <p className="text-red text-[13px] text-center mb-3.5 min-h-[18px]">{err}</p>}

        {mode === 'login' ? (
          <>
            <form onSubmit={handleLogin}>
              <FloatingField icon={<User size={16} />} label="Username" value={user} onChange={setUser} type="text" autoComplete="username" />
              <FloatingField icon={<Lock size={16} />} label="Password" value={pass} onChange={setPass} type="password" autoComplete="current-password" />
              <button type="submit" className="w-full py-3.5 rounded-xl border-none text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all duration-250" style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent2))', boxShadow: '0 4px 16px rgba(34,211,238,0.25)' }}>
                Sign In <ArrowRight size={18} />
              </button>
            </form>
            <p className="text-center mt-5 text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Don't have an account?{' '}
              <a className="font-semibold text-accent2 cursor-pointer hover:text-accent" onClick={() => { setMode('register'); setErr(''); }}>Register</a>
            </p>
            <div className="flex items-center gap-3.5 my-5 text-[11px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.25)' }}>
              <span className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
              or
              <span className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            </div>
            <form onSubmit={handleLegacy}>
              <FloatingField icon={<KeyRound size={16} />} label="Edgey ID (legacy)" value={legacyId} onChange={setLegacyId} type="text" />
              <button type="submit" className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all duration-200" style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.1)' }}>
                Sign In with ID
              </button>
            </form>
          </>
        ) : (
          <>
            <form onSubmit={handleRegister}>
              <FloatingField icon={<User size={16} />} label="Username" value={user} onChange={setUser} type="text" autoComplete="username" />
              <FloatingField icon={<Lock size={16} />} label="Password" value={pass} onChange={setPass} type="password" autoComplete="new-password" />
              <button type="submit" className="w-full py-3.5 rounded-xl border-none text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all duration-250" style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent2))', boxShadow: '0 4px 16px rgba(34,211,238,0.25)' }}>
                Create Account <ArrowRight size={18} />
              </button>
            </form>
            <p className="text-center mt-5 text-[13px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Already have an account?{' '}
              <a className="font-semibold text-accent2 cursor-pointer hover:text-accent" onClick={() => { setMode('login'); setErr(''); }}>Sign In</a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function FloatingField({ icon, label, value, onChange, type, autoComplete }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type: string;
  autoComplete?: string;
}) {
  return (
    <div className="relative mb-7">
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder=" "
        autoComplete={autoComplete}
        className="peer w-full py-3 bg-transparent border-0 border-b-2 text-white text-sm outline-none rounded-none transition-colors duration-300"
        style={{ borderBottomColor: 'rgba(255,255,255,0.12)' }}
        onFocus={e => (e.target.style.borderBottomColor = 'var(--color-accent)')}
        onBlur={e => (e.target.style.borderBottomColor = value ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.12)')}
      />
      <label className="absolute top-3 left-0 text-sm font-medium pointer-events-none flex items-center gap-[7px] origin-left transition-all duration-300 peer-focus:-top-2.5 peer-focus:text-[11px] peer-focus:tracking-wide peer-focus:text-accent2 peer-[:not(:placeholder-shown)]:-top-2.5 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:tracking-wide peer-[:not(:placeholder-shown)]:text-accent2" style={{ color: 'rgba(255,255,255,0.35)' }}>
        <span className="opacity-50 peer-focus:opacity-100 shrink-0">{icon}</span>
        {label}
      </label>
    </div>
  );
}
