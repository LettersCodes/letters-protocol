// Contract address slot: inert until the register states one, then click-to-copy with feedback.
import { copyText, announce } from './dom.js';

export function mountCa(register) {
  const rec = register.records.find((r) => r.id === 'ca');
  const stated = !!rec && rec.state === 'stated';
  const pill = document.getElementById('ev-ca');
  if (pill) {
    pill.textContent = stated ? 'STATED' : 'PENDING';
    pill.dataset.on = String(stated);
  }
  const btn = document.getElementById('ca-copy');
  if (!btn || !stated) return;
  const act = btn.querySelector('.ca-act');
  const addr = btn.querySelector('.ca-addr');
  let timer = 0;
  btn.addEventListener('click', async () => {
    const ok = await copyText(rec.value);
    clearTimeout(timer);
    if (ok) {
      btn.dataset.copied = 'true';
      act.textContent = 'COPIED';
      announce('Mint copied');
    } else {
      const range = document.createRange();
      range.selectNodeContents(addr);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      act.textContent = 'SELECT';
      announce('Copy failed, mint selected');
    }
    timer = setTimeout(() => { btn.dataset.copied = 'false'; act.textContent = 'COPY'; }, 1600);
  });
}
