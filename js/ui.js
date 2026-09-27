// Elemente de interfață comune: bara de sus, schelete de încărcare, mini-grafice.

import { icon } from './icons.js';
import { h } from './util.js';

/**
 * Configurează bara de sus a ecranului curent.
 *   title: textul din mijloc
 *   back: adresa pentru butonul „înapoi” (ex. '#/'), sau nimic
 *   actions: [{icon: 'edit', label: 'Editează', href: '#/...'} sau {icon, label, id}]
 */
export function setNav({ title = '', back = null, actions = [], large = false } = {}) {
  document.getElementById('nav-title').textContent = title;
  // large = titlul mare e în pagină; în bara de sus apare doar după derulare (ca pe iOS)
  document.querySelector('.navbar').classList.toggle('large', large);
  document.getElementById('nav-left').innerHTML = back
    ? `<a class="nav-btn" href="${h(back)}" aria-label="Înapoi">${icon('back', 24)}</a>`
    : '';
  document.getElementById('nav-right').innerHTML = actions.map((a) => a.href
    ? `<a class="nav-btn" href="${h(a.href)}" aria-label="${h(a.label)}" title="${h(a.label)}">${icon(a.icon, 22)}</a>`
    : `<button class="nav-btn" type="button" id="${h(a.id)}" aria-label="${h(a.label)}" title="${h(a.label)}">${icon(a.icon, 22)}</button>`).join('');
}

/** Nume pentru tranzițiile între ecrane (cardul din listă „se transformă” în ecranul de detaliu). */
export function vtName(id) {
  return `vt-${String(id).toLowerCase().replace(/[^a-z0-9-]/g, '-')}`;
}

/** Ascunde/afișează bara de jos (în formular folosim bara „Salvează”). */
export function setTabbarVisible(visible) {
  document.body.classList.toggle('no-tabbar', !visible);
}

/** Schelet de încărcare: forme gri animate cât timp se citesc datele. */
export function skeleton(cards = 3) {
  return `<div class="skeleton-wrap" aria-busy="true" aria-label="Se încarcă">
    ${Array.from({ length: cards }, () => `
      <div class="card sk-card">
        <div class="sk sk-line" style="width:45%"></div>
        <div class="sk sk-line" style="width:70%;height:10px"></div>
        <div class="sk sk-line" style="width:30%;height:22px;margin-top:14px"></div>
      </div>`).join('')}
  </div>`;
}

/**
 * Mini-grafic (sparkline) al prețului minim pe zile.
 * points: [{date, price}] sortate după dată.
 */
export function sparkline(points, { width = 84, height = 30, threshold = null } = {}) {
  if (!points || points.length < 2) return '';
  const prices = points.map((p) => p.price);
  const lo = Math.min(...prices, threshold ?? Infinity);
  const hi = Math.max(...prices, threshold ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i) => 2 + (i / (points.length - 1)) * (width - 4);
  const y = (v) => 3 + (1 - (v - lo) / span) * (height - 6);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join('');
  const last = points[points.length - 1];
  const under = threshold !== null && last.price <= threshold;
  return `<svg class="spark ${under ? 'is-under' : ''}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    ${threshold !== null ? `<line x1="0" x2="${width}" y1="${y(threshold)}" y2="${y(threshold)}" class="spark-th"/>` : ''}
    <path d="${d}" class="spark-line" pathLength="1"/>
    <circle cx="${x(points.length - 1)}" cy="${y(last.price)}" r="2.6" class="spark-dot"/>
  </svg>`;
}

/**
 * Prețul minim pe zi, pe toată alerta (minimul dintre combinațiile încă valabile).
 * Întoarce [{date, price}] sortat.
 */
export function overallMinSeries(history, activeKeys, currency) {
  const byDate = {};
  for (const key of activeKeys) {
    for (const p of history?.series?.[key] || []) {
      if ((p.currency || currency) !== currency) continue;
      byDate[p.date] = Math.min(byDate[p.date] ?? Infinity, p.price);
    }
  }
  return Object.keys(byDate).sort().map((date) => ({ date, price: byDate[date] }));
}

/** Comutator (switch) accesibil, bazat pe checkbox. */
export function toggle(id, checked, label, hint = '') {
  return `<label class="row row-toggle" for="${id}">
    <span class="row-main"><span class="row-title">${h(label)}</span>${hint ? `<span class="row-sub">${h(hint)}</span>` : ''}</span>
    <input type="checkbox" role="switch" id="${id}" class="switch" ${checked ? 'checked' : ''}>
  </label>`;
}

/** Buton +/− pentru numere mici (adulți, bagaje). */
export function stepper(id, value, min, max, label, hint = '') {
  return `<div class="row">
    <span class="row-main"><span class="row-title">${h(label)}</span>${hint ? `<span class="row-sub">${h(hint)}</span>` : ''}</span>
    <div class="stepper" data-stepper="${id}" data-min="${min}" data-max="${max}">
      <button type="button" data-step="-1" aria-label="Scade">${icon('minus', 16)}</button>
      <output id="${id}" aria-live="polite">${value}</output>
      <button type="button" data-step="1" aria-label="Crește">${icon('plus', 16)}</button>
    </div>
  </div>`;
}
