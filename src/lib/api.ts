import { API_ENABLED, API_ROOT } from '../data/site';

export { API_ENABLED };

const KEY = 'edgey-session';

/** Dashboard session token (kept in this browser only). */
export const session = {
  get(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(KEY, token);
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {}
  },
};

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

/** Calls the edgey API; an expired session sends the visitor back to sign in. */
export async function api<T = any>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = session.get();
  let res: Response;
  try {
    res = await fetch(API_ROOT + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    session.clear();
    location.assign('/');
  }
  if (!res.ok) throw new ApiError(data.error ?? 'error', res.status);
  return data as T;
}

export const fmt = (n: number) => Number(n).toLocaleString('en-US');
