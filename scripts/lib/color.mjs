// sRGB <-> OKLab/OKLCH (Björn Ottosson's matrices).
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };

const memo = new Map();
export function rgbToOklab(rgb) {
  const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
  let v = memo.get(key);
  if (!v) { v = rawOklab(rgb); memo.set(key, v); }
  return v;
}

function rawOklab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

export function rgbToOklch(rgb) {
  const [L, a, b] = rgbToOklab(rgb);
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

export const dE = (p, q) => { const a = rgbToOklab(p), b = rgbToOklab(q); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };

const f = (n, d) => String(+n.toFixed(d));
export function oklchString(rgb) {
  const [L, C, h] = rgbToOklch(rgb);
  // a colour with no measurable chroma has no meaningful hue
  return C < 0.0005 ? `oklch(${f(L, 4)} 0 0)` : `oklch(${f(L, 4)} ${f(C, 4)} ${f(h, 1)})`;
}
