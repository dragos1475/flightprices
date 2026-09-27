// Creditele SerpApi rămase, afișate mereu în bara de sus și ținute la zi.
// Telefonul nu poate întreba SerpApi direct (cheia stă în GitHub Secrets, iar SerpApi nu permite
// apeluri din browser). GitHub scrie însă valoarea exactă în data/status.json după fiecare rulare
// (și la fiecare oră, dacă s-a schimbat); aplicația recitește fișierul:
//   - la fiecare minut cât e deschisă, când revii în ea și imediat după o căutare / „Preț la companie”.

import { icon } from './icons.js';
import { loadStatus, state } from './state.js';
import { dateTime, toast } from './util.js';

const EVERY_MS = 60 * 1000;
let shown = null;   // valoarea afișată acum
let timer = null;
let lastLoad = 0;

/** Creditele rămase după ultima rulare (null = necunoscut). */
export function creditsLeft(status = state.status) {
  return status?.searches_left_after ?? status?.searches_left_before ?? null;
}

const level = (n) => (n === null ? '' : n <= 5 ? 'bad' : n <= 25 ? 'warn' : '');

/** Locul din bara de sus (îl pune setNav pe fiecare ecran). */
export function creditsSlot() {
  const n = shown ?? creditsLeft();
  return `<button type="button" class="nav-credits ${level(n)}" id="nav-credits" aria-label="SerpApi credits left">
    ${icon('zap', 13)}<span class="nc-num">${n ?? '—'}</span></button>`;
}

/** Număr animat de la valoarea veche la cea nouă. */
function animateTo(el, from, to) {
  const num = el.querySelector('.nc-num');
  if (from === null || from === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    num.textContent = to ?? '—';
    return;
  }
  const start = performance.now();
  const dur = 700;
  const step = (t) => {
    const p = Math.min(1, (t - start) / dur);
    const eased = 1 - (1 - p) ** 3;
    num.textContent = Math.round(from + (to - from) * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  el.classList.remove('changed', 'up');
  void el.offsetWidth; // repornește animația
  el.classList.add('changed');
  if (to > from) el.classList.add('up');
}

/** Actualizează bara de sus cu valoarea din state.status. */
export function paintCredits() {
  const el = document.getElementById('nav-credits');
  const n = creditsLeft();
  if (!el) {
    shown = n;
    return;
  }
  el.className = `nav-credits ${level(n)}`;
  animateTo(el, shown, n);
  shown = n;
  const home = document.getElementById('home-credits'); // și cardul „Buget căutări” de pe pagina principală
  if (home) home.textContent = n ?? '—';
}

/** Recitește status.json (scris de GitHub) și actualizează afișarea. */
export async function refreshCredits() {
  lastLoad = Date.now();
  await loadStatus();
  paintCredits();
}

/** Pornește urmărirea: la fiecare minut (cât e aplicația deschisă), la revenire și la cerere. */
export function watchCredits() {
  if (timer) return;
  const tick = () => {
    if (document.visibilityState === 'visible' && Date.now() - lastLoad > EVERY_MS - 1000) refreshCredits();
  };
  timer = setInterval(tick, EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastLoad > 10 * 1000) refreshCredits();
  });
  // după o căutare rapidă / „Preț la companie”: GitHub a salvat tot odată (rezultat + credite)
  window.addEventListener('zboruri:credits', () => refreshCredits());
  // atingerea insignei: detaliile
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#nav-credits')) return;
    const st = state.status;
    const n = creditsLeft(st);
    toast(n === null
      ? 'SerpApi credits have not been checked yet (they appear after the first GitHub run).'
      : `SerpApi credits left: ${n}${st?.this_month_usage !== null && st?.this_month_usage !== undefined ? ` · used this month: ${st.this_month_usage}` : ''}${st?.credits_checked_at ? ` · checked ${dateTime(st.credits_checked_at)}` : ''}`, 5000);
  });
  refreshCredits();
}

/** Anunță că s-au consumat credite (aplicația recitește imediat valoarea). */
export function creditsChanged() {
  window.dispatchEvent(new Event('zboruri:credits'));
}
