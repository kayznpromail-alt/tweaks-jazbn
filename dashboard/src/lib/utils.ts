export function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '--';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

export function fmtNum(n: number | null | undefined): string {
  return n == null ? '--' : n.toLocaleString('en-US');
}

export function fmtEur(n: number | null | undefined): string {
  return n == null ? '--' : '€' + Number(n).toFixed(2);
}

export function fmtPct(a: number, b: number): string {
  return b ? (a / b * 100).toFixed(1) + '%' : '0%';
}

export function fmtAgo(ts: number | null | undefined): string {
  if (!ts) return '--';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

export function fmtDate(ts: number | null | undefined): string {
  if (!ts) return '--';
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '--';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

export function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
