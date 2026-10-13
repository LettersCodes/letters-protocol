import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function walk(dir, filter = () => true) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

export const read = (p) => fs.readFileSync(p, 'utf8');

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·');

// Visible text of an HTML document plus the attributes a person or reader can see.
export function htmlTexts(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const texts = body.split(/<[^>]*>/).map((t) => decode(t).replace(/\s+/g, ' ').trim()).filter(Boolean);
  const attrs = [];
  const re = /\b(?:title|aria-label|alt|placeholder|aria-description)="([^"]*)"/g;
  let m;
  while ((m = re.exec(body))) attrs.push(decode(m[1]).trim());
  return { texts, attrs };
}

// String literals that contain two words: the copy a script can put on screen.
export function jsCopy(js) {
  const out = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(js))) {
    const s = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
    if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(s) && !/[{};=<>]/.test(s) && !/^[.#\[]/.test(s)) out.push(s);
  }
  return out;
}

export const words = (s) => s.toLowerCase().match(/[a-z0-9$]+/g) || [];
export const bigrams = (s) => {
  const w = words(s);
  const o = [];
  for (let i = 0; i < w.length - 1; i++) o.push(w[i] + ' ' + w[i + 1]);
  return o;
};
export const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);

// Dates, timestamps, "as of" phrasing, clock strings.
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
export const DATE_PATTERNS = [
  ['iso date', /\b\d{4}-\d{2}-\d{2}\b/],
  ['numeric date', /\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/],
  ['month day', new RegExp(`\\b${MONTH}\\s+\\d{1,2}\\b`, 'i')],
  ['day month', new RegExp(`\\b\\d{1,2}\\s+${MONTH}\\b`, 'i')],
  ['year', /\b(?:19|20)\d{2}\b/],
  ['clock', /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:am|pm)?\b/i],
  ['phrase', /\b(?:as of|checked|last updated|updated|ago|timestamp|today|yesterday|tomorrow|last seen)\b/i],
];
export function findDates(s) {
  const hits = [];
  for (const [name, re] of DATE_PATTERNS) {
    const m = re.exec(s);
    if (m) hits.push(`${name}: "${m[0]}"`);
  }
  return hits;
}

// Colour literals: anything that names a colour outside the tokens file.
export function findColorLiterals(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const hits = [];
  const hex = src.match(/#[0-9a-fA-F]{3,8}\b/g);
  if (hex) hits.push(...hex.filter((h) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(h) && /[0-9]/.test(h) !== false));
  for (const fn of ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch']) {
    if (new RegExp(`(?<![\\w-])${fn}\\(`).test(src)) hits.push(`${fn}(`);
  }
  const named = /(?:color|background(?:-color)?|border(?:-[a-z]+)*|outline(?:-color)?|fill|stroke|box-shadow|text-shadow)\s*:[^;{}]*\b(white|black|gray|grey|red|green|blue|orange|yellow|purple|pink|silver|navy|teal|gold)\b/i.exec(src);
  if (named) hits.push(named[1]);
  return hits;
}

// Every oklch() in a file must have chroma exactly 0.
export function oklchChromas(src) {
  const out = [];
  const re = /oklch\(\s*([^\s)]+)\s+([^\s)]+)\s+([^)]*)\)/g;
  let m;
  while ((m = re.exec(src))) out.push({ text: m[0], chroma: m[2] });
  return out;
}
export const chromaZero = (c) => /^0(?:\.0+)?$/.test(c);
