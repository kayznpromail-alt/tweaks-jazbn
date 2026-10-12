import { LayoutGrid, KeyRound, FileText, BookOpen, Wallet, UserCircle, LogOut, ChevronsLeft, ChevronsRight } from 'lucide-react';
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
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({ page, onNavigate, onLogout, open, onClose, collapsed, onToggleCollapse }: Props) {
  return (
    <nav
      className={cn(
        'fixed top-0 left-0 bottom-0 flex flex-col z-10',
        'max-md:-translate-x-full max-md:data-open:translate-x-0',
      )}
      data-open={open || undefined}
      style={{
        width: collapsed ? 68 : 240,
        transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1), transform 0.3s ease',
        background: 'var(--color-bg)',
        borderRight: '1px solid var(--color-border)',
      }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5" style={{ minHeight: 64 }}>
        <div
          className="w-[32px] h-[32px] rounded-[10px] flex items-center justify-center text-[13px] font-bold text-white shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)', boxShadow: '0 2px 10px rgba(108,92,231,0.35)' }}
        >
          e
        </div>
        {!collapsed && (
          <span className="text-[15px] font-bold tracking-tight whitespace-nowrap overflow-hidden">edgey</span>
        )}
      </div>

      {/* Nav */}
      <div className="flex-1 px-2 py-1 overflow-y-auto overflow-x-hidden">
        {!collapsed && (
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] px-3 pt-2 pb-2" style={{ color: 'var(--color-muted2)' }}>
            Workspace
          </div>
        )}
        {NAV.map(({ id, label, icon: Icon }) => {
          const active = page === id;
          return (
            <button
              key={id}
              onClick={() => { onNavigate(id); onClose(); }}
              title={collapsed ? label : undefined}
              className={cn(
                'relative flex items-center w-full my-[2px] text-[13px] font-medium rounded-[10px] border-none',
                'transition-all duration-150',
                collapsed ? 'justify-center px-0 py-2.5' : 'gap-3 px-3 py-[10px]',
                active ? 'text-text' : 'text-muted hover:text-text2 hover:bg-white/[0.04]',
              )}
              style={active ? {
                background: 'var(--color-accent-surface2)',
                color: 'var(--color-accent2)',
                boxShadow: 'inset 0 0 0 1px rgba(108,92,231,0.15)',
              } : {}}
            >
              <Icon size={18} className="shrink-0" style={{ opacity: active ? 1 : 0.6 }} />
              {!collapsed && <span className="whitespace-nowrap overflow-hidden">{label}</span>}
            </button>
          );
        })}
      </div>

      {/* Bottom */}
      <div className="px-2 py-2 flex flex-col gap-1" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button
          onClick={onToggleCollapse}
          className="hidden md:flex items-center gap-2 w-full px-3 py-2 text-[12px] text-muted rounded-[10px] border-none bg-transparent transition-all duration-150 hover:bg-white/[0.04] hover:text-text2"
          style={collapsed ? { justifyContent: 'center' } : {}}
        >
          {collapsed ? <ChevronsRight size={16} /> : <><ChevronsLeft size={16} /> <span>Collapse</span></>}
        </button>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-muted rounded-[10px] border-none bg-transparent transition-all duration-150 hover:text-red hover:bg-red-bg"
          style={collapsed ? { justifyContent: 'center' } : {}}
          title={collapsed ? 'Sign Out' : undefined}
        >
          <LogOut size={16} />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </nav>
  );
}
