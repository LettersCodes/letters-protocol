import { initReveal, initParallax, initSpotlight, initProgress, initBarHeight, initSpy, setUserMotion, systemReduced } from './motion.js';
import { Feed } from './market.js';
import { mountBoard } from './board.js';
import { mountCa } from './ca.js';
import { initStars } from './stars.js';

const register = JSON.parse(document.getElementById('register-data').textContent);

function initMotionSwitch() {
  const btn = document.getElementById('motion');
  const label = document.getElementById('motion-t');
  const paint = (on) => { btn.setAttribute('aria-checked', String(on)); label.textContent = on ? 'Motion on' : 'Motion off'; };
  if (systemReduced()) { paint(false); btn.disabled = true; btn.title = 'Your system asks for less motion'; return; }
  let on = true;
  try { on = localStorage.getItem('letters-motion') !== 'off'; } catch { on = true; }
  setUserMotion(on);
  paint(on);
  btn.addEventListener('click', () => {
    on = !on;
    setUserMotion(on);
    paint(on);
    try { localStorage.setItem('letters-motion', on ? 'on' : 'off'); } catch { /* storage may be blocked */ }
  });
}

initMotionSwitch();
initBarHeight();
initProgress();
initSpotlight();
initSpy();
initReveal();
initParallax(document.getElementById('stage'));
initStars(document.getElementById('stage'));
mountCa(register);

// The market follows the market-source record and nothing else.
const source = register.records.find((r) => r.id === 'market-source');
const feed = new Feed(source && source.state === 'stated' ? source : { url: '', boostsPath: '', pairsPath: '', chainId: 'solana', top: 10, pollMs: 60000, timeoutMs: 8000 });
mountBoard(feed);
if (source && source.state === 'stated') feed.start();
else { feed.status = 'error'; feed.emit(); }
