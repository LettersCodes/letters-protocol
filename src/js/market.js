// Market data layer. It is configured by the market-source register record and nothing else.
// Status: loading | live | stale (last good rows kept, source failing) | error (no rows at all).
const MAX_ADDRESSES = 30;

async function getJson(url, signal, timeoutMs) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.json();
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const safeImg = (u) => (typeof u === 'string' && /^https:\/\//.test(u) ? u : null);

// boosted list -> Solana entries -> pairs -> one row per token, top N by 24h volume
export async function loadBoard(cfg, signal) {
  const boosts = await getJson(cfg.url + cfg.boostsPath, signal, cfg.timeoutMs);
  if (!Array.isArray(boosts)) throw new Error('shape');
  const addrs = [...new Set(boosts.filter((b) => b && b.chainId === cfg.chainId && typeof b.tokenAddress === 'string').map((b) => b.tokenAddress))].slice(0, MAX_ADDRESSES);
  if (!addrs.length) throw new Error('empty');
  const pairs = await getJson(cfg.url + cfg.pairsPath + addrs.map(encodeURIComponent).join(','), signal, cfg.timeoutMs);
  if (!Array.isArray(pairs)) throw new Error('shape');
  const want = new Set(addrs);
  const by = new Map();
  for (const p of pairs) {
    if (!p || p.chainId !== cfg.chainId || !p.baseToken || !want.has(p.baseToken.address)) continue;
    const key = p.baseToken.address;
    const liq = num(p.liquidity && p.liquidity.usd) || 0;
    const vol = num(p.volume && p.volume.h24) || 0;
    let row = by.get(key);
    if (!row) {
      row = { address: key, name: '', symbol: '', price: null, chg: null, vol: 0, liq: 0, img: null, _best: -1 };
      by.set(key, row);
    }
    row.vol += vol;
    row.liq += liq;
    const img = safeImg(p.info && p.info.imageUrl);
    if (img && !row.img) row.img = img;
    if (liq >= row._best) {
      row._best = liq;
      row.name = String(p.baseToken.name || '').slice(0, 40);
      row.symbol = String(p.baseToken.symbol || '').replace(/^\$+/, '').slice(0, 14);
      row.price = num(p.priceUsd);
      row.chg = num(p.priceChange && p.priceChange.h24);
      if (img) row.img = img;
    }
  }
  const rows = [...by.values()].map(({ _best, ...r }) => r).sort((a, b) => b.vol - a.vol).slice(0, cfg.top);
  if (!rows.length) throw new Error('empty');
  return rows;
}

export const backoff = (attempt) => Math.min(60000, 2000 * Math.pow(2, Math.max(0, attempt - 1))) * (1 + Math.random() * 0.2);

export class Feed {
  constructor(cfg) {
    this.cfg = cfg;
    this.rows = [];
    this.status = 'loading';
    this.error = '';
    this.attempt = 0;
    this.busy = false;
    this.timer = 0;
    this.ctl = null;
    this.subs = new Set();
    this.hiddenAbort = false;
  }
  subscribe(fn) { this.subs.add(fn); fn(this.snapshot()); return () => this.subs.delete(fn); }
  snapshot() { return { status: this.status, rows: this.rows, error: this.error, attempt: this.attempt }; }
  emit() { const s = this.snapshot(); this.subs.forEach((f) => f(s)); }
  start() {
    document.addEventListener('visibilitychange', () => this.onVisibility());
    if (!document.hidden) this.tick();
  }
  onVisibility() {
    if (document.hidden) {
      clearTimeout(this.timer);
      this.timer = 0;
      if (this.ctl) { this.hiddenAbort = true; this.ctl.abort(); }
    } else {
      this.tick();
    }
  }
  reload() { this.attempt = 0; this.tick(); }
  async tick() {
    if (this.busy) return;
    clearTimeout(this.timer);
    this.busy = true;
    this.hiddenAbort = false;
    this.ctl = new AbortController();
    if (!this.rows.length && this.status !== 'loading') { this.status = 'loading'; this.emit(); }
    let delay = this.cfg.pollMs;
    try {
      this.rows = await loadBoard(this.cfg, this.ctl.signal);
      this.attempt = 0;
      this.error = '';
      this.status = 'live';
      this.emit();
    } catch (e) {
      if (this.hiddenAbort) { this.busy = false; this.ctl = null; return; }
      this.attempt += 1;
      this.error = e && e.message ? String(e.message) : 'failed';
      this.status = this.rows.length ? 'stale' : 'error';
      delay = backoff(this.attempt);
      this.emit();
    }
    this.busy = false;
    this.ctl = null;
    if (!document.hidden) this.timer = setTimeout(() => this.tick(), delay);
  }
}
