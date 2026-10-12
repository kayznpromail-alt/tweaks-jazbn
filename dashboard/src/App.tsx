import { useState, useCallback, useEffect } from 'react';
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
  const [username, setUsername] = useState('');

  const handleAuth = useCallback(() => setAuthed(true), []);

  const handleLogout = useCallback(() => {
    api('/auth/logout', { method: 'POST' });
    clearToken();
    setAuthed(false);
  }, []);

  useEffect(() => {
    if (authed) {
      api<{ username?: string }>('/me').then(r => {
        if (r?.username) setUsername(r.username);
      });
    }
  }, [authed]);

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
      <Sidebar
        page={page}
        onNavigate={setPage}
        onLogout={handleLogout}
        open={false}
        onClose={() => {}}
        collapsed={false}
        onToggleCollapse={() => {}}
        username={username}
      />
      <main
        className="max-md:pb-20"
        style={{
          maxWidth: 1256,
          margin: '0 auto',
          padding: '120px 16px 80px',
        }}
      >
        <PageComponent />
      </main>
    </>
  );
}
