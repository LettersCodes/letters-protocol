// Everything that is derived from brand/ pixels: palette -> tokens.css, favicon traced from the logo grid, logo crops.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { ROOT } from './root.mjs';
import { extract, BRAND_PNG } from '../palette.mjs';
import { dE, oklchString } from './color.mjs';

let memo = null;

export function brandAssets() {
  if (memo) return memo;
  const palette = extract();
  const png = PNG.sync.read(fs.readFileSync(path.join(ROOT, BRAND_PNG)));
  memo = { palette, tokensCss: renderTokens(palette), favicon: traceFavicon(palette, png), logos: { 96: cropScale(png, palette.source.bbox, 96), 640: cropScale(png, palette.source.bbox, 640) } };
  return memo;
}

/* ---------- tokens ---------- */
const ROLE = {
  bg: 'p-bg', card: 'p-dark-3', 'card-2': 'p-dark-4', soft: 'p-dark-5', dim: 'p-dark-6', grid: 'p-dark-2',
  ink: 'p-light-7', 'ink-2': 'p-light-4', 'ink-3': 'p-light-2',
  cream: 'p-light-6', 'cream-hi': 'p-light-8', 'cream-lo': 'p-light-3',
  accent: 'p-accent', 'on-accent': 'p-dark-1',
};

export function renderTokens(pal) {
  const lines = [];
  lines.push('/* Derived from the brand pixels through scripts/lib/assets.mjs. Edit the logo, not this file.');
  lines.push(`   source: ${pal.source.file}  sha1 ${pal.source.sha1}`);
  lines.push(`   ${pal.source.width}x${pal.source.height} IHDR colour type ${pal.source.colorType} (${pal.source.colorTypeName}), bit depth ${pal.source.bitDepth}`);
  lines.push(`   alpha: ${pal.source.alpha.transparent} transparent, ${pal.source.alpha.partial} partial, ${pal.source.alpha.opaque} opaque`);
  lines.push('   Colour literals live in this file and nowhere else. */');
  lines.push(':root{');
  const bg = Object.values(pal.background)[0];
  lines.push(`  --p-bg: ${bg.oklch}; /* page background of the opaque export, all four corners rgb ${bg.rgb.join(',')} */`);
  for (const [id, f] of Object.entries(pal.palette)) {
    lines.push(`  --p-${id}: ${f.oklch}; /* rgb ${f.rgb.join(',')} · ${(f.share * 100).toFixed(1)}% of opaque pixels · first at ${f.firstSeenAt.join(',')} */`);
  }
  lines.push('');
  for (const [role, id] of Object.entries(ROLE)) {
    if (id !== 'p-bg' && !pal.palette[id.slice(2)]) throw new Error('palette lacks ' + id);
    lines.push(`  --${role}: var(--${id});`);
  }
  lines.push('  --line: var(--cream-lo);');
  lines.push('  --line-hi: var(--cream);');
  lines.push('  --edge: var(--soft);');
  lines.push('  --glow: color-mix(in oklch, var(--accent) 40%, transparent);');
  lines.push('  --glow-2: color-mix(in oklch, var(--accent) 16%, transparent);');
  lines.push('  --shade: color-mix(in oklch, var(--bg) 72%, transparent);');
  lines.push('  --lift: color-mix(in oklch, var(--cream) 9%, transparent);');
  lines.push('  color-scheme: dark;');
  lines.push('}');
  return lines.join('\n') + '\n';
}

/* ---------- favicon: 32x32 cells sampled from the logo's real pixels ---------- */
const FAV_MIN_SHARE = 0.02;

export function traceFavicon(pal, png) {
  const [x0, y0, x1, y1] = pal.source.bbox;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const side = Math.max(bw, bh);
  const ox = x0 - Math.floor((side - bw) / 2), oy = y0 - Math.floor((side - bh) / 2);
  const set = Object.entries(pal.palette).filter(([, f]) => f.share >= FAV_MIN_SHARE).map(([id, f]) => ({ id, rgb: f.rgb, oklch: f.oklch }));
  const bgRgb = Object.values(pal.background)[0].rgb;
  const bgOk = Object.values(pal.background)[0].oklch;
  const N = 32, cell = side / N;
  const grid = [];
  for (let cy = 0; cy < N; cy++) {
    const row = [];
    for (let cx = 0; cx < N; cx++) {
      const votes = new Map();
      let seen = 0, solid = 0;
      for (let y = Math.floor(oy + cy * cell); y < Math.floor(oy + (cy + 1) * cell); y++) {
        for (let x = Math.floor(ox + cx * cell); x < Math.floor(ox + (cx + 1) * cell); x++) {
          seen++;
          if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
          const i = (y * png.width + x) * 4;
          if (png.data[i + 3] < 128) continue;
          solid++;
          const rgb = [png.data[i], png.data[i + 1], png.data[i + 2]];
          let best = set[0], bd = Infinity;
          for (const s of set) { const d = dE(rgb, s.rgb); if (d < bd) { bd = d; best = s; } }
          votes.set(best.id, (votes.get(best.id) || 0) + 1);
        }
      }
      if (solid < seen / 2) { row.push(null); continue; }
      row.push([...votes.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    }
    grid.push(row);
  }
  // merge runs along x, then stack identical runs along y
  const byId = Object.fromEntries(set.map((s) => [s.id, s.oklch]));
  const runs = [];
  for (let y = 0; y < N; y++) {
    let x = 0;
    while (x < N) {
      const id = grid[y][x];
      let e = x;
      while (e + 1 < N && grid[y][e + 1] === id) e++;
      if (id) runs.push({ id, x, y, w: e - x + 1, h: 1 });
      x = e + 1;
    }
  }
  const merged = [];
  for (const r of runs) {
    const up = merged.find((m) => m.id === r.id && m.x === r.x && m.w === r.w && m.y + m.h === r.y);
    if (up) up.h++; else merged.push({ ...r });
  }
  const rects = merged.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${byId[r.id]}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges"><rect width="32" height="32" fill="${bgOk}"/>${rects}</svg>\n`;
}

/* ---------- logo crops: bounding box of the mark, box-filtered to a target width ---------- */
export function cropScale(png, bbox, targetW) {
  const [x0, y0, x1, y1] = bbox;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const tw = targetW, th = Math.round((bh * targetW) / bw);
  const out = new PNG({ width: tw, height: th });
  const sx = bw / tw, sy = bh / th;
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const ya = Math.floor(y0 + ty * sy), yb = Math.max(ya + 1, Math.floor(y0 + (ty + 1) * sy));
      const xa = Math.floor(x0 + tx * sx), xb = Math.max(xa + 1, Math.floor(x0 + (tx + 1) * sx));
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          const i = (y * png.width + x) * 4;
          const al = png.data[i + 3];
          r += png.data[i] * al; g += png.data[i + 1] * al; b += png.data[i + 2] * al; a += al; n++;
        }
      }
      const o = (ty * tw + tx) * 4;
      if (a > 0) { out.data[o] = Math.round(r / a); out.data[o + 1] = Math.round(g / a); out.data[o + 2] = Math.round(b / a); }
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(out);
}

export { oklchString };
