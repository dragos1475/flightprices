// Afișarea prețurilor în EUR sau RON (conversie cu cursul BCE, prin frankfurter.dev – gratuit, fără cheie).
// Prețurile salvate rămân în moneda alertei; convertim doar la afișare.

import { store, todayRO } from './util.js';

const PREF_KEY = 'zboruri.display_currency'; // '' = moneda originală, 'EUR' sau 'RON'
const RATE_KEY = 'zboruri.eur_ron';

export function displayCurrency() {
  return store.get(PREF_KEY) || '';
}
export function setDisplayCurrency(cur) {
  store.set(PREF_KEY, cur || '');
}

/** Cursul EUR->RON din memorie: {rate, date} sau null. */
export function cachedRate() {
  try {
    return JSON.parse(store.get(RATE_KEY) || 'null');
  } catch {
    return null;
  }
}

/** Actualizează cursul (o dată pe zi). Întoarce {rate, date} sau cursul vechi. */
export async function refreshRate() {
  const cached = cachedRate();
  if (cached && cached.checked === todayRO()) return cached;
  try {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR&symbols=RON');
    const d = await res.json();
    if (d?.rates?.RON) {
      const fresh = { rate: d.rates.RON, date: d.date, checked: todayRO() };
      store.set(RATE_KEY, JSON.stringify(fresh));
      return fresh;
    }
  } catch { /* fără internet: folosim cursul vechi */ }
  return cached;
}

/** Factorul de conversie între două monede (null dacă nu avem curs). */
function factor(from, to) {
  if (!from || !to || from === to) return 1;
  const r = cachedRate()?.rate;
  if (!r) return null;
  if (from === 'EUR' && to === 'RON') return r;
  if (from === 'RON' && to === 'EUR') return 1 / r;
  return null;
}

const conv = (v, f) => (typeof v === 'number' ? Math.round(v * f) : v);

/**
 * Pregătește datele pentru afișare în moneda aleasă.
 * Întoarce {alert, results, history, currency, converted, rate}; dacă nu se poate converti, datele rămân neschimbate.
 */
export function forDisplay(alert, results, history) {
  const from = results?.currency || alert?.currency || 'EUR';
  const want = displayCurrency() || from;
  const f = factor(from, want);
  if (f === null || f === 1) return { alert, results, history, currency: from, converted: false };

  const flight = (fl) => (fl ? { ...fl, price: conv(fl.price, f) } : fl);
  const outResults = results && {
    ...results,
    currency: want,
    max_price: conv(results.max_price, f),
    lowest_price: conv(results.lowest_price, f),
    combinations: (results.combinations || []).map((c) => ({
      ...c,
      lowest_price: conv(c.lowest_price, f),
      flights: (c.flights || []).map(flight),
      return_flight: flight(c.return_flight),
      price_insights: c.price_insights && {
        ...c.price_insights,
        lowest_price: conv(c.price_insights.lowest_price, f),
        typical_price_range: (c.price_insights.typical_price_range || []).map((v) => conv(v, f)),
      },
    })),
  };
  const outHistory = history && {
    ...history,
    series: Object.fromEntries(Object.entries(history.series || {}).map(([k, pts]) => [k, pts.map((p) => (
      (p.currency || from) === from ? { ...p, price: conv(p.price, f), currency: want } : p))])),
  };
  const outAlert = alert && { ...alert, currency: want, max_price: conv(Number(alert.max_price), f) };
  return { alert: outAlert, results: outResults, history: outHistory, currency: want, converted: true, rate: cachedRate() };
}
