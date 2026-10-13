import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib/root.mjs';
import { brandAssets } from './lib/assets.mjs';
import { build as esbuild } from 'esbuild';
import { validateRegister, publicView, byId, isInert, deriveHandle } from './lib/register.mjs';

export { ROOT };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const X_MARK = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>';
const GITHUB_MARK = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';
const MARKS = { x: X_MARK, github: GITHUB_MARK };

export function renderCa(rec) {
  if (isInert(rec)) {
    return `<div class="ca" data-state="${esc(rec.state)}" id="ca-slot"><span class="ca-tag">CA</span><span class="ca-v" aria-disabled="true"><span class="ca-addr">pending</span></span></div>`;
  }
  return `<div class="ca" data-state="stated" id="ca-slot"><span class="ca-tag">CA</span><button type="button" class="ca-v" id="ca-copy" aria-label="Copy mint address"><span class="ca-addr">${esc(rec.value)}</span><span class="ca-act">COPY</span></button></div>`;
}

export function renderSocials(reg) {
  const items = reg.records.filter((r) => r.kind === 'social').map((r) => {
    const mark = MARKS[r.network];
    if (isInert(r)) {
      return `<span class="soc inert" data-id="${esc(r.id)}" data-state="${esc(r.state)}" role="img" aria-label="${esc(r.label)}, pending" title="${esc(r.label)}, pending">${mark}</span>`;
    }
    const handle = deriveHandle(r);
    return `<a class="soc" data-id="${esc(r.id)}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(r.label)} ${esc(handle)}" title="${esc(r.label)} ${esc(handle)}">${mark}</a>`;
  });
  return `<div class="socials" id="socials">${items.join('')}</div>`;
}

const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

export function renderRegisterRows(reg) {
  return reg.records.map((r) => {
    if (isInert(r)) {
      return `        <div class="rrow spot" data-reveal data-id="${esc(r.id)}" data-state="${esc(r.state)}"><span class="rl">${esc(r.label)}</span><span class="rv rv-pending">pending</span></div>`;
    }
    let value = r.value || '';
    if (r.kind === 'social') value = deriveHandle(r);
    else if (r.kind === 'address') value = 'listed above';
    else if (r.kind === 'source') value = hostOf(r.url);
    return `        <div class="rrow spot" data-reveal data-id="${esc(r.id)}" data-state="stated"><span class="rl">${esc(r.label)}</span><span class="rv">${esc(value)}</span><span class="rs">STATED</span></div>`;
  }).join('\n');
}

export async function build({ registerPath = path.join(ROOT, 'src/register.json'), registerObj = null, out = path.join(ROOT, 'dist') } = {}) {
  const reg = registerObj || JSON.parse(fs.readFileSync(registerPath, 'utf8'));
  const errors = validateRegister(reg);
  if (errors.length) throw new Error('register invalid:\n  ' + errors.join('\n  '));

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const pub = publicView(reg);
  let html = fs.readFileSync(path.join(ROOT, 'src/index.template.html'), 'utf8');
  html = html
    .replace('<!--@CA-->', renderCa(byId(reg, 'ca')))
    .replace('<!--@SOCIALS-->', renderSocials(reg))
    .replace('<!--@REGISTER_ROWS-->', renderRegisterRows(reg))
    .replace('<!--@REGISTER_JSON-->', JSON.stringify(pub).replace(/</g, '\\u003c'));
  fs.writeFileSync(path.join(out, 'index.html'), html);

  const brand = brandAssets();
  fs.writeFileSync(path.join(out, 'tokens.css'), brand.tokensCss);
  fs.mkdirSync(path.join(out, 'img'), { recursive: true });
  fs.writeFileSync(path.join(out, 'img/logo-96.png'), brand.logos[96]);
  fs.writeFileSync(path.join(out, 'img/logo-640.png'), brand.logos[640]);
  fs.copyFileSync(path.join(ROOT, 'src/styles.css'), path.join(out, 'styles.css'));
  fs.writeFileSync(path.join(out, 'favicon.svg'), brand.favicon);
  fs.writeFileSync(path.join(out, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n');

  await esbuild({ entryPoints: [path.join(ROOT, 'src/js/main.js')], bundle: true, format: 'iife', target: 'es2020', outfile: path.join(out, 'app.js'), legalComments: 'none', logLevel: 'silent' });
  return { out, reg };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const brand = brandAssets();
  fs.writeFileSync(path.join(ROOT, 'src/palette.json'), JSON.stringify(brand.palette, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'src/tokens.css'), brand.tokensCss);
  const { out } = await build();
  const files = fs.readdirSync(out);
  console.log('built', path.relative(ROOT, out) + '/', files.join(' '));
}
