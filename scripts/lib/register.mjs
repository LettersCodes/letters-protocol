// Register pattern: every external fact is one record with a state of stated | absent | unconfirmed.
// Absent and unconfirmed records are inert and must not carry a value or a url.
export const STATES = ['stated', 'absent', 'unconfirmed'];
export const INERT_ALLOWED = new Set(['id', 'label', 'kind', 'network', 'state', 'source', 'scope', 'recorded']);

export const isInert = (r) => r.state !== 'stated';

const X_URL = /^https:\/\/(x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/?$/;
const GH_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})(\/[A-Za-z0-9._-]+)?\/?$/;

// Store the URL, derive the handle. Never store a handle.
export function deriveHandle(r) {
  if (isInert(r) || !r.url) return null;
  if (r.network === 'x') { const m = X_URL.exec(r.url); return m ? '@' + m[2] : null; }
  if (r.network === 'github') { const m = GH_URL.exec(r.url); return m ? m[1] + (m[2] || '') : null; }
  return null;
}

export const ADDRESS_HEX = /\b0x[0-9a-fA-F]{40}\b/g;
export const ADDRESS_B58 = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
export const looksAddress = (s) =>
  /^0x[0-9a-fA-F]{40}$/.test(s) ||
  (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s) && /\d/.test(s) && /[a-z]/.test(s) && /[A-Z]/.test(s));

export function validateRegister(reg) {
  const errors = [];
  const ids = new Set();
  if (!reg || !Array.isArray(reg.records)) return ['records[] missing'];
  for (const r of reg.records) {
    if (!r.id) { errors.push('record without id'); continue; }
    if (ids.has(r.id)) errors.push(`${r.id}: duplicate id`);
    ids.add(r.id);
    if (!STATES.includes(r.state)) errors.push(`${r.id}: bad state ${r.state}`);
    if (!r.label) errors.push(`${r.id}: label missing`);
    if ('handle' in r) errors.push(`${r.id}: handle is derived, never stored`);
    if (isInert(r)) {
      if ('value' in r) errors.push(`${r.id}: inert record carries value`);
      if ('url' in r) errors.push(`${r.id}: inert record carries url`);
      for (const k of Object.keys(r)) if (!INERT_ALLOWED.has(k)) errors.push(`${r.id}: inert record carries ${k}`);
    } else {
      if (r.kind === 'social') {
        if (!r.url) errors.push(`${r.id}: stated social needs url`);
        else if (!deriveHandle(r)) errors.push(`${r.id}: url does not match ${r.network}`);
      }
      if (r.kind === 'address' && !(typeof r.value === 'string' && looksAddress(r.value))) errors.push(`${r.id}: stated address is not address-shaped`);
      if (r.kind === 'source' && !/^https:\/\//.test(r.url || '')) errors.push(`${r.id}: source needs https url`);
    }
  }
  for (const need of ['chain', 'ca', 'x', 'github', 'market-source']) if (!ids.has(need)) errors.push(`missing record ${need}`);
  return errors;
}

// What the page may see: no dates, and nothing the record does not carry.
export function publicView(reg) {
  return {
    version: reg.version,
    records: reg.records.map((r) => {
      const { recorded, ...rest } = r;
      return rest;
    }),
  };
}

export const byId = (reg, id) => reg.records.find((r) => r.id === id);

// Gate warning: match address-shaped strings against the stated registry; the CA itself is exempt.
export function statedAddresses(reg) {
  const out = new Set();
  for (const r of reg.records) if (!isInert(r) && typeof r.value === 'string' && looksAddress(r.value)) out.add(r.value);
  return out;
}

export function scanAddresses(text, reg) {
  const known = statedAddresses(reg);
  const found = [];
  for (const re of [ADDRESS_HEX, ADDRESS_B58]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) if (looksAddress(m[0]) && !known.has(m[0])) found.push(m[0]);
  }
  return found;
}
