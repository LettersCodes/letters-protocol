import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { build, ROOT } from './build.mjs';
import { validateRegister, byId, isInert, scanAddresses, publicView } from './lib/register.mjs';
import { walk, read } from './lib/scan.mjs';
import { brandAssets } from './lib/assets.mjs';
import { extract } from './palette.mjs';
import * as C from './lib/checks.mjs';
import { launch, openPage, serve, mockAddress, mockData, wait, until } from './lib/browser.mjs';

const TMP = path.join(ROOT, '.tmp-gates');
const results = [];
const clone = (o) => JSON.parse(JSON.stringify(o));
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');

async function gate(name, fn) {
  let problems;
  try { problems = await fn(); } catch (e) { problems = ['threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)]; }
  if (!Array.isArray(problems)) problems = [];
  results.push({ name, ok: problems.length === 0, problems });
  console.log((problems.length ? 'FAIL ' : 'ok   ') + name + (problems.length ? '\n       ' + problems.slice(0, 6).join('\n       ') : ''));
}

/* ---------- register branches, derived from whatever the record is right now ---------- */
const SRC_REG = JSON.parse(read(path.join(ROOT, 'src/register.json')));
const inertOf = (r) => { const { value, url, handle, ...rest } = r; const keep = {}; for (const k of ['id', 'label', 'kind', 'network', 'source', 'scope', 'recorded']) if (k in rest) keep[k] = rest[k]; return { ...keep, state: 'absent' }; };
const demoSocial = { x: 'https://x.com/lettersdemo', github: 'https://github.com/lettersdemo' };
export function branch(kind) {
  const reg = clone(SRC_REG);
  reg.records = reg.records.map((r) => {
    if (r.kind === 'address') {
      if (kind === 'stated') return { ...inertOf(r), state: 'stated', value: mockAddress(99) };
      if (kind === 'hex') return { ...inertOf(r), state: 'stated', value: '0x' + 'aB3d'.repeat(10) };
      return inertOf(r);
    }
    if (r.kind === 'social') return kind === 'stated' ? { ...inertOf(r), state: 'stated', url: demoSocial[r.network] } : inertOf(r);
    return r;
  });
  return reg;
}

const BRANCHES = { inert: branch('inert'), stated: branch('stated'), hex: branch('hex') };
const built = {};
const files = (dir) => ({ html: read(path.join(dir, 'index.html')), js: read(path.join(dir, 'app.js')), css: read(path.join(dir, 'styles.css')), tokens: read(path.join(dir, 'tokens.css')), fav: read(path.join(dir, 'favicon.svg')) });

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

/* ---------- 1. the real build ---------- */
await gate('build: dist/ produced from the live register', async () => {
  const { out } = await build();
  const need = ['index.html', 'app.js', 'styles.css', 'tokens.css', 'favicon.svg'];
  const miss = need.filter((f) => !fs.existsSync(path.join(out, f)));
  const extra = fs.readdirSync(out).filter((f) => /^(readme|license)|\.md$/i.test(f) || f === 'docs');
  return [...miss.map((f) => 'missing ' + f), ...extra.map((f) => 'does not belong in dist: ' + f)];
});
const LIVE = files(path.join(ROOT, 'dist'));
const LIVE_REG = JSON.parse(read(path.join(ROOT, 'src/register.json')));

await gate('register: live record set validates (inert records carry no value or url)', () => validateRegister(LIVE_REG));

for (const [name, reg] of Object.entries(BRANCHES)) {
  await gate(`branch ${name}: builds and validates`, async () => {
    const out = path.join(TMP, 'b-' + name);
    await build({ registerObj: reg, out });
    built[name] = out;
    return validateRegister(reg);
  });
}

/* ---------- 2. both gate branches ---------- */
const liveDir = path.join(ROOT, 'dist');
const targets = { live: [liveDir, LIVE_REG], inert: [built.inert, BRANCHES.inert], stated: [built.stated, BRANCHES.stated], hex: [built.hex, BRANCHES.hex] };
for (const [name, [dir, reg]] of Object.entries(targets)) {
  const f = files(dir);
  const tag = `branch ${name}`;
  await gate(`${tag}: social icons present at every width, inert ones have no href`, () => C.checkSocials(f.html, reg));
  await gate(`${tag}: CA slot matches record state (inert: pending only; stated: full address + copy)`, () => C.checkCa(f.html, reg));
  await gate(`${tag}: register rows (inert show label + pending only)`, () => C.checkRegisterRows(f.html, reg));
  await gate(`${tag}: public register carries no dates and no inert value/url`, () => C.checkPublicRegister(f.html, reg));
  await gate(`${tag}: address scanner finds nothing outside the stated registry`, () => {
    const all = [f.html, f.js, f.css, f.tokens, f.fav].join('\n');
    return C.checkAddresses(all, reg);
  });
}

/* ---------- 3. address scanner behaviour ---------- */
await gate('scanner: 0x hex is not blanket-rejected; it matches the stated registry', () => {
  const hex = byId(BRANCHES.hex, 'ca').value;
  const p = [];
  if (scanAddresses(`CA ${hex}`, BRANCHES.hex).length) p.push('stated 0x address was rejected');
  if (!scanAddresses(`CA ${hex}`, BRANCHES.inert).length) p.push('unstated 0x address slipped through');
  return p;
});
await gate('scanner: base58 address matches registry and foreign ones are flagged', () => {
  const a = byId(BRANCHES.stated, 'ca').value;
  const p = [];
  if (scanAddresses(a, BRANCHES.stated).length) p.push('stated base58 address rejected');
  if (!scanAddresses(a, BRANCHES.inert).length) p.push('unstated base58 address slipped through');
  if (!scanAddresses('0x' + 'ff'.repeat(20), BRANCHES.stated).length) p.push('foreign 0x address slipped through');
  return p;
});

/* ---------- 4. static policy gates ---------- */
await gate('palette: no colour literal outside tokens.css (src and dist)', () => {
  const srcFiles = {};
  for (const p of walk(path.join(ROOT, 'src'), (x) => /\.(css|js|html|svg)$/.test(x))) srcFiles[path.relative(ROOT, p)] = read(p);
  const distFiles = {};
  for (const p of walk(path.join(ROOT, 'dist'), (x) => /\.(css|js|html)$/.test(x))) distFiles[path.relative(ROOT, p)] = read(p);
  return [...C.checkPalette(srcFiles, 'tokens.css'), ...C.checkPalette(distFiles, 'tokens.css')];
});
await gate('brand: palette.json is exactly what the brand pixels yield, with provenance', () => {
  const p = [];
  const fresh = extract();
  const onDisk = JSON.parse(read(path.join(ROOT, 'src/palette.json')));
  if (JSON.stringify(fresh) !== JSON.stringify(onDisk)) p.push('src/palette.json is stale against ' + fresh.source.file);
  const buf = fs.readFileSync(path.join(ROOT, fresh.source.file));
  if (sha(buf) !== onDisk.source.sha1) p.push('brand file hash differs from the recorded one');
  if (buf.readUInt32BE(16) !== 2000 || buf[25] !== 6 || buf[24] !== 8) p.push('IHDR is not 2000px, 8-bit RGBA (colour type 6)');
  if (!(onDisk.source.alpha.transparent > 0 && onDisk.source.alpha.opaque > 0)) p.push('alpha histogram has no transparent and opaque pixels');
  const entries = Object.entries(onDisk.palette);
  if (entries.length < 8) p.push('palette too small');
  for (const [id, f] of entries) for (const k of ['rgb', 'oklch', 'share', 'pixels', 'mostCommonExactPixel', 'firstSeenAt']) if (!(k in f)) p.push(id + ' lacks ' + k);
  if (!onDisk.background[fresh.source.file.replace('...png', '.png')]) p.push('background provenance missing');
  return p;
});
await gate('brand: tokens.css is generated from the palette, in src and in dist', () => {
  const want = brandAssets().tokensCss;
  return [...(read(path.join(ROOT, 'src/tokens.css')) === want ? [] : ['src/tokens.css differs from palette']), ...(LIVE.tokens === want ? [] : ['dist/tokens.css differs from palette'])];
});
await gate('palette: every colour literal in the tokens traces to brand pixels, none invented', () => C.checkTokenProvenance(LIVE.tokens, JSON.parse(read(path.join(ROOT, 'src/palette.json')))));
await gate('palette: only the brand hues exist (warm cream family and one cyan), no stray hue', () => {
  const pal = JSON.parse(read(path.join(ROOT, 'src/palette.json'))).palette;
  const p = [];
  for (const [id, f] of Object.entries(pal)) {
    const m = /oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/.exec(f.oklch);
    if (!m) { p.push(id + ' has no hue'); continue; }
    const [, , c, h] = m.map(Number);
    if (id === 'accent') { if (!(h > 180 && h < 220 && c > 0.1)) p.push('accent is not the cyan family: ' + f.oklch); }
    else if (c > 0.05 || !(h > 40 && h < 160)) p.push(id + ' leaves the warm neutral family: ' + f.oklch);
  }
  return p;
});
await gate('favicon: svg 32x32 traced from the logo pixel grid, colours from the palette only', () => {
  const p = [];
  const pal = JSON.parse(read(path.join(ROOT, 'src/palette.json')));
  const allowed = new Set([...Object.values(pal.palette).map((f) => f.oklch), ...Object.values(pal.background).map((b) => b.oklch)]);
  if (!/viewBox="0 0 32 32"/.test(LIVE.fav) || !/width="32"/.test(LIVE.fav) || !/height="32"/.test(LIVE.fav)) p.push('not 32x32');
  const rects = (LIVE.fav.match(/<rect/g) || []).length;
  if (rects < 40) p.push('too few cells to be a traced grid: ' + rects);
  for (const m of LIVE.fav.matchAll(/oklch\([^)]*\)/g)) if (!allowed.has(m[0])) p.push('favicon colour not in palette: ' + m[0]);
  if (!LIVE.fav.includes(pal.palette.accent.oklch)) p.push('favicon lacks the cyan eyes');
  if (LIVE.fav !== brandAssets().favicon) p.push('favicon differs from a fresh trace of the brand file');
  if (!/rel="icon" type="image\/svg\+xml"[^>]*href="favicon.svg"/.test(LIVE.html)) p.push('index.html does not link the favicon');
  return p;
});
await gate('brand: logo crops ship in dist/img and decode as RGBA', () => {
  const p = [];
  for (const [f, w] of [['logo-96.png', 96], ['logo-640.png', 640]]) {
    const b = fs.readFileSync(path.join(ROOT, 'dist/img', f));
    if (b.readUInt32BE(16) !== w || b[25] !== 6) p.push(f + ' is not ' + w + 'px RGBA');
  }
  return p;
});
await gate('units: no ch units in any stylesheet', () => C.checkChUnits(LIVE.css + LIVE.tokens));
await gate('dates: none in html text, attributes, meta, script copy or css content', () => C.checkDates(LIVE.html, LIVE.js, LIVE.css));
await gate('copy: zero 2-grams shared with the reference', () => {
  const refs = new Set(JSON.parse(read(path.join(ROOT, 'scripts/ref-bigrams.json'))));
  return C.checkOriginality(LIVE.html, LIVE.js, refs);
});
await gate('motion: reduced-motion handled in css and script', () => {
  const p = [];
  if (!/prefers-reduced-motion:\s*reduce/.test(LIVE.css)) p.push('css lacks prefers-reduced-motion');
  if (!/matchMedia\(["']\(prefers-reduced-motion: reduce\)["']\)/.test(LIVE.js)) p.push('script lacks matchMedia check');
  return p;
});
await gate('market: data layer reads only the market-source record (no CA reference, no state coupling)', () => {
  const p = [];
  for (const f of ['src/js/market.js', 'src/js/board.js', 'src/js/fmt.js']) {
    const s = read(path.join(ROOT, f));
    if (/['"]ca['"]|ca-copy|ca-slot|records\.find|byId/.test(s)) p.push(`${f} touches registry or CA`);
  }
  const main = read(path.join(ROOT, 'src/js/main.js'));
  if (!/r\.id === 'market-source'/.test(main)) p.push('main does not select market-source');
  return p;
});
await gate('market: output is byte-identical across CA states', () => {
  const hs = Object.entries(built).map(([k, d]) => [k, sha(fs.readFileSync(path.join(d, 'app.js')))]);
  const same = hs.every(([, h]) => h === hs[0][1]) && sha(fs.readFileSync(path.join(liveDir, 'app.js'))) === hs[0][1];
  const regs = Object.entries(built).map(([k, d]) => JSON.stringify(JSON.parse(/<script id="register-data"[^>]*>([\s\S]*?)<\/script>/.exec(read(path.join(d, 'index.html')))[1]).records.find((r) => r.id === 'market-source')));
  return [...(same ? [] : ['app.js differs between branches']), ...(regs.every((r) => r === regs[0]) ? [] : ['market-source record differs between branches'])];
});
await gate('repo: files present, none inside dist, MIT for Letters', () => {
  const p = [];
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) if (!fs.existsSync(path.join(ROOT, f))) p.push('missing ' + f);
  const lic = read(path.join(ROOT, 'LICENSE'));
  if (!/^MIT License/.test(lic) || !/Copyright \(c\) 2026 Letters/.test(lic)) p.push('LICENSE is not MIT / Letters / 2026');
  const rd = read(path.join(ROOT, 'README.md'));
  for (const s of ['Overview', 'Features', 'Links', 'Solana', 'letters.codes']) if (!rd.includes(s)) p.push('README lacks ' + s);
  const wp = read(path.join(ROOT, 'docs/whitepaper.md'));
  for (const s of ['Vision', 'Mission', 'Tokenomics', 'Roadmap', 'Team']) if (!wp.includes(s)) p.push('whitepaper lacks ' + s);
  if ((wp.match(/\*\*Stage [IV]+/g) || []).length < 3) p.push('roadmap needs 3-4 phases');
  return p;
});
await gate('repo hygiene: no agent config folders or files, no attribution anywhere', () => {
  const p = [];
  for (const bad of [['CLAU', 'DE.md'].join(''), ['.cla', 'ude'].join(''), 'AGENTS.md', '.cursor']) if (fs.existsSync(path.join(ROOT, bad))) p.push('present: ' + bad);
  const words = [['cla', 'ude'], ['anthr', 'opic'], ['open', 'ai'], ['chat', 'gpt'], ['co-auth', 'ored-by'], ['generated ', 'by'], ['gp', 't-'], ['cop', 'ilot']].map((a) => a.join(''));
  const re = new RegExp('\\b(' + words.join('|') + ')\\b', 'i');
  const aiWord = new RegExp('\\b' + 'A' + 'I' + '\\b');
  const skip = /node_modules|\.tmp-gates|package-lock\.json|ref-bigrams\.json|\.git[\\/]/;
  for (const f of walk(ROOT, (x) => !skip.test(x))) {
    const rel = path.relative(ROOT, f);
    if (re.test(rel) || aiWord.test(rel)) p.push('file name: ' + rel);
    if (!/\.(png|jpe?g|jpeg|ico|woff2?)$/.test(f)) {
      const s = read(f);
      if (re.test(s)) p.push('text in ' + rel);
      if (aiWord.test(s)) p.push('mentions the two-letter term in ' + rel);
    }
  }
  return p;
});

/* ---------- 5. mutation harness: every fault must be caught ---------- */
const mutate = {
  'inert record carrying a value': () => { const r = clone(SRC_REG); const t = r.records.find((x) => x.kind === 'social'); Object.assign(t, inertOf(t), { value: 'x' }); return validateRegister(r); },
  'inert record carrying a url': () => { const r = clone(SRC_REG); const t = r.records.find((x) => x.kind === 'address'); Object.assign(t, inertOf(t), { url: 'https://example.com' }); return validateRegister(r); },
  'stored handle': () => { const r = clone(SRC_REG); const t = r.records.find((x) => x.kind === 'social'); t.handle = '@x'; return validateRegister(r); },
  'inert social rendered as a link': () => {
    const reg = BRANCHES.inert; const html = read(path.join(built.inert, 'index.html'));
    const id = reg.records.find((x) => x.kind === 'social').id;
    return C.checkSocials(html.replace(new RegExp(`<span class="soc inert" data-id="${id}"`), `<a href="https://x.com/a" class="soc inert" data-id="${id}"`), reg);
  },
  'social icon removed': () => { const reg = BRANCHES.inert; const id = reg.records.find((x) => x.kind === 'social').id; return C.checkSocials(read(path.join(built.inert, 'index.html')).replace(new RegExp(`data-id="${id}"`, 'g'), 'data-id="gone"'), reg); },
  'stated link with wrong href': () => { const reg = BRANCHES.stated; const html = read(path.join(built.stated, 'index.html')); return C.checkSocials(html.replace('href="https://x.com/lettersdemo"', 'href="https://x.com/other"'), reg); },
  'inert CA slot given a copy button': () => C.checkCa(read(path.join(built.inert, 'index.html')).replace('<span class="ca-v" aria-disabled="true">', '<button id="ca-copy" class="ca-v">'), BRANCHES.inert),
  'inert CA slot given an address': () => C.checkCa(read(path.join(built.inert, 'index.html')).replace('>pending</span></span></div>', `>pending ${mockAddress(5)}</span></span></div>`), BRANCHES.inert),
  'stated CA truncated': () => { const v = byId(BRANCHES.stated, 'ca').value; return C.checkCa(read(path.join(built.stated, 'index.html')).replace(`>${v}<`, `>${v.slice(0, 6)}...<`), BRANCHES.stated); },
  'foreign 0x address in page': () => C.checkAddresses(LIVE.html + ' 0x' + 'cd'.repeat(20), LIVE_REG),
  'foreign base58 address in page': () => C.checkAddresses(LIVE.js + ' ' + mockAddress(41), LIVE_REG),
  'visible date': () => C.checkDates(LIVE.html.replace('<footer class="foot">', '<footer class="foot"><span>Updated 12:30</span>'), LIVE.js, LIVE.css),
  'iso date in aria-label': () => C.checkDates(LIVE.html.replace('aria-label="Public tape"', 'aria-label="Public tape 2026-10-13"'), LIVE.js, LIVE.css),
  'date phrase in script copy': () => C.checkDates(LIVE.html, LIVE.js + '\nconst x = "Prices as of now";', LIVE.css),
  'hex colour in styles': () => C.checkPalette({ 'styles.css': LIVE.css + '\n.x{color:#ff5a2a}' }, 'tokens.css'),
  'rgb colour in script': () => C.checkPalette({ 'app.js': LIVE.js + '\nel.style.color = "rgb(1,2,3)";' }, 'tokens.css'),
  'invented colour in tokens': () => C.checkTokenProvenance(LIVE.tokens + '\n:root{--z: oklch(0.7 0.12 40)}', JSON.parse(read(path.join(ROOT, 'src/palette.json')))),
  'ch unit': () => C.checkChUnits(LIVE.css + '\n.x{width:60ch}'),
  'shared 2-gram': () => { const refs = new Set(JSON.parse(read(path.join(ROOT, 'scripts/ref-bigrams.json')))); return C.checkOriginality(LIVE.html.replace('<footer class="foot">', '<footer class="foot"><span>Eight agents</span>'), LIVE.js, refs); },
  'public register leaks a date': () => C.checkPublicRegister(LIVE.html.replace('"version":1', '"version":1,"records0":0').replace(/("id":"ca")/, '$1,"recorded":"2026-10-13"'), LIVE_REG),
};
for (const [name, run] of Object.entries(mutate)) {
  await gate(`mutation caught: ${name}`, () => (run().length ? [] : ['fault was not detected']));
}

/* ---------- 6. runtime, in a real browser with a scripted market API ---------- */
const servers = [];
const browser = await launch();
const log = {};
const addrOf = (i) => mockAddress(i + 1);
const expectTop = () => Array.from({ length: 10 }, (_, i) => `MCK${i}`);
const readRows = (page) => page.evaluate(() => [...document.querySelectorAll('#rows .drow')].map((e) => ({ sym: e.querySelector('.nm2').textContent, addr: e.dataset.addr, tile: !!e.querySelector('span.lt'), img: !!e.querySelector('img.lg'), copy: !!e.querySelector('button.cpy'), text: e.innerText })));

try {
  const sv = {};
  for (const name of ['inert', 'stated']) { const s = await serve(built[name]); servers.push(s.server); sv[name] = `http://127.0.0.1:${s.port}/`; }
  const reg = { inert: BRANCHES.inert, stated: BRANCHES.stated };
  const rowsBy = {};

  for (const name of ['inert', 'stated']) {
    const url = sv[name];
    const L = (log[name] = []);
    const scenario = { mode: 'ok', delay: 700 };
    const t = await openPage(browser, url, { scenario, log: L });
    const { page } = t;

    await gate(`runtime ${name}: skeleton rows show before data arrives`, async () => {
      await until(page, () => document.querySelectorAll('.sk-row').length > 0, 3000);
      const n = await page.evaluate(() => document.querySelectorAll('.sk-row').length);
      const pill = await page.evaluate(() => document.getElementById('pill').dataset.state);
      return [...(n > 0 ? [] : ['no skeleton rows']), ...(pill === 'loading' ? [] : ['pill is ' + pill])];
    });
    await until(page, () => document.querySelectorAll('#rows .drow').length >= 10 && !document.querySelector('.sk-row'), 8000).catch(() => {});
    await wait(1400);
    const rows = await readRows(page);
    rowsBy[name] = rows.map((r) => r.sym);

    await gate(`runtime ${name}: top 10 Solana tokens by 24h volume, others dropped, leading $ stripped`, async () => {
      const got = rows.map((r) => r.sym.replace(/^\$/, ''));
      const exp = expectTop();
      const p = [];
      if (JSON.stringify(got) !== JSON.stringify(exp)) p.push(`got ${got.join(',')}`);
      if (rows.some((r) => /^\$\$/.test(r.sym))) p.push('double dollar sign');
      return p;
    });
    await gate(`runtime ${name}: row carries logo or letter tile, price, change, volume, liquidity, copy button`, async () => {
      const p = [];
      const miss = rows.filter((r) => !r.copy || !(r.tile || r.img));
      if (miss.length) p.push('rows missing parts: ' + miss.map((m) => m.sym).join(','));
      const tiles = rows.filter((r) => r.tile).length;
      if (tiles < 2) p.push(`expected letter-tile fallbacks for missing and broken images, saw ${tiles}`);
      const cell = await page.evaluate(() => [...document.querySelectorAll('#rows .drow')].every((e) => ['.c-pr', '.c-ch', '.c-vo', '.c-lq'].every((s) => /\S/.test(e.querySelector(s).textContent))));
      if (!cell) p.push('empty metric cell');
      return p;
    });
    await gate(`runtime ${name}: copy button puts the row address on the clipboard`, async () => {
      await page.evaluate(() => document.querySelector('#rows .drow .cpy').click());
      await wait(300);
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      return clip === addrOf(0) ? [] : [`clipboard was ${clip}`];
    });
    await gate(`runtime ${name}: ticker, stat tiles, rail and roster use the same live data`, async () => {
      const r = await page.evaluate(() => ({
        tick: document.querySelectorAll('#tick-run .grp:first-child b').length,
        dup: document.querySelectorAll('#tick-run .grp.dup').length,
        stats: ['st-vol', 'st-liq', 'st-n', 'st-up', 'st-lead'].map((i) => document.getElementById(i).textContent.trim()),
        rail: document.querySelectorAll('#rail-list li').length,
        roster: document.querySelectorAll('#roster button.rc').length,
        pill: document.getElementById('pill').dataset.state,
      }));
      const p = [];
      if (r.tick !== 10 || r.dup !== 1) p.push(`ticker ${r.tick}/${r.dup}`);
      if (r.stats.some((s) => !s || s === '—')) p.push('stat tile empty: ' + r.stats.join('|'));
      if (r.stats[2] !== '10') p.push('tiles stat ' + r.stats[2]);
      if (!r.rail || r.roster !== 10) p.push(`rail ${r.rail} roster ${r.roster}`);
      if (r.pill !== 'live') p.push('pill ' + r.pill);
      return p;
    });
    await gate(`runtime ${name}: brand logo loads in the bar and the stage, starfield paints`, async () => {
      const r = await page.evaluate(() => ({
        imgs: [...document.querySelectorAll('.mark img,.hero-mark img')].map((i) => i.complete && i.naturalWidth > 0),
        stars: [...document.querySelectorAll('.starfield canvas')].map((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; }),
      }));
      return [...(r.imgs.length === 2 && r.imgs.every(Boolean) ? [] : ['logo images: ' + r.imgs]), ...(r.stars.length === 2 && r.stars.every((n) => n > 20) ? [] : ['starfield empty: ' + r.stars])];
    });
    await gate(`runtime ${name}: no dates or clocks anywhere in the rendered page, labels or tooltips`, async () => {
      const dump = await page.evaluate(() => {
        const out = [document.body.innerText];
        document.querySelectorAll('[aria-label],[title],[alt],[placeholder]').forEach((e) => out.push(e.getAttribute('aria-label') || '', e.getAttribute('title') || '', e.getAttribute('alt') || '', e.getAttribute('placeholder') || ''));
        return out;
      });
      const { findDates } = await import('./lib/scan.mjs');
      return dump.flatMap((s) => findDates(s).map((h) => `"${s.slice(0, 40)}" ${h}`));
    });
    await gate(`runtime ${name}: icons and CA slot are visible at 375 wide, even scrolled to the bottom`, async () => {
      await page.setViewport({ width: 375, height: 700, deviceScaleFactor: 1 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await wait(300);
      const r = await page.evaluate(() => {
        const vis = (e) => { const b = e.getBoundingClientRect(); return b.width >= 44 && b.height >= 44 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth; };
        return { soc: [...document.querySelectorAll('.soc')].map(vis), ca: (() => { const b = document.querySelector('.ca').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })(), over: document.documentElement.scrollWidth > innerWidth };
      });
      await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
      await page.evaluate(() => window.scrollTo(0, 0));
      return [...(r.soc.length === 2 && r.soc.every(Boolean) ? [] : ['icons not both visible and 44px: ' + r.soc]), ...(r.ca ? [] : ['CA slot scrolled away']), ...(r.over ? ['horizontal overflow at 375'] : [])];
    });
    if (name === 'stated') {
      await gate('runtime stated: CA click copies the full address and gives feedback', async () => {
        await page.evaluate(() => document.getElementById('ca-copy').click());
        await wait(300);
        const r = await page.evaluate(async () => ({ clip: await navigator.clipboard.readText(), act: document.querySelector('.ca-act').textContent, on: document.getElementById('ca-copy').dataset.copied }));
        const want = byId(reg.stated, 'ca').value;
        return [...(r.clip === want ? [] : ['clipboard ' + r.clip]), ...(r.act === 'COPIED' && r.on === 'true' ? [] : ['no feedback: ' + r.act])];
      });
      await gate('runtime stated: social anchors open the stated urls', async () => {
        const r = await page.evaluate(() => [...document.querySelectorAll('a.soc')].map((a) => a.href));
        return JSON.stringify(r) === JSON.stringify(['https://x.com/lettersdemo', 'https://github.com/lettersdemo']) ? [] : ['hrefs ' + r];
      });
    } else {
      await gate('runtime inert: no anchor on the page points at a social network or carries an address', async () => {
        const r = await page.evaluate(() => ({ hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /x\.com|twitter|github/.test(h)), pend: document.querySelector('.ca-addr').textContent, btn: !!document.getElementById('ca-copy') }));
        return [...(r.hrefs.length ? ['social hrefs: ' + r.hrefs] : []), ...(r.pend === 'pending' ? [] : ['ca text ' + r.pend]), ...(r.btn ? ['ca copy button exists'] : [])];
      });
    }
    await t.close();
  }

  await gate('runtime: market rows are identical whether the CA is stated or absent', () => (JSON.stringify(rowsBy.inert) === JSON.stringify(rowsBy.stated) && rowsBy.inert.length === 10 ? [] : ['inert ' + rowsBy.inert + ' stated ' + rowsBy.stated]));

  // failure handling
  {
    const L = [];
    const sc = { mode: 'ok', delay: 0 };
    const t = await openPage(browser, sv.inert, { scenario: sc, log: L });
    await until(t.page, () => document.querySelectorAll('#rows .drow').length === 10, 8000).catch(() => {});
    await gate('failure: last good rows are kept and the pill says retrying', async () => {
      sc.mode = 'fail';
      await t.page.evaluate(() => document.getElementById('reload').click());
      await until(t.page, () => document.getElementById('pill').dataset.state === 'stale', 6000);
      await wait(600);
      const r = await t.page.evaluate(() => ({ rows: document.querySelectorAll('#rows .drow:not(.leave)').length, ev: document.getElementById('ev-feed').textContent, foot: document.getElementById('dfoot').textContent }));
      return [...(r.rows === 10 ? [] : ['rows ' + r.rows]), ...(r.ev === 'RETRYING' ? [] : ['feed ' + r.ev])];
    });
    await gate('failure: recovery returns to live', async () => {
      sc.mode = 'ok';
      await t.page.evaluate(() => document.getElementById('reload').click());
      await until(t.page, () => document.getElementById('pill').dataset.state === 'live', 6000);
      return [];
    });
    await t.close();
  }
  {
    const L = [];
    const sc = { mode: 'fail', delay: 0 };
    const t = await openPage(browser, sv.inert, { scenario: sc, log: L });
    await gate('failure: with no data at all the board shows a dash and an error, never fake rows', async () => {
      await until(t.page, () => document.getElementById('pill').dataset.state === 'error' && document.querySelector('.errbox'), 6000);
      const r = await t.page.evaluate(() => ({ rows: document.querySelectorAll('#rows .drow').length, big: document.querySelector('.errbox big').textContent, stat: document.getElementById('st-vol').textContent, tick: document.getElementById('tick-run').textContent }));
      return [...(r.rows === 0 ? [] : ['rows ' + r.rows]), ...(r.big === '—' ? [] : ['no dash']), ...(r.stat === '—' ? [] : ['stat ' + r.stat]), ...(/—/.test(r.tick) ? [] : ['ticker lacks dash'])];
    });
    await gate('failure: retries back off exponentially', async () => {
      await wait(17500);
      const ts = L.filter((x) => x.url.includes('token-boosts')).map((x) => x.t);
      const gaps = ts.slice(1).map((v, i) => v - ts[i]);
      const p = [];
      if (gaps.length < 3) p.push('only ' + gaps.length + ' retries seen');
      else if (!(gaps[1] > gaps[0] * 1.25 && gaps[2] > gaps[1] * 1.25 && gaps[2] > gaps[0] * 2.5)) p.push('gaps not growing: ' + gaps.join(','));
      return p;
    });
    sc.mode = 'ok';
    await gate('failure: board recovers by itself after the source returns', async () => {
      await until(t.page, () => document.querySelectorAll('#rows .drow').length === 10 && !document.querySelector('.errbox'), 30000);
      return [];
    });
    await t.close();
  }

  // polling from the register record, and visibility
  {
    const reg2 = clone(BRANCHES.inert);
    byId(reg2, 'market-source').pollMs = 1500;
    const out = path.join(TMP, 'b-fast');
    await build({ registerObj: reg2, out });
    const s = await serve(out); servers.push(s.server);
    const L = [];
    const sc2 = { mode: 'ok', delay: 0, k: 1 };
    const t = await openPage(browser, `http://127.0.0.1:${s.port}/`, { scenario: sc2, log: L });
    await until(t.page, () => document.querySelectorAll('#rows .drow').length === 10, 8000).catch(() => {});
    await gate('poll: interval comes from the market-source record', async () => {
      const t0 = Date.now();
      while (L.filter((x) => x.url.includes('token-boosts')).length < 4 && Date.now() - t0 < 20000) await wait(200);
      const ts = L.filter((x) => x.url.includes('token-boosts')).map((x) => x.t);
      const gaps = ts.slice(1).map((v, i) => v - ts[i]);
      return gaps.length >= 2 && gaps.every((g) => g > 1200 && g < 4000) ? [] : ['gaps ' + gaps.join(',')];
    });
    await gate('poll: pauses while hidden and fetches at once when visible again', async () => {
      await t.page.evaluate(() => { window.__hidden = true; document.dispatchEvent(new Event('visibilitychange')); });
      await wait(300);
      const n0 = L.length;
      await wait(4200);
      const during = L.length - n0;
      const t0 = Date.now();
      await t.page.evaluate(() => { window.__hidden = false; document.dispatchEvent(new Event('visibilitychange')); });
      await wait(500);
      const after = L.filter((x) => x.t >= t0).length;
      return [...(during === 0 ? [] : [`${during} requests while hidden`]), ...(after >= 1 ? [] : ['no immediate fetch on visible'])];
    });
    await gate('count-up: values tween and flash when the feed changes', async () => {
      await t.page.evaluate(() => { window.__flashed = false; new MutationObserver((ms) => { for (const m of ms) if (m.target.classList && (m.target.classList.contains('flash-up') || m.target.classList.contains('flash-dn'))) window.__flashed = true; }).observe(document.getElementById('rows'), { attributes: true, subtree: true, attributeFilter: ['class'] }); });
      const before = await t.page.evaluate(() => document.querySelector('#rows .drow .c-vo .num').textContent);
      sc2.k = 1.5;
      await until(t.page, () => window.__flashed === true, 6000).catch(() => {});
      await wait(1200);
      const r = await t.page.evaluate(() => ({ flashed: window.__flashed, now: document.querySelector('#rows .drow .c-vo .num').textContent }));
      return [...(r.flashed ? [] : ['no flash seen']), ...(r.now !== before ? [] : ['value did not change: ' + before])];
    });
    await t.close();
  }

  // motion
  {
    const sc = { mode: 'ok', delay: 0 };
    const t = await openPage(browser, sv.inert, { scenario: sc, log: [], reduced: true });
    await until(t.page, () => document.querySelectorAll('#rows .drow').length === 10, 8000).catch(() => {});
    await gate('reduced motion: zero running animations or transitions, everything revealed at once', async () => {
      const r = await t.page.evaluate(() => ({ anims: document.getAnimations().length, enter: document.querySelectorAll('.drow.enter').length, hidden: [...document.querySelectorAll('[data-reveal]')].filter((e) => getComputedStyle(e).opacity !== '1').length, sw: document.getElementById('motion').disabled }));
      return [...(r.anims === 0 ? [] : ['animations ' + r.anims]), ...(r.enter === 0 ? [] : ['rows still entering']), ...(r.hidden === 0 ? [] : [`${r.hidden} reveal blocks hidden`])];
    });
    await t.close();
    const t2 = await openPage(browser, sv.inert, { scenario: sc, log: [] });
    await until(t2.page, () => document.querySelectorAll('#rows .drow').length === 10, 8000).catch(() => {});
    await gate('full motion: marquee, pulse and mesh are actually running', async () => {
      const r = await t2.page.evaluate(() => document.getAnimations().map((a) => a.animationName || '').filter(Boolean));
      const need = ['tk', 'pulse', 'd1'];
      return need.filter((n) => !r.includes(n)).map((n) => 'not running: ' + n);
    });
    await gate('full motion: scroll progress bar and spotlight respond', async () => {
      await t2.page.evaluate(() => window.scrollTo(0, 1200));
      await wait(300);
      const bar = await t2.page.evaluate(() => document.querySelector('#progress i').style.transform);
      await t2.page.evaluate(() => window.scrollTo(0, 0));
      await wait(200);
      const pr = await t2.page.evaluate(() => { const b = document.querySelector('.promo').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
      await t2.page.mouse.move(pr.x, pr.y);
      await t2.page.mouse.move(pr.x + 6, pr.y + 4);
      await wait(200);
      const lit = await t2.page.evaluate(() => document.querySelectorAll('.spot.lit').length);
      const m = /scaleX\(([\d.]+)\)/.exec(bar);
      return [...(m && parseFloat(m[1]) > 0.05 ? [] : ['progress ' + bar]), ...(lit >= 1 ? [] : ['no spotlight'])];
    });
    await t2.close();
  }
} finally {
  await browser.close();
  servers.forEach((s) => s.close());
}

fs.rmSync(TMP, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length} gates, ${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
