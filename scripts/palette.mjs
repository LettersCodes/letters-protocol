// Extract the palette from brand/ pixels only. Output: src/palette.json (data, with provenance).
// Run: node scripts/palette.mjs        Gate: scripts/gates.mjs re-derives it and compares.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { ROOT } from './lib/root.mjs';
import { dE, oklchString, rgbToOklch } from './lib/color.mjs';

export const BRAND_PNG = 'brand/LOGO LETTERS PNG...png'; // the one with a transparent background
export const BRAND_OPAQUE = 'brand/LOGO LETTERS PNG.png';
const MERGE = 0.04; // OKLab distance under which two pixel colours count as one family
const MIN_SHARE = 0.004; // families under 0.4% of opaque pixels are anti-aliasing, not palette

const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
const ihdr = (b) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20), bitDepth: b[24], colorType: b[25], interlace: b[28] });

export function extract() {
  const file = path.join(ROOT, BRAND_PNG);
  const buf = fs.readFileSync(file);
  const png = PNG.sync.read(buf);
  const { width: W, height: H, data } = png;

  const hist = new Map();
  const first = new Map();
  const alpha = { transparent: 0, partial: 0, opaque: 0 };
  let bbox = [W, H, 0, 0];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = data[i + 3];
      if (a === 0) { alpha.transparent++; continue; }
      if (a < 255) { alpha.partial++; } else alpha.opaque++;
      bbox = [Math.min(bbox[0], x), Math.min(bbox[1], y), Math.max(bbox[2], x), Math.max(bbox[3], y)];
      if (a < 255) continue;
      const k = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      hist.set(k, (hist.get(k) || 0) + 1);
      if (!first.has(k)) first.set(k, [x, y]);
    }
  }
  const unpack = (k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255];
  const colours = [...hist.entries()].sort((a, b) => b[1] - a[1]);

  // greedy families, most common colour first so the centre is a real, frequent pixel value
  const fams = [];
  for (const [k, n] of colours) {
    const rgb = unpack(k);
    let f = fams.find((q) => dE(q.seed, rgb) < MERGE);
    if (!f) { f = { seed: rgb, n: 0, sum: [0, 0, 0], mode: rgb, modeN: n, at: first.get(k) }; fams.push(f); }
    f.n += n; f.sum[0] += rgb[0] * n; f.sum[1] += rgb[1] * n; f.sum[2] += rgb[2] * n;
  }
  const total = alpha.opaque;
  const kept = fams.filter((f) => f.n / total >= MIN_SHARE).map((f) => {
    const mean = f.sum.map((s) => Math.round(s / f.n));
    const [L, C, h] = rgbToOklch(mean);
    return { rgb: mean, mode: f.mode, share: +(f.n / total).toFixed(4), pixels: f.n, firstAt: f.at, L, C, h };
  });

  kept.sort((a, b) => a.L - b.L);
  // roles by rule, never by taste: the single highest-chroma family is the accent; the rest are ordered by lightness
  const accent = kept.reduce((m, f) => (f.C > m.C ? f : m));
  const neutrals = kept.filter((f) => f !== accent);
  const dark = neutrals.filter((f) => f.L < 0.5);
  const light = neutrals.filter((f) => f.L >= 0.5);
  const palette = {};
  const name = (list, prefix) => list.forEach((f, i) => { palette[`${prefix}-${i + 1}`] = f; });
  name(dark, 'dark');
  name(light, 'light');
  palette.accent = accent;

  const out = {
    source: {
      file: BRAND_PNG,
      sha1: sha(buf),
      ...ihdr(buf),
      colorTypeName: { 0: 'greyscale', 2: 'rgb', 3: 'indexed', 4: 'greyscale+alpha', 6: 'rgba' }[buf[25]],
      alpha,
      bbox,
      distinctOpaqueColours: colours.length,
      method: `exact-pixel histogram of fully opaque pixels, greedy OKLab families (distance < ${MERGE}), kept when share >= ${MIN_SHARE}; family colour = pixel-weighted mean`,
    },
    background: backgroundOf(),
    palette: Object.fromEntries(Object.entries(palette).map(([id, f]) => [id, {
      rgb: f.rgb, oklch: oklchString(f.rgb), share: f.share, pixels: f.pixels, mostCommonExactPixel: f.mode, firstSeenAt: f.firstAt,
    }])),
  };
  return out;
}

// What sits behind the mark in the opaque exports: sample the four corners of both.
function backgroundOf() {
  const out = {};
  for (const rel of [BRAND_OPAQUE]) {
    const png = PNG.sync.read(fs.readFileSync(path.join(ROOT, rel)));
    const at = (x, y) => { const i = (y * png.width + x) * 4; return [png.data[i], png.data[i + 1], png.data[i + 2]]; };
    const corners = [at(0, 0), at(png.width - 1, 0), at(0, png.height - 1), at(png.width - 1, png.height - 1)];
    out[rel] = { corners, uniform: corners.every((c) => c.join() === corners[0].join()), rgb: corners[0], oklch: oklchString(corners[0]) };
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts/palette.mjs')) {
  const out = extract();
  fs.writeFileSync(path.join(ROOT, 'src/palette.json'), JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify(out.source, null, 1));
  console.log(JSON.stringify(out.background, null, 1));
  for (const [id, f] of Object.entries(out.palette)) console.log(id.padEnd(8), f.rgb.join(',').padEnd(13), f.oklch.padEnd(26), (f.share * 100).toFixed(1) + '%', 'first', f.firstSeenAt.join(','));
}
