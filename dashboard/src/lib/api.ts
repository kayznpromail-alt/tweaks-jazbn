const TOKEN_KEY = 'edgey_token';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(t: string) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch {}
}

export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

export async function api<T = Record<string, unknown>>(
  path: string,
  opts: RequestInit = {},
): Promise<T | null> {
  const token = getToken();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = 'Bearer ' + token;
  Object.assign(headers, opts.headers || {});
  try {
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401) {
      clearToken();
      window.location.reload();
      return null;
    }
    return await res.json();
  } catch (e) {
    console.error(e);
    return null;
  }
}
