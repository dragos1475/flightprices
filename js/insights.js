// Verdictul „Cumpără acum / Mai așteaptă”, calculat din istoricul prețurilor și din datele Google.
// Este orientativ: nimeni nu poate prezice sigur prețurile.

import { money } from './util.js';

/**
 * series: [{date, price}] – prețul minim pe zi (cronologic), inclusiv azi
 * best: combinația cea mai ieftină acum (are price_insights de la Google)
 * maxPrice: pragul (0 = fără prag)
 * Întoarce {kind: 'buy'|'good'|'wait'|'watch', title, text, tags: [{label, tone}]} sau null.
 */
export function verdict({ series = [], best, maxPrice = 0, currency = 'EUR' }) {
  const cur = best?.lowest_price;
  if (cur === null || cur === undefined) return null;
  const tags = [];
  const n = series.length;
  const prev = series.slice(0, -1).map((p) => p.price);

  // minim istoric (avem nevoie de câteva zile de istoric)
  const recordLow = n >= 3 && cur <= Math.min(...prev);
  if (recordLow) tags.push({ label: `lowest in the last ${n} days`, tone: 'good' });

  // câte zile la rând a scăzut / a crescut
  let down = 0;
  let up = 0;
  for (let i = n - 1; i > 0 && series[i].price < series[i - 1].price; i--) down++;
  for (let i = n - 1; i > 0 && series[i].price > series[i - 1].price; i--) up++;
  if (down >= 2) tags.push({ label: `falling for ${down} days`, tone: 'good' });
  if (up >= 2) tags.push({ label: `rising for ${up} days`, tone: 'bad' });

  // față de media ultimelor 7 zile
  const recent = prev.slice(-7);
  let pct = 0;
  if (recent.length >= 3) {
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    pct = Math.round(((cur - avg) / avg) * 100);
    if (Math.abs(pct) >= 5) tags.push({ label: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% vs 7-day average`, tone: pct < 0 ? 'good' : 'bad' });
  }

  // ce spune Google
  const level = String(best.price_insights?.price_level || '').toLowerCase();
  const range = best.price_insights?.typical_price_range;
  if (level === 'low') tags.push({ label: 'Google: low price', tone: 'good' });
  if (level === 'high') tags.push({ label: 'Google: high price', tone: 'bad' });
  if (level === 'typical') tags.push({ label: 'Google: typical price', tone: '' });
  const belowRange = Array.isArray(range) && range.length && cur < range[0];
  if (belowRange) tags.push({ label: `sub intervalul tipic (${range.map((v) => money(v)).join('–')})`, tone: 'good' });

  const under = maxPrice > 0 && cur <= maxPrice;
  const strong = recordLow || level === 'low' || belowRange || pct <= -8;

  if (under && (strong || up >= 2)) {
    return {
      kind: 'buy',
      title: 'Buy now',
      text: up >= 2 ? 'You are under your target and the price has started to rise.' : 'You are under your target and the price is very good.',
      tags,
    };
  }
  if (under) return { kind: 'good', title: 'Good price', text: `Under your target of ${money(maxPrice, currency)}.`, tags };
  if (down >= 2) return { kind: 'wait', title: 'Wait', text: 'The price has been falling for several days.', tags };
  if (level === 'high' || pct >= 8) return { kind: 'wait', title: 'Wait', text: 'The price is above the usual level.', tags };
  if (strong) return { kind: 'good', title: 'Good price', text: 'Good compared to usual, but still above your target.', tags };
  return { kind: 'watch', title: 'Watch', text: 'Nothing special for now.', tags };
}

export const VERDICT_STYLE = {
  buy: { cls: 'good', icon: 'check' },
  good: { cls: 'good', icon: 'check' },
  wait: { cls: 'warn', icon: 'clock' },
  watch: { cls: 'info', icon: 'info' },
};
