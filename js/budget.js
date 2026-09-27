// Alerte active, combinații și estimarea bugetului de căutări.
// ATENȚIE: este aceeași logică ca în scraper/alerts.py. Dacă schimbi una, schimbă și cealaltă.

import { addDays } from './util.js';

/** Alerta este pornită și ziua `day` e în perioada de monitorizare? */
export function isMonitoringOn(alert, day) {
  if (alert.active === false) return false;
  if (alert.monitor_start && day < alert.monitor_start) return false;
  if (alert.monitor_end && day > alert.monitor_end) return false;
  return true;
}

/** Alertă/căutare „doar dus” (fără întoarcere). Implicit: dus-întors. */
export function isOneWay(alert) {
  return alert.trip_type === 'one_way';
}

/** Cheia unei combinații în istoric: '2026-11-12_2026-11-16' sau '2026-11-12' (doar dus). */
export function comboKey(c) {
  return c.return_date ? `${c.outbound_date}_${c.return_date}` : c.outbound_date;
}

/**
 * Toate combinațiile de căutat. Dacă `day` e dat, doar plecările care nu au trecut.
 * Dus-întors: {date: '2026-11-12', nights: [4, 5]} -> 12.11→16.11 și 12.11→17.11
 * Doar dus: fiecare dată de plecare este o combinație.
 */
export function combinations(alert, day = null) {
  const out = [];
  const seen = new Set();
  const oneWay = isOneWay(alert);
  for (const dep of alert.departures || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dep.date || '')) continue;
    if (day && dep.date < day) continue;
    if (oneWay) {
      if (!seen.has(dep.date)) {
        seen.add(dep.date);
        out.push({ outbound_date: dep.date, return_date: null, nights: null });
      }
      continue;
    }
    for (const n of dep.nights || []) {
      const nights = parseInt(n, 10);
      if (!Number.isFinite(nights) || nights < 0) continue;
      const ret = addDays(dep.date, nights);
      const key = dep.date + '_' + ret;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ outbound_date: dep.date, return_date: ret, nights });
    }
  }
  return out.sort((a, b) => comboKey(a).localeCompare(comboKey(b)));
}

export function activeCombinations(alert, day) {
  return isMonitoringOn(alert, day) ? combinations(alert, day) : [];
}

export function isActive(alert, day) {
  return activeCombinations(alert, day).length > 0;
}

/** Starea alertei: {key, label, cls} pentru eticheta afișată. */
export function alertStatus(alert, day) {
  if (alert.active === false) return { key: 'paused', label: 'Oprită', cls: '' };
  if (alert.monitor_start && day < alert.monitor_start) return { key: 'scheduled', label: 'Programată', cls: 'info' };
  if (isActive(alert, day)) return { key: 'active', label: 'Activă', cls: 'info' };
  return { key: 'expired', label: 'Expirată', cls: '' };
}

/**
 * Estimarea consumului:
 *  perDay   = căutări azi (1 / combinație activă)
 *  perMonth = suma pe următoarele 30 de zile (alertele expiră, plecările trec)
 *  extraMax = maxim căutări extra pentru detaliile de întoarcere (doar sub prag)
 */
export function estimateBudget(alerts, day, days = 30) {
  const perDay = alerts.reduce((s, a) => s + activeCombinations(a, day).length, 0);
  let perMonth = 0;
  let extraMax = 0; // doar dus-întors are căutare separată pentru întoarcere
  for (let i = 0; i < days; i++) {
    const d = addDays(day, i);
    perMonth += alerts.reduce((s, a) => s + activeCombinations(a, d).length, 0);
    extraMax += alerts.reduce((s, a) => s + (isOneWay(a) ? 0 : activeCombinations(a, d).length), 0);
  }
  return { perDay, perMonth, extraMax };
}
