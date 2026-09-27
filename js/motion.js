// Animații: numere care „urcă”, sărbătorire când prețul intră sub prag, ruta animată.
// Toate respectă setarea telefonului „Reducere mișcare” (prefers-reduced-motion).

import { store } from './util.js';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animează un număr de la 0 (sau `from`) la valoarea finală. Elementele au data-count="137". */
export function countUp(root = document) {
  const fmt = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 });
  root.querySelectorAll('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count);
    const node = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : null;
    if (!node || !Number.isFinite(to) || reducedMotion()) return;
    const from = Math.round(to * 0.7);
    const start = performance.now();
    const dur = 650;
    const tick = (t) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - (1 - k) ** 3;
      node.textContent = fmt.format(Math.round(from + (to - from) * eased));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Mică sărbătorire (confetti), o singură dată pe zi pentru fiecare alertă. */
export function celebrate(anchor, key, day) {
  if (!anchor || reducedMotion()) return;
  const storeKey = `zboruri.celebrated.${key}`;
  if (store.get(storeKey) === day) return;
  store.set(storeKey, day);
  const colors = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--good)'];
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('i');
    p.style.setProperty('--x', `${Math.round((Math.random() - 0.5) * 320)}px`);
    p.style.setProperty('--y', `${Math.round(120 + Math.random() * 220)}px`);
    p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.setProperty('--d', `${(Math.random() * 0.25).toFixed(2)}s`);
    p.style.background = colors[i % colors.length];
    layer.appendChild(p);
  }
  anchor.appendChild(layer);
  setTimeout(() => layer.remove(), 1800);
}

/**
 * Ruta animată: un arc punctat care se desenează, cu un avion care îl parcurge.
 * (Arc stilizat, nu o hartă geografică reală. Avionul se oprește la jumătate: „în zbor”.)
 */
export function routeArc() {
  const plane = 'M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z';
  const d = 'M8,34 Q150,-6 292,34';
  const animate = !reducedMotion();
  return `<svg class="route-arc" viewBox="0 0 300 40" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path d="${d}" class="arc-bg"/>
    <path d="${d}" class="arc-line ${animate ? 'draw' : ''}" pathLength="1"/>
    <circle cx="8" cy="34" r="3.5" class="arc-dot"/>
    <circle cx="292" cy="34" r="3.5" class="arc-dot end"/>
    <g class="arc-plane">
      <g transform="rotate(45) scale(0.75) translate(-12 -12)"><path d="${plane}"/></g>
      ${animate
        ? `<animateMotion dur="1.6s" begin="0.15s" fill="freeze" rotate="auto" keyPoints="0;0.5" keyTimes="0;1" calcMode="spline" keySplines="0.3 0 0.2 1" path="${d}"/>`
        : `<animateMotion dur="0.01s" fill="freeze" rotate="auto" keyPoints="0.5;0.5" keyTimes="0;1" path="${d}"/>`}
    </g>
  </svg>`;
}
