// Phase 4: measure the built page at 360 / 390 / 430 / 1366 / 1440 in both register branches.
import fs from 'node:fs';
import path from 'node:path';
import { build, ROOT } from './build.mjs';
import { mockAddress } from './lib/browser.mjs';
import { launch, openPage, serve, wait, until, boardReady } from './lib/browser.mjs';

const TMP = path.join(ROOT, '.tmp-measure');
const SIZES = [[360, 780], [390, 844], [430, 932], [1366, 768], [1440, 900]];
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/register.json'), 'utf8'));
const strip = (r) => ({ id: r.id, label: r.label, kind: r.kind, ...(r.network ? { network: r.network } : {}), state: 'absent', source: r.source, scope: r.scope, recorded: r.recorded });
const inert = { ...src, records: src.records.map((r) => (r.kind === 'address' || r.kind === 'social' ? strip(r) : r)) };
const stated = { ...src, records: src.records.map((r) => (r.kind === 'address' ? { ...strip(r), state: 'stated', value: mockAddress(99) } : r.kind === 'social' ? { ...strip(r), state: 'stated', url: r.network === 'x' ? 'https://x.com/lettersdemo' : 'https://github.com/lettersdemo' } : r)) };

fs.rmSync(TMP, { recursive: true, force: true });
const dirs = {};
for (const [name, reg] of Object.entries({ inert, stated })) { dirs[name] = path.join(TMP, name); await build({ registerObj: reg, out: dirs[name] }); }

const browser = await launch();
const servers = [];
let failures = 0;
const rows = [];
try {
  for (const name of ['inert', 'stated']) {
    const s = await serve(dirs[name]); servers.push(s.server);
    for (const [w, h] of SIZES) {
      const t = await openPage(browser, `http://127.0.0.1:${s.port}/`, { width: w, height: h, scenario: { mode: 'ok', delay: 0 }, log: [] });
      const { page } = t;
      if (!(await boardReady(t))) { console.log('FAIL ' + name + ' ' + w + ': board never rendered'); failures++; await t.close(); continue; }
      await wait(1500);
      const m = await page.evaluate(() => {
        const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
        const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]') && !e.closest('.sr'); };
        const taps = [...document.querySelectorAll('a[href],button,input,[role="tab"]')].filter(vis).map((e) => ({ el: (e.id ? '#' + e.id : e.tagName.toLowerCase() + '.' + (e.className || '').toString().split(' ')[0]), w: Math.round(e.getBoundingClientRect().width * 10) / 10, h: Math.round(e.getBoundingClientRect().height * 10) / 10 }));
        const soc = [...document.querySelectorAll('.soc')].map(r2 => r(r2));
        const bar = r(document.getElementById('top-bar'));
        const ca = document.querySelector('.ca');
        const addr = document.querySelector('.ca-addr');
        const ref = (sel) => { const e = document.querySelector(sel); return e ? r(e) : null; };
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          taps: taps.filter((t) => t.w < 44 || t.h < 44),
          tapCount: taps.length,
          soc, bar,
          ca: r(ca), caFont: parseFloat(getComputedStyle(document.querySelector('.ca-v')).fontSize), caClipped: addr.scrollWidth > addr.clientWidth + 1,
          side: ref('.side'), tick: ref('.tick'), right: ref('.right'), stage: ref('.stage'), main: ref('.main'),
          rowH: ref('#rows .drow'), h1: parseFloat(getComputedStyle(document.querySelector('.hero h1')).fontSize),
          tilesInStage: [...document.querySelectorAll('.stat')].map((e) => r(e)),
          clippedStats: [...document.querySelectorAll('.stat b')].filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.id),
          rowsOverflow: [...document.querySelectorAll('#rows .drow')].filter((e) => e.scrollWidth > e.clientWidth + 1).length,
          fontsUsed: getComputedStyle(document.body).fontFamily.split(',')[0],
        };
      });
      const problems = [];
      if (m.overflow > 0) problems.push(`horizontal overflow ${m.overflow}px`);
      if (m.taps.length) problems.push('tap targets under 44: ' + m.taps.map((x) => `${x.el} ${x.w}x${x.h}`).join('; '));
      if (m.soc.length !== 2) problems.push('social icons: ' + m.soc.length);
      else {
        for (const s2 of m.soc) {
          if (s2.w < 44 || s2.h < 44) problems.push('icon under 44');
          if (s2.y < m.bar.y - 1 || s2.b > m.bar.b + 1) problems.push('icon outside the top bar');
        }
        const rightmost = Math.max(...m.soc.map((x) => x.r));
        if (m.bar.r - rightmost > 24) problems.push(`icons not flush right (${Math.round(m.bar.r - rightmost)}px gap)`);
        if (m.soc[0].y > 20 && w > 900) problems.push('icons not in the top row');
      }
      if (m.ca.y > 140) problems.push('CA slot is not at the top');
      if (m.caClipped) problems.push('CA text clipped');
      if (name === 'stated' && w >= 1366 && m.caFont < 18) problems.push('CA font too small on desktop: ' + m.caFont);
      if (name === 'stated' && m.caFont < 12.5) problems.push('CA font too small: ' + m.caFont);
      if (m.clippedStats.length) problems.push('stat values clipped: ' + m.clippedStats.join(','));
      if (m.rowsOverflow) problems.push('row content overflows: ' + m.rowsOverflow);
      if (w >= 1366) {
        if (Math.abs(m.side.w - 232) > 1) problems.push('sidebar width ' + m.side.w);
        if (Math.abs(m.right.w - 392) > 1) problems.push('rail width ' + m.right.w);
        if (Math.abs(m.tick.h - 38) > 0.5) problems.push('ticker height ' + m.tick.h);
      }
      if (problems.length) failures++;
      rows.push({ branch: name, w, h, overflow: m.overflow, taps: m.tapCount, caFont: m.caFont, caH: Math.round(m.ca.h), barH: Math.round(m.bar.h), side: m.side ? Math.round(m.side.w) : '-', rail: m.right ? Math.round(m.right.w) : '-', tick: Math.round(m.tick.h), stageW: Math.round(m.stage.w), h1: m.h1, rowH: Math.round(m.rowH.h), problems });
      console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name.padEnd(6)} ${w}x${h}  bar ${Math.round(m.bar.h)}  ca ${Math.round(m.ca.w)}x${Math.round(m.ca.h)} @${m.caFont}px  side ${m.side ? Math.round(m.side.w) : '-'}  rail ${m.right ? Math.round(m.right.w) : '-'}  tick ${Math.round(m.tick.h)}  stage ${Math.round(m.stage.w)}  h1 ${m.h1}px  row ${Math.round(m.rowH.h)}  taps ${m.tapCount}${problems.length ? '\n       ' + problems.join('\n       ') : ''}`);
      await t.close();
    }
  }
} finally {
  await browser.close();
  servers.forEach((s) => s.close());
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n${rows.length} measurements, ${failures} with problems`);
process.exit(failures ? 1 : 0);
