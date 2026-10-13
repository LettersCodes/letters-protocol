// Pure checks over built output. Each returns an array of problems; empty means pass.
// Anchors read the current record at runtime, so none of them depend on which state a record happens to be in.
import { isInert, deriveHandle, byId, scanAddresses, validateRegister, looksAddress } from './register.mjs';
import { htmlTexts, jsCopy, findDates, findColorLiterals, oklchChromas, chromaZero, bigrams, hash } from './scan.mjs';

const attrOf = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? m[1] : null; };
const unesc = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function socialTag(html, id) {
  const m = new RegExp(`<(a|span)\\s[^>]*data-id="${id}"[^>]*>`).exec(html);
  return m ? { name: m[1], tag: m[0] } : null;
}

export function checkSocials(html, reg) {
  const out = [];
  const socials = reg.records.filter((r) => r.kind === 'social');
  if (socials.length < 2) out.push('fewer than two social records');
  for (const r of socials) {
    const t = socialTag(html, r.id);
    if (!t) { out.push(`${r.id}: icon missing`); continue; }
    if (!/<svg/.test(html.slice(html.indexOf(t.tag), html.indexOf(t.tag) + 4000))) out.push(`${r.id}: svg mark missing`);
    const href = attrOf(t.tag, 'href');
    if (isInert(r)) {
      if (href !== null) out.push(`${r.id}: inert icon has href`);
      if (t.name !== 'span') out.push(`${r.id}: inert icon should not be a link`);
      if (/\stabindex=/.test(t.tag)) out.push(`${r.id}: inert icon is focusable`);
      const label = attrOf(t.tag, 'aria-label') || '';
      if (!/pending/.test(label)) out.push(`${r.id}: inert label should say pending`);
    } else {
      if (t.name !== 'a') out.push(`${r.id}: stated icon is not a link`);
      if (unesc(href || '') !== r.url) out.push(`${r.id}: href differs from record url`);
      const handle = deriveHandle(r);
      if (!handle || !(attrOf(t.tag, 'aria-label') || '').includes(handle)) out.push(`${r.id}: label lacks derived handle`);
      if (attrOf(t.tag, 'rel') !== 'noopener noreferrer') out.push(`${r.id}: rel missing`);
    }
  }
  return out;
}

export function checkCa(html, reg) {
  const out = [];
  const r = byId(reg, 'ca');
  const slot = /<div class="ca"[^>]*>[\s\S]*?<\/div>/.exec(html);
  if (!slot) return ['ca slot missing'];
  const s = slot[0];
  if (html.indexOf(slot[0]) > html.indexOf('<aside class="side"')) out.push('ca slot is not before the sidebar');
  if (isInert(r)) {
    if (/<button/.test(s) || /data-copy|ca-copy/.test(s)) out.push('inert ca slot has a copy control');
    if (!/pending/.test(s)) out.push('inert ca slot does not say pending');
    if (/\b0x[0-9a-fA-F]{40}\b|[1-9A-HJ-NP-Za-km-z]{32,44}/.test(s.replace(/data-[a-z]+="[^"]*"/g, ''))) out.push('inert ca slot carries an address');
  } else {
    if (!s.includes(r.value)) out.push('stated ca slot does not show the full address');
    if (!/<button[^>]*id="ca-copy"/.test(s)) out.push('stated ca slot has no copy button');
  }
  return out;
}

export function checkRegisterRows(html, reg) {
  const out = [];
  for (const r of reg.records) {
    const m = new RegExp(`<div class="rrow[^"]*"[^>]*data-id="${r.id}"[^>]*>([\\s\\S]*?)</div>`).exec(html);
    if (!m) { out.push(`${r.id}: register row missing`); continue; }
    const text = m[1].replace(/<[^>]*>/g, '|').split('|').filter(Boolean);
    if (isInert(r)) {
      if (text.length !== 2 || text[0] !== r.label || text[1] !== 'pending') out.push(`${r.id}: inert row must be label + pending only, got ${JSON.stringify(text)}`);
    }
  }
  return out;
}

export function checkPublicRegister(html, reg) {
  const out = [];
  const m = /<script id="register-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return ['register-data missing'];
  let pub;
  try { pub = JSON.parse(m[1]); } catch { return ['register-data is not JSON']; }
  for (const r of pub.records) {
    if ('recorded' in r) out.push(`${r.id}: date field shipped to the page`);
    if (r.state !== 'stated' && ('value' in r || 'url' in r || 'handle' in r)) out.push(`${r.id}: inert record ships value or url`);
  }
  if (JSON.stringify(pub.records.map((r) => [r.id, r.state])) !== JSON.stringify(reg.records.map((r) => [r.id, r.state]))) out.push('public view differs from register');
  return out;
}

export const checkAddresses = (text, reg) => scanAddresses(text, reg).map((a) => `address-shaped string not in registry: ${a}`);

export function checkDates(html, js, css) {
  const out = [];
  const { texts, attrs } = htmlTexts(html);
  for (const t of [...texts, ...attrs]) for (const h of findDates(t)) out.push(`html "${t.slice(0, 60)}" -> ${h}`);
  const meta = [...html.matchAll(/<metas+(?:name|property)="(?:description|og:[a-z]+)"s+content="([^"]*)"/g)].map((m) => m[1]);
  for (const t of meta) for (const h of findDates(t)) out.push(`meta "${t.slice(0, 60)}" -> ${h}`);
  for (const t of jsCopy(js)) for (const h of findDates(t)) out.push(`js "${t.slice(0, 60)}" -> ${h}`);
  for (const m of css.matchAll(/content\s*:\s*"([^"]*)"/g)) for (const h of findDates(m[1])) out.push(`css "${m[1]}" -> ${h}`);
  return out;
}

export function checkPalette(files, tokensFile) {
  const out = [];
  for (const [name, src] of Object.entries(files)) {
    if (name.endsWith(tokensFile)) continue;
    for (const hit of findColorLiterals(src)) out.push(`${name}: colour literal ${hit}`);
  }
  return out;
}

// Every colour literal in the tokens must be a pixel-derived palette entry; nothing may be invented.
export function checkTokenProvenance(css, palette) {
  const allowed = new Set([...Object.values(palette.palette).map((f) => f.oklch), ...Object.values(palette.background).map((b) => b.oklch)]);
  const out = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/oklch\([^)]*\)/g)) if (!allowed.has(m[0])) out.push(`colour not traceable to brand pixels: ${m[0]}`);
  return out;
}

export function checkChroma(files) {
  const out = [];
  for (const [name, src] of Object.entries(files)) {
    for (const { text, chroma } of oklchChromas(src)) if (!chromaZero(chroma)) out.push(`${name}: ${text} chroma ${chroma}`);
  }
  return out;
}

export function checkChUnits(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = src.match(/(?<![\w-])-?\d*\.?\d+ch\b/g);
  return m ? m.map((x) => `ch unit ${x}`) : [];
}

export function checkOriginality(html, js, refHashes) {
  const out = [];
  const { texts, attrs } = htmlTexts(html);
  const meta = [...html.matchAll(/<metas+(?:name|property)="(?:description|og:[a-z]+)"s+content="([^"]*)"/g)].map((m) => m[1]);
  const strings = [...texts, ...attrs, ...meta, ...jsCopy(js)];
  for (const s of strings) for (const b of bigrams(s)) if (refHashes.has(hash(b))) out.push(`shared 2-gram "${b}" in "${s.slice(0, 50)}"`);
  return out;
}

export { validateRegister, looksAddress };
