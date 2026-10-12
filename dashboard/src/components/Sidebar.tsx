import { LayoutGrid, KeyRound, FileText, BookOpen, Wallet, UserCircle, LogOut, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'keys', label: 'Keys', icon: KeyRound },
  { id: 'requests', label: 'Requests', icon: FileText },
  { id: 'setup', label: 'Setup', icon: BookOpen },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'profile', label: 'Profile', icon: UserCircle },
] as const;

export type PageId = (typeof NAV)[number]['id'];

interface Props {
  page: PageId;
  onNavigate: (page: PageId) => void;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  username?: string;
}

export default function Sidebar({ page, onNavigate, onLogout, open, onClose, username }: Props) {
  return (
    <>
      {/* Desktop top header */}
      <header
        className="fixed top-0 left-0 right-0 z-30 max-md:hidden"
        style={{
          height: 72,
          background: 'rgba(5,8,11,0.85)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <div className="mx-auto flex items-center h-full px-6" style={{ maxWidth: 1280, display: 'grid', gridTemplateColumns: '1fr auto 1fr' }}>
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0"
              style={{ background: 'var(--color-accent)', color: '#031217' }}
            >
              e
            </div>
            <span className="text-[15px] font-bold tracking-tight">edgey</span>
          </div>

          {/* Centered pill nav */}
          <nav
            className="flex items-center gap-1 px-1.5 py-1.5 rounded-full"
            style={{ background: 'var(--color-bg2)', border: '1px solid var(--color-border)' }}
          >
            {NAV.map(({ id, label, icon: Icon }) => {
              const active = page === id;
              return (
                <button
                  key={id}
                  onClick={() => onNavigate(id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold transition-all duration-200',
                    active ? '' : 'text-muted hover:text-text2',
                  )}
                  style={active ? {
                    background: 'var(--color-accent-surface2)',
                    color: 'var(--color-accent)',
                    border: '1px solid var(--color-accent-line)',
                  } : { border: '1px solid transparent' }}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right: user + logout */}
          <div className="flex items-center gap-3 justify-end">
            {username && (
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold"
                  style={{ background: 'var(--color-card)', border: '1px solid var(--color-border2)', color: 'var(--color-text)' }}
                >
                  {username.slice(0, 2).toUpperCase()}
                </div>
                <span className="text-[12px] font-medium text-text2">{username}</span>
              </div>
            )}
            <button
              onClick={onLogout}
              className="flex items-center justify-center transition-all duration-150 hover:text-red hover:border-red"
              style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border2)', background: 'var(--color-bg)', color: 'var(--color-muted)' }}
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden flex items-center justify-around px-2 py-1.5"
        style={{
          background: 'rgba(5,8,11,0.92)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = page === id;
          return (
            <button
              key={id}
              onClick={() => { onNavigate(id); onClose(); }}
              className="flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg text-[9px] font-medium transition-colors"
              style={{ color: active ? 'var(--color-accent)' : 'var(--color-muted)' }}
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          );
        })}
        <button
          onClick={onLogout}
          className="flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-lg text-[9px] font-medium text-muted transition-colors hover:text-red"
        >
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </nav>
    </>
  );
}
