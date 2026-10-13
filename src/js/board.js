// Board rendering: skeleton -> staggered fade-in, count-up with flash, FLIP re-sorting, ticker, rail, roster.
import { h, svg, copyText, announce } from './dom.js';
import { motionOn, tween, flash } from './motion.js';
import { money, price, pct, count, sign, arrow, letterOf, toneOf, DASH } from './fmt.js';

const $ = (id) => document.getElementById(id);
const COPY = '<svg class="cp" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>';
const CHECK = '<svg class="ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const STATUS = {
  loading: { pill: 'SYNCING', head: 'SYNCING', sub: 'Reaching for Solana.' },
  live: { pill: 'LIVE', head: 'FEED LIVE', sub: 'Reading Solana off a public feed.' },
  stale: { pill: 'RETRYING', head: 'RETRYING', sub: 'Feed stumbled. Last good read stays up.' },
  error: { pill: 'OFFLINE', head: 'OFFLINE', sub: 'Feed silent. Retrying with longer pauses.' },
};

const S = { sort: 'vol', q: '', rows: [], els: new Map(), ready: false, picked: '', rail: 'up', prev: {}, status: 'loading', feed: null };

export function mountBoard(feed) {
  S.feed = feed;
  initSkeletonRoster();
  initControls();
  feed.subscribe(render);
}

/* ---------- controls ---------- */
function initControls() {
  const tabs = $('rank-tabs');
  const sel = (btn) => {
    S.sort = btn.dataset.sort;
    [...tabs.children].forEach((b) => { const on = b === btn; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $('rows').setAttribute('aria-labelledby', btn.id);
    if (S.rows.length) layout(true);
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button[data-sort]'); if (b) sel(b); });
  tabs.addEventListener('keydown', (e) => keyNav(e, tabs, sel));

  const rail = $('rail-tabs');
  const selRail = (btn) => {
    S.rail = btn.dataset.rail;
    [...rail.children].forEach((b) => { const on = b === btn; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $('rail-panel').setAttribute('aria-labelledby', btn.id);
    if (S.rows.length) paintRail(S.rows, true);
  };
  rail.addEventListener('click', (e) => { const b = e.target.closest('button[data-rail]'); if (b) selRail(b); });
  rail.addEventListener('keydown', (e) => keyNav(e, rail, selRail));

  $('search').addEventListener('input', (e) => { S.q = e.target.value.trim().toLowerCase(); applyFilter(); });
  $('reload').addEventListener('click', () => S.feed.reload());
  $('copy-lead').addEventListener('click', async (e) => {
    const lead = leader();
    if (!lead) return;
    const btn = e.currentTarget;
    const ok = await copyText(lead.address);
    btn.textContent = ok ? 'Copied' : 'Select manually';
    announce(ok ? 'Leader mint copied' : 'Copy failed');
    setTimeout(() => { btn.textContent = 'Copy leader'; }, 1500);
  });
  $('roster').addEventListener('click', (e) => { const b = e.target.closest('button[data-addr]'); if (b) pick(b.dataset.addr); });
}

function keyNav(e, host, select) {
  const items = [...host.querySelectorAll('[role="tab"]')];
  const i = items.indexOf(document.activeElement);
  if (i < 0) return;
  let n = -1;
  if (e.key === 'ArrowRight') n = (i + 1) % items.length;
  else if (e.key === 'ArrowLeft') n = (i - 1 + items.length) % items.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = items.length - 1;
  if (n < 0) return;
  e.preventDefault();
  items[n].focus();
  select(items[n]);
}

const leader = () => S.rows.slice().sort((a, b) => b.vol - a.vol)[0] || null;

/* ---------- render ---------- */
function render(s) {
  S.status = s.status;
  paintStatus(s);
  if (s.rows.length) {
    S.rows = s.rows;
    paintRows(s.rows);
    paintStats(s.rows);
    paintRail(s.rows, false);
    paintRoster(s.rows);
    paintTicker(s.rows);
    paintCap(s.rows);
  } else if (s.status === 'error') {
    paintError();
  }
}

function paintStatus(s) {
  const t = STATUS[s.status];
  const pill = $('pill');
  pill.dataset.state = s.status;
  $('pill-t').textContent = t.pill;
  $('ev-h').textContent = t.head;
  $('ev-s').textContent = t.sub;
  const feed = $('ev-feed');
  feed.textContent = t.pill;
  feed.dataset.on = String(s.status === 'live');
  $('copy-lead').disabled = !s.rows.length;
  $('dfoot').textContent = s.status === 'stale'
    ? 'Feed stumbled. Rows show the previous read.'
    : 'Public numbers, zero recommendations.';
}

function paintError() {
  const host = $('rows');
  host.querySelectorAll('.sk-row').forEach((e) => e.remove());
  if (!host.querySelector('.errbox')) {
    host.append(h('div', { class: 'errbox', role: 'alert' }, h('big', { text: DASH }), h('div', { text: 'Feed unreachable. Tiles stay empty until it answers.' })));
  }
  for (const id of ['st-vol', 'st-liq', 'st-n', 'st-up', 'st-lead', 'mn-n', 'mn-up', 'mn-dn']) { const el = $(id); el.textContent = DASH; }
  $('fl-v').textContent = DASH;
  $('cap-t').textContent = DASH + ' Feed quiet for now.';
  const run = $('tick-run');
  run.replaceChildren(tickGroup([h('span', { text: DASH + ' FEED UNREACHABLE' })], false), tickGroup([h('span', { text: DASH + ' FEED UNREACHABLE' })], true));
  $('rail-list').replaceChildren(h('li', { class: 'in' }, h('span', { class: 'who', text: DASH }), h('span', { class: 'nm', text: 'Empty' }), h('span', { class: 'tx', text: DASH })));
  $('roster').replaceChildren(...Array.from({ length: 4 }, () => h('div', { class: 'rc', 'aria-hidden': 'true' }, h('b', { text: DASH }), h('span', { text: DASH }))));
}

/* ---------- rows ---------- */
function logo(row) {
  const tile = () => h('span', { class: `lg lt t${toneOf(row.symbol)}`, 'aria-hidden': 'true', text: letterOf(row.symbol) });
  if (!row.img) return tile();
  const im = h('img', { class: 'lg', src: row.img, alt: '', width: 46, height: 46, decoding: 'async', referrerpolicy: 'no-referrer' });
  im.addEventListener('error', () => im.replaceWith(tile()));
  return im;
}

function copyBtn(row) {
  const b = h('button', { class: 'cpy', type: 'button', 'aria-label': 'Copy mint for ' + (row.symbol || 'token') });
  b.append(svg(COPY), svg(CHECK));
  b.addEventListener('click', async () => {
    const ok = await copyText(row.address);
    announce(ok ? `Mint for ${row.symbol || 'token'} copied` : 'Copy failed');
    if (!ok) return;
    b.classList.add('copied');
    setTimeout(() => b.classList.remove('copied'), 1500);
  });
  return b;
}

function buildRow(row) {
  const el = h('div', { class: 'drow spot enter', 'data-addr': row.address, 'data-sym': (row.symbol || '').toLowerCase(), 'data-name': (row.name || '').toLowerCase() });
  const main = h('div', { class: 'dmain' });
  main.append(
    h('div', { class: 'dag' }, h('span', { class: 'rk' }), logo(row), h('div', { class: 'nmb' }, h('b', { class: 'nm1' }), h('span', { class: 'nm2' }))),
    h('div', { class: 'c-pr dnum', 'data-l': 'Price' }, h('span', { class: 'num' })),
    h('div', { class: 'c-ch', 'data-l': '24h' }, h('span', { class: 'chg' }, h('span', { class: 'ar' }), h('span', { class: 'num' }))),
    h('div', { class: 'c-vo dnum', 'data-l': 'Volume' }, h('span', { class: 'num' })),
    h('div', { class: 'c-lq dnum', 'data-l': 'Liquidity' }, h('span', { class: 'num' })),
    h('div', { class: 'c-cp' }, copyBtn(row)),
  );
  el.append(main);
  el._v = null;
  return el;
}

function fillRow(el, row, fresh) {
  el.querySelector('.nm1').textContent = row.name || row.symbol || DASH;
  el.querySelector('.nm2').textContent = row.symbol ? '$' + row.symbol : DASH;
  const prev = el._v;
  const set = (sel, key, fmt, seed) => {
    const n = el.querySelector(sel + ' .num');
    const val = Number.isFinite(row[key]) ? row[key] : NaN;
    if (!prev) { tween(n, seed(val), val, fmt, 900); }
    else if (prev[key] !== val) { tween(n, prev[key], val, fmt); flash(n, Math.sign(val - prev[key])); }
    else n.textContent = fmt(val);
  };
  set('.c-pr', 'price', price, (v) => v * 0.7);
  set('.c-vo', 'vol', money, () => 0);
  set('.c-lq', 'liq', money, () => 0);
  const cell = el.querySelector('.c-ch .chg');
  const sg = sign(row.chg);
  cell.className = 'chg ' + (sg > 0 ? 'up' : sg < 0 ? 'dn' : 'fl');
  cell.querySelector('.ar').textContent = arrow(row.chg);
  const cn = cell.querySelector('.num');
  const cv = Number.isFinite(row.chg) ? row.chg : NaN;
  if (!prev) tween(cn, 0, cv, (v) => pct(Math.abs(v)), 900);
  else if (prev.chg !== cv) { tween(cn, prev.chg, cv, (v) => pct(Math.abs(v))); flash(cn, Math.sign(cv - prev.chg)); }
  else cn.textContent = pct(Math.abs(cv));
  el._v = { price: row.price ?? NaN, vol: row.vol, liq: row.liq, chg: cv };
  el.dataset.sym = (row.symbol || '').toLowerCase();
  el.dataset.name = (row.name || '').toLowerCase();
}

const sorted = (rows) => {
  const k = S.sort;
  const key = (r) => (k === 'vol' ? r.vol : k === 'liq' ? r.liq : Number.isFinite(r.chg) ? r.chg : -Infinity);
  return rows.slice().sort((a, b) => key(b) - key(a));
};

function paintRows(rows) {
  const host = $('rows');
  host.querySelector('.errbox')?.remove();
  const known = new Set(rows.map((r) => r.address));
  for (const [addr, el] of S.els) {
    if (known.has(addr)) continue;
    S.els.delete(addr);
    el.classList.add('leave');
    setTimeout(() => el.remove(), motionOn() ? 200 : 0);
  }
  const created = [];
  for (const r of rows) {
    let el = S.els.get(r.address);
    if (!el) { el = buildRow(r); S.els.set(r.address, el); created.push(el); }
    fillRow(el, r, !el._v);
  }
  const reveal = () => {
    layout(S.ready);
    S.ready = true;
    created.forEach((el, i) => { el.style.setProperty('--i', String(i)); });
    if (created.length && motionOn()) {
      requestAnimationFrame(() => requestAnimationFrame(() => created.forEach((el) => el.classList.add('go'))));
      setTimeout(() => created.forEach((el) => { el.classList.remove('enter', 'go'); el.style.removeProperty('--i'); }), 900 + created.length * 55);
    } else {
      created.forEach((el) => el.classList.remove('enter'));
    }
  };
  if (!S.ready) {
    const sk = [...host.querySelectorAll('.sk-row')];
    sk.forEach((e) => e.classList.add('out'));
    const swap = () => { sk.forEach((e) => e.remove()); reveal(); };
    if (sk.length && motionOn()) setTimeout(swap, 190); else swap();
  } else {
    reveal();
  }
}

function layout(flip) {
  const host = $('rows');
  const first = new Map();
  if (flip && motionOn()) for (const el of S.els.values()) first.set(el, el.getBoundingClientRect().top);
  sorted(S.rows).forEach((r, i) => {
    const el = S.els.get(r.address);
    if (!el) return;
    el.querySelector('.rk').textContent = String(i + 1).padStart(2, '0');
    host.append(el);
  });
  host.querySelector('.nomatch')?.remove();
  applyFilter();
  if (!first.size) return;
  for (const [el, top] of first) {
    if (el.hidden) continue;
    const dy = top - el.getBoundingClientRect().top;
    if (!dy) continue;
    el.classList.remove('flip');
    el.style.transform = `translateY(${dy}px)`;
    void el.offsetWidth;
    el.classList.add('flip');
    el.style.transform = '';
    setTimeout(() => el.classList.remove('flip'), 460);
  }
}

function applyFilter() {
  const host = $('rows');
  let shown = 0;
  for (const el of S.els.values()) {
    const hit = !S.q || el.dataset.sym.includes(S.q) || el.dataset.name.includes(S.q);
    el.hidden = !hit;
    if (hit) shown++;
  }
  host.querySelector('.nomatch')?.remove();
  if (S.els.size && !shown) host.append(h('div', { class: 'nomatch', text: DASH + ' Nothing under that spelling.' }));
}

function pick(addr) {
  if (S.q) { S.q = ''; $('search').value = ''; applyFilter(); }
  const el = S.els.get(addr);
  if (!el) return;
  S.picked = addr;
  S.els.forEach((e) => e.classList.toggle('pick', e === el));
  $('roster').querySelectorAll('button[data-addr]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.addr === addr)));
  el.scrollIntoView({ block: 'center', behavior: motionOn() ? 'smooth' : 'auto' });
}

/* ---------- stats, rail, roster, ticker, caption ---------- */
function setStat(id, value, fmt) {
  const b = $(id);
  let n = b.querySelector('.num');
  if (!n) { b.textContent = ''; n = h('span', { class: 'num' }); b.append(n); }
  const prev = S.prev[id];
  S.prev[id] = value;
  if (prev == null) tween(n, 0, value, fmt, 900);
  else if (prev !== value) { tween(n, prev, value, fmt); flash(n, Math.sign(value - prev)); }
  else n.textContent = fmt(value);
}

function paintStats(rows) {
  const up = rows.filter((r) => r.chg > 0).length;
  const dn = rows.filter((r) => r.chg < 0).length;
  setStat('st-vol', rows.reduce((a, r) => a + r.vol, 0), money);
  setStat('st-liq', rows.reduce((a, r) => a + r.liq, 0), money);
  setStat('st-n', rows.length, count);
  setStat('st-up', up, count);
  const lead = leader();
  const b = $('st-lead');
  b.textContent = lead ? '$' + (lead.symbol || DASH) : DASH;
  for (const [id, v] of [['mn-n', rows.length], ['mn-up', up], ['mn-dn', dn]]) setStat(id, v, count);
}

function paintRail(rows, animate) {
  const kind = S.rail;
  let list;
  if (kind === 'up') list = rows.filter((r) => r.chg > 0).sort((a, b) => b.chg - a.chg);
  else if (kind === 'dn') list = rows.filter((r) => r.chg < 0).sort((a, b) => a.chg - b.chg);
  else list = rows.slice().sort((a, b) => b.liq - a.liq);
  list = list.slice(0, 5);
  const ul = $('rail-list');
  if (!list.length) { ul.replaceChildren(h('li', { class: animate ? 'in' : '' }, h('span', { class: 'who', text: DASH }), h('span', { class: 'nm', text: 'Nobody listed' }), h('span', { class: 'tx', text: DASH }))); return; }
  const first = !ul.dataset.ready || animate;
  ul.dataset.ready = '1';
  ul.replaceChildren(...list.map((r) => h('li', { class: first ? 'in' : '' },
    h('span', { class: 'who', text: '$' + (r.symbol || DASH) }),
    h('span', { class: 'nm', text: r.name || '' }),
    h('span', { class: 'tx', text: kind === 'deep' ? money(r.liq) : arrow(r.chg) + ' ' + pct(r.chg) }),
  )));
}

function initSkeletonRoster() {
  $('roster').replaceChildren(...Array.from({ length: 10 }, () => h('div', { class: 'rc sk', 'aria-hidden': 'true' }, h('b', { text: ' ' }), h('span', { text: ' ' }))));
}

function paintRoster(rows) {
  const ro = $('roster');
  const list = sorted(rows);
  ro.replaceChildren(...list.map((r, i) => {
    const b = h('button', { class: 'rc', type: 'button', 'data-addr': r.address, 'aria-pressed': String(S.picked === r.address), 'aria-label': `Jump to ${r.symbol || 'token'}` },
      h('b', { text: '$' + (r.symbol || DASH) }), h('span', { text: arrow(r.chg) + ' ' + pct(r.chg) }));
    if (!S.rosterSeen && motionOn()) { b.style.opacity = '0'; b.style.transition = 'opacity .35s ease'; setTimeout(() => { b.style.opacity = '1'; }, 60 + i * 45); }
    return b;
  }));
  S.rosterSeen = true;
}

function tickGroup(items, dup) {
  const g = h('span', { class: 'grp' + (dup ? ' dup' : '') }, ...items);
  if (dup) g.setAttribute('aria-hidden', 'true');
  return g;
}

function paintTicker(rows) {
  const mk = () => sorted(rows).map((r) => {
    return h('span', {}, h('b', { text: '$' + (r.symbol || DASH) }), ' ', h('em', { text: price(r.price) }), ' ', h('i', { text: arrow(r.chg) + ' ' + pct(r.chg) }));
  });
  $('tick-run').replaceChildren(tickGroup(mk(), false), tickGroup(mk(), true));
}

function paintCap(rows) {
  const lead = leader();
  if (!lead) return;
  $('cap-t').textContent = `$${lead.symbol || DASH} sits first with ${money(lead.vol)} in turnover.`;
  $('fl-v').textContent = `$${lead.symbol || DASH} ${price(lead.price)}`;
}
