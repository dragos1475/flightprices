// Gesturi: glisare spre stânga pe carduri (acțiuni) și tragere în jos pentru reîmprospătare.

import { icon } from './icons.js';
import { haptic } from './motion.js';

const OPEN_X = -148; // cât se deschide cardul (lățimea butoanelor din spate)

/**
 * Cardurile din `root` cu clasa .swipe-card devin glisabile spre stânga,
 * dezvăluind butoanele din .swipe-actions (în același .swipe-wrap).
 */
export function enableSwipe(root) {
  let open = null; // cardul deschis acum

  const close = (card) => {
    if (!card) return;
    card.style.transform = '';
    card.classList.remove('is-open');
    if (open === card) open = null;
  };

  root.querySelectorAll('.swipe-card').forEach((card) => {
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dragging = false;
    let decided = false;
    let moved = false;

    // fără „drag and drop” nativ al linkului (altfel browserul anulează glisarea)
    card.setAttribute('draggable', 'false');
    card.addEventListener('dragstart', (e) => e.preventDefault());

    card.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX;
      startY = e.clientY;
      dx = 0;
      dragging = true;
      decided = false;
      moved = false;
    });
    card.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const mx = e.clientX - startX;
      const my = e.clientY - startY;
      if (!decided) {
        if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
        decided = true;
        if (Math.abs(mx) <= Math.abs(my) * 1.2) {
          dragging = false; // derulare verticală: nu ne amestecăm
          return;
        }
        card.setPointerCapture(e.pointerId);
        card.classList.add('dragging');
        if (open && open !== card) close(open);
      }
      moved = true;
      const base = card.classList.contains('is-open') ? OPEN_X : 0;
      dx = Math.max(OPEN_X - 30, Math.min(0, base + mx));
      card.style.transform = `translateX(${dx}px)`;
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      card.classList.remove('dragging');
      if (!moved) return;
      if (dx < OPEN_X / 2) {
        card.style.transform = `translateX(${OPEN_X}px)`;
        card.classList.add('is-open');
        haptic(10);
        open = card;
      } else {
        close(card);
      }
    };
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
    // după o glisare, nu deschidem alerta; dacă e deschis, prima atingere îl închide
    card.addEventListener('click', (e) => {
      if (moved || card.classList.contains('is-open')) {
        e.preventDefault();
        if (!moved) close(card);
        moved = false;
      }
    });
  });

  // atingere în altă parte: închide cardul deschis
  root.addEventListener('pointerdown', (e) => {
    if (open && !e.target.closest('.swipe-wrap')?.contains(open)) close(open);
  });
}

// ---------------------------------------------------------------------------
// Tragere în jos pentru reîmprospătare (pull to refresh)
// ---------------------------------------------------------------------------
let cleanupPull = null;

/** Activează reîmprospătarea prin tragere pe ecranul curent. Se dezactivează la schimbarea ecranului. */
export function enablePullToRefresh(onRefresh) {
  disablePullToRefresh();
  const indicator = document.createElement('div');
  indicator.className = 'ptr';
  indicator.innerHTML = icon('refresh', 20);
  document.body.appendChild(indicator);

  let startY = null;
  let pull = 0;
  let busy = false;
  const THRESHOLD = 72;

  const onStart = (e) => {
    if (busy || window.scrollY > 0 || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    pull = 0;
  };
  const onMove = (e) => {
    if (startY === null) return;
    pull = Math.max(0, e.touches[0].clientY - startY);
    if (pull <= 0) return;
    const p = Math.min(1, pull / THRESHOLD);
    indicator.style.opacity = String(p);
    indicator.style.transform = `translate(-50%, ${Math.min(pull, THRESHOLD * 1.3) * 0.6}px) rotate(${p * 270}deg)`;
    indicator.classList.toggle('ready', p >= 1);
  };
  const onEnd = async () => {
    if (startY === null) return;
    startY = null;
    if (pull >= THRESHOLD && !busy) {
      busy = true;
      haptic(12);
      indicator.classList.add('spinning');
      try {
        await onRefresh();
      } finally {
        busy = false;
      }
    }
    indicator.classList.remove('spinning', 'ready');
    indicator.style.opacity = '0';
    indicator.style.transform = '';
  };

  window.addEventListener('touchstart', onStart, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', onEnd);
  cleanupPull = () => {
    window.removeEventListener('touchstart', onStart);
    window.removeEventListener('touchmove', onMove);
    window.removeEventListener('touchend', onEnd);
    indicator.remove();
  };
}

export function disablePullToRefresh() {
  if (cleanupPull) cleanupPull();
  cleanupPull = null;
}
