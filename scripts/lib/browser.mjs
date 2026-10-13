// Headless Edge helpers with a scripted stand-in for the public market API.
import puppeteer from 'puppeteer-core';
import { serve } from '../serve.mjs';

export const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const mockAddress = (i) => {
  let s = '';
  for (let k = 0; k < 44; k++) s += B58[(i * 7 + k * 13 + (k % 5) * i + 3) % B58.length];
  return s;
};

// 12 Solana tokens + 2 on another chain. Volume falls with the index, so the expected top ten is indexes 0..9.
export function mockData() {
  const boosts = [];
  const pairs = [];
  for (let i = 0; i < 12; i++) {
    const address = mockAddress(i + 1);
    boosts.push({ chainId: 'solana', tokenAddress: address });
    const info = i === 3 ? undefined : { imageUrl: i === 5 ? 'https://img.mock/broken.png' : `https://img.mock/ok${i}.png` };
    const base = { chainId: 'solana', baseToken: { address, name: `Mock Token ${i}`, symbol: i === 2 ? '$MCK' + i : 'MCK' + i }, quoteToken: { symbol: 'SOL' }, info };
    pairs.push({ ...base, priceUsd: String(0.001 * (i + 1)), priceChange: { h24: i % 2 ? -(5 + i) : 8 + i * 3 }, volume: { h24: 1_000_000 - i * 60_000 }, liquidity: { usd: 200_000 + i * 1000 } });
    pairs.push({ ...base, priceUsd: '0.5', priceChange: { h24: 1 }, volume: { h24: 10_000 }, liquidity: { usd: 500 } });
  }
  boosts.push({ chainId: 'ethereum', tokenAddress: '0x' + 'a1'.repeat(20) });
  boosts.push({ chainId: 'base', tokenAddress: '0x' + 'b2'.repeat(20) });
  return { boosts, pairs };
}

export async function launch() {
  return puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] });
}

// scenario: { mode: 'ok' | 'fail', delay: ms }, log: array of request records
export async function openPage(browser, url, { width = 1440, height = 900, scenario, log = [], reduced = false, hiddenControl = true } = {}) {
  const ctx = await browser.createBrowserContext();
  const origin = new URL(url).origin;
  await ctx.overridePermissions(origin, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  if (hiddenControl) {
    await page.evaluateOnNewDocument(() => {
      window.__hidden = false;
      Object.defineProperty(document, 'hidden', { get: () => window.__hidden });
      Object.defineProperty(document, 'visibilityState', { get: () => (window.__hidden ? 'hidden' : 'visible') });
    });
  }
  const data = mockData();
  await page.setRequestInterception(true);
  page.on('request', async (req) => { try {
    const u = req.url();
    const cors = { 'access-control-allow-origin': '*' };
    if (u.startsWith('https://api.dexscreener.com/')) {
      log.push({ url: u, t: Date.now() });
      if (scenario.delay) await new Promise((r) => setTimeout(r, scenario.delay));
      if (scenario.mode === 'fail') return req.respond({ status: 503, headers: cors, contentType: 'application/json', body: '{}' });
      if (u.includes('/token-boosts/top/v1')) return req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(data.boosts) });
      if (u.includes('/tokens/v1/solana/')) return req.respond({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(data.pairs.map((p) => ({ ...p, volume: { h24: p.volume.h24 * (scenario.k || 1) } }))) });
      return req.respond({ status: 404, headers: cors, body: '{}' });
    }
    if (u.startsWith('https://img.mock/')) {
      if (u.includes('broken')) return req.respond({ status: 404, body: '' });
      return req.respond({ status: 200, contentType: 'image/png', body: PNG });
    }
    if (u.startsWith('https://fonts.')) return req.abort();
    if (u.startsWith(origin)) return req.continue();
    return req.abort();
  } catch { /* page closed mid-request */ } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.bringToFront().catch(() => {});
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { page, ctx, errors, requests: () => log.length, close: () => ctx.close() };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(page, fn, timeout = 6000, ...args) {
  await page.waitForFunction(fn, { timeout, polling: 50 }, ...args);
}

export { serve };

// Wait for the ten rows; on a stall, say what the page was doing.
export async function boardReady(t, timeout = 12000) {
  try {
    await t.page.waitForFunction(() => document.querySelectorAll("#rows .drow").length === 10 && !document.querySelector(".sk-row"), { timeout, polling: 50 });
    return true;
  } catch {
    const d = await t.page.evaluate(() => ({ rows: document.querySelectorAll("#rows .drow").length, sk: document.querySelectorAll(".sk-row").length, pill: document.getElementById("pill") && document.getElementById("pill").dataset.state, hidden: document.hidden, vis: document.visibilityState })).catch((e) => ({ evalError: String(e) }));
    console.log("   stall:", JSON.stringify(d), "requests", t.requests ? t.requests() : "?", "errors", JSON.stringify(t.errors));
    return false;
  }
}
