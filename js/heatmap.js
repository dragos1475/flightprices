// Calendarul de prețuri: rânduri = zilele de plecare, coloane = numărul de nopți.
// Culoarea: o singură nuanță; cu cât e mai ieftin, cu atât pătratul e mai intens.
// Identitatea nu depinde doar de culoare: fiecare pătrat are și prețul scris, iar cel mai ieftin are ★.

import { h, money, dayDate } from './util.js';

/**
 * combos: combinațiile (cu lowest_price); maxPrice: pragul (0 = fără); onPick(combo) la atingere.
 */
export function renderHeatmap(container, { combos, maxPrice = 0, currency = 'EUR', onPick }) {
  const priced = combos.filter((c) => c.lowest_price !== null && c.lowest_price !== undefined);
  if (priced.length < 2) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const oneWay = combos.every((c) => !c.return_date);
  const dates = [...new Set(combos.map((c) => c.outbound_date))].sort();
  const nights = oneWay ? [null] : [...new Set(combos.map((c) => c.nights))].sort((a, b) => a - b);
  const cell = (d, n) => combos.find((c) => c.outbound_date === d && (oneWay || c.nights === n));

  const prices = priced.map((c) => c.lowest_price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  // intensitate 18%..92% (mai ieftin = mai intens)
  const strength = (p) => (hi === lo ? 92 : Math.round(92 - ((p - lo) / (hi - lo)) * 74));

  container.innerHTML = `
    <div class="heat" style="--cols:${nights.length}">
      <div class="heat-corner">${oneWay ? 'Plecare' : 'Plecare \\ nopți'}</div>
      ${nights.map((n) => `<div class="heat-col">${n === null ? 'doar dus' : `${n} ${n === 1 ? 'noapte' : 'nopți'}`}</div>`).join('')}
      ${dates.map((d) => `
        <div class="heat-row">${dayDate(d)}</div>
        ${nights.map((n) => {
          const c = cell(d, n);
          if (!c || c.lowest_price === null || c.lowest_price === undefined) {
            return `<div class="heat-cell heat-none" aria-label="fără date">—</div>`;
          }
          const s = strength(c.lowest_price);
          const under = maxPrice > 0 && c.lowest_price <= maxPrice;
          const best = c.lowest_price === lo;
          return `<button type="button" class="heat-cell ${s > 55 ? 'dark' : ''} ${best ? 'best' : ''}" style="--s:${s}%"
            data-key="${h(c.outbound_date)}_${h(c.return_date || '')}"
            aria-label="${dayDate(d)}${n !== null ? `, ${n} nopți` : ''}: ${money(c.lowest_price, currency)}${under ? ', sub prag' : ''}${best ? ', cel mai ieftin' : ''}">
            ${best ? '<i class="heat-star">★</i>' : ''}${money(c.lowest_price)}${under ? '<i class="heat-ok">✓</i>' : ''}
          </button>`;
        }).join('')}`).join('')}
    </div>
    <div class="heat-legend">
      <span>mai ieftin</span><i class="heat-scale"></i><span>mai scump</span>
      <span class="muted">· ${currency}${maxPrice > 0 ? ' · ✓ sub prag' : ''} · ★ cel mai ieftin</span>
    </div>`;

  container.querySelectorAll('.heat-cell[data-key]').forEach((b) => b.addEventListener('click', () => {
    const [o, r] = b.dataset.key.split('_');
    const combo = combos.find((c) => c.outbound_date === o && (c.return_date || '') === r);
    if (combo && onPick) onPick(combo);
  }));
}
