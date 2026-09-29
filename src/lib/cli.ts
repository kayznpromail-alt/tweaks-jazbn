// Shapes and formatting for the customer's CLI key usage (GET /me → cli).

export type CliAccount = {
  status: 'active' | 'paused' | 'expired' | 'exhausted' | 'unknown';
  plan: string | null;
  expiresAt: string | null;
  limit: number | null;
  used: number;
  reserved: number;
  available: number | null;
  estimatedRequests: number | null;
};
export type Cli = { masked: string; account: CliAccount | null; checkedAt: number | null; error?: string } | null;

export const STATUS_LABEL: Record<CliAccount['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired',
  exhausted: 'Quota used up',
  unknown: 'Unknown',
};

export const compact = (n: number | null | undefined) => {
  if (n == null) return '–';
  const a = Math.abs(n);
  return a >= 1e9 ? `${+(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(n);
};

export const date = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No expiry';

/** Share of the limit already used, 0..100 (null when there is no limit). */
export const usedPercent = (a: CliAccount) =>
  a.limit ? Math.min(100, Math.round(((a.used + a.reserved) / a.limit) * 100)) : null;

/** Fills every [data-cli="field"] element on the page. */
export function fillCli(cli: Cli) {
  const set = (field: string, text: string) =>
    document.querySelectorAll<HTMLElement>(`[data-cli="${field}"]`).forEach((el) => (el.textContent = text));
  const a = cli?.account;
  set('masked', cli?.masked ?? 'No CLI key yet');
  set('status', a ? STATUS_LABEL[a.status] : cli ? 'Unavailable' : 'Not linked');
  set('available', compact(a?.available ?? null));
  set('used', compact(a?.used ?? 0));
  set('limit', a?.limit ? compact(a.limit) : 'unlimited');
  set('plan', a?.plan ?? '–');
  set('expires', a ? date(a.expiresAt) : '–');
  set('requests', a?.estimatedRequests != null ? `~${compact(a.estimatedRequests)}` : '–');
  set('updated', cli?.checkedAt ? new Date(cli.checkedAt).toLocaleTimeString() : '–');
  const pct = a ? usedPercent(a) : null;
  set('percent', pct == null ? '' : `${pct}% used`);
  document.querySelectorAll<HTMLElement>('[data-cli-bar]').forEach((el) => (el.style.width = `${pct ?? 0}%`));
  document.querySelectorAll<HTMLElement>('[data-cli-state]').forEach((el) => (el.dataset.cliState = a?.status ?? 'none'));
}
