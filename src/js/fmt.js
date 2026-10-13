const DASH = '—';

const compact = (n) =>
  n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' :
  n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' :
  n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' :
  n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' :
  n.toFixed(0);

export const money = (n) => (Number.isFinite(n) ? '$' + compact(Math.max(0, n)) : DASH);

export const price = (p) => {
  if (!Number.isFinite(p)) return DASH;
  if (p <= 0) return '$0';
  if (p >= 1000) return '$' + compact(p);
  if (p >= 1) return '$' + p.toFixed(2);
  const decimals = Math.min(12, Math.max(4, 2 - Math.floor(Math.log10(p))));
  return '$' + p.toFixed(decimals);
};

export const pct = (c) => {
  if (!Number.isFinite(c)) return DASH;
  const a = Math.abs(c);
  return (a >= 1000 ? compact(a) : a.toFixed(a < 10 ? 2 : 1)) + '%';
};

export const count = (n) => (Number.isFinite(n) ? String(Math.round(n)) : DASH);

export const sign = (c) => (!Number.isFinite(c) || Math.abs(c) < 0.005 ? 0 : c > 0 ? 1 : -1);
export const arrow = (c) => (sign(c) > 0 ? '▲' : sign(c) < 0 ? '▼' : '■');

export const letterOf = (sym) => {
  const m = /[A-Za-z0-9]/.exec(sym || '');
  return m ? m[0].toUpperCase() : '?';
};
export const toneOf = (sym) => letterOf(sym).charCodeAt(0) % 4;
export { DASH };
