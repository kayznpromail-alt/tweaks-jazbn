import { useState, useCallback } from 'react';
import { Menu } from 'lucide-react';
import { getToken, clearToken, api } from '@/lib/api';
import AuthView from '@/components/AuthView';
import Sidebar, { type PageId } from '@/components/Sidebar';
import Toast from '@/components/Toast';
import Overview from '@/pages/Overview';
import Keys from '@/pages/Keys';
import Requests from '@/pages/Requests';
import Setup from '@/pages/Setup';
import Wallet from '@/pages/Wallet';
import Profile from '@/pages/Profile';

const PAGE: Record<PageId, React.ComponentType> = {
  overview: Overview,
  keys: Keys,
  requests: Requests,
  setup: Setup,
  wallet: Wallet,
  profile: Profile,
};

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [page, setPage] = useState<PageId>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleAuth = useCallback(() => setAuthed(true), []);

  const handleLogout = useCallback(() => {
    api('/auth/logout', { method: 'POST' });
    clearToken();
    setAuthed(false);
  }, []);

  if (!authed) {
    return (
      <>
        <Toast />
        <AuthView onAuth={handleAuth} />
      </>
    );
  }

  const PageComponent = PAGE[page];

  return (
    <>
      <Toast />
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-3.5 left-3.5 z-20 p-2.5 px-3 rounded-lg border-none md:hidden"
        style={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.3), 0 4px 16px rgba(0,0,0,0.2)', color: 'var(--color-text)' }}
      >
        <Menu size={18} />
      </button>
      <Sidebar page={page} onNavigate={setPage} onLogout={handleLogout} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="ml-[220px] max-md:ml-0 min-h-screen px-8 pt-6 pb-10 max-md:px-4 max-md:pt-14">
        <PageComponent />
      </main>
    </>
  );
}
