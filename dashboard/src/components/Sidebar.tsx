import { LayoutGrid, KeyRound, FileText, BookOpen, Wallet, UserCircle, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'keys', label: 'API Keys', icon: KeyRound },
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
}

export default function Sidebar({ page, onNavigate, onLogout, open, onClose }: Props) {
  return (
    <nav
      className={cn(
        'fixed top-0 left-0 bottom-0 w-60 flex flex-col z-10 transition-transform duration-300',
        'max-md:-translate-x-full max-md:data-open:translate-x-0',
      )}
      data-open={open || undefined}
      style={{
        background: 'var(--color-card)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      <div className="px-6 py-5 flex items-center gap-2.5 text-[15px] font-bold tracking-tight" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div
          className="w-[30px] h-[30px] rounded-[9px] flex items-center justify-center text-[13px] font-bold text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--color-accent), #a78bfa)', boxShadow: '0 2px 8px rgba(108,92,231,0.35)' }}
        >
          e
        </div>
        edgey
      </div>

      <div className="flex-1 px-2 py-2.5 overflow-y-auto">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { onNavigate(id); onClose(); }}
            className={cn(
              'relative flex items-center gap-[11px] w-full px-4 py-2.5 my-px text-[13.5px] font-medium rounded-lg transition-all duration-200 border-none',
              page === id ? 'text-text' : 'text-muted hover:text-text2 hover:bg-white/[0.03]',
            )}
            style={page === id ? { background: 'var(--color-accent-surface)' } : {}}
          >
            {page === id && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[18px] rounded-r-[3px]" style={{ background: 'var(--color-accent)' }} />
            )}
            <Icon size={18} className="shrink-0" style={{ opacity: page === id ? 1 : 0.7 }} />
            {label}
          </button>
        ))}
      </div>

      <div className="px-4 py-3.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button
          onClick={onLogout}
          className="flex items-center gap-2.5 w-full px-2 py-2 text-[13px] text-muted rounded-lg border-none bg-transparent transition-all duration-150 hover:text-red hover:bg-red-bg"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </nav>
  );
}
