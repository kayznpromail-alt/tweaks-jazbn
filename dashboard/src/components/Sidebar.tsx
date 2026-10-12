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
        'fixed top-0 left-0 bottom-0 w-[220px] flex flex-col z-10 transition-transform duration-300',
        'max-md:-translate-x-full max-md:data-open:translate-x-0',
      )}
      data-open={open || undefined}
      style={{
        background: 'var(--color-bg)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      <div className="px-5 py-5 flex items-center gap-2.5">
        <div
          className="w-[28px] h-[28px] rounded-[8px] flex items-center justify-center text-[12px] font-bold text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--color-accent), #a78bfa)', boxShadow: '0 2px 8px rgba(108,92,231,0.3)' }}
        >
          e
        </div>
        <span className="text-[14px] font-semibold tracking-tight">edgey</span>
      </div>

      <div className="flex-1 px-2.5 py-1 overflow-y-auto">
        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] px-3 pt-3 pb-2" style={{ color: 'var(--color-muted2)' }}>
          Workspace
        </div>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { onNavigate(id); onClose(); }}
            className={cn(
              'relative flex items-center gap-2.5 w-full px-3 py-[9px] my-[1px] text-[13px] font-medium rounded-[9px] transition-all duration-150 border-none',
              page === id ? 'text-text' : 'text-muted hover:text-text2 hover:bg-white/[0.03]',
            )}
            style={page === id ? { background: 'var(--color-accent-surface)', color: 'var(--color-accent2)' } : {}}
          >
            <Icon size={16} className="shrink-0" style={{ opacity: page === id ? 1 : 0.55 }} />
            {label}
          </button>
        ))}
      </div>

      <div className="px-3 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 w-full px-3 py-2 text-[12.5px] text-muted rounded-[9px] border-none bg-transparent transition-all duration-150 hover:text-red hover:bg-red-bg"
        >
          <LogOut size={15} />
          Sign Out
        </button>
      </div>
    </nav>
  );
}
