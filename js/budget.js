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

/** Orele implicite (ora României) pentru 1, 2, 3 sau 4 căutări pe zi. */
export const DEFAULT_HOURS = { 1: [8], 2: [8, 20], 3: [8, 14, 20], 4: [7, 12, 17, 22] };

/** Orele programate ale alertei, sortate (ex. [8, 20]). Implicit: [8]. (La fel ca în scraper/alerts.py.) */
export function searchHours(alert) {
  const hours = [...new Set((alert.search_hours || []).map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23))]
    .sort((a, b) => a - b).slice(0, 4);
  return hours.length ? hours : [8];
}

/** De câte ori pe zi se caută alerta. */
export function searchesPerDay(alert) {
  return searchHours(alert).length;
}

/** '08:00 · 20:00' */
export function hoursLabel(alert) {
  return searchHours(alert).map((h) => `${String(h).padStart(2, '0')}:00`).join(' · ');
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
  if (alert.active === false) return { key: 'paused', label: 'Paused', cls: '' };
  if (alert.monitor_start && day < alert.monitor_start) return { key: 'scheduled', label: 'Scheduled', cls: 'info' };
  if (isActive(alert, day)) return { key: 'active', label: 'Active', cls: 'info' };
  return { key: 'expired', label: 'Expired', cls: '' };
}

/**
 * Estimarea consumului:
 *  perDay   = căutări azi (1 / combinație activă, × de câte ori pe zi)
 *  perMonth = suma pe următoarele 30 de zile (alertele expiră, plecările trec)
 *  extraMax = maxim căutări extra pentru detaliile de întoarcere (doar sub prag)
 */
export function estimateBudget(alerts, day, days = 30) {
  const count = (a, d) => activeCombinations(a, d).length * searchesPerDay(a);
  const perDay = alerts.reduce((s, a) => s + count(a, day), 0);
  let perMonth = 0;
  let extraMax = 0; // doar dus-întors are căutare separată pentru întoarcere
  for (let i = 0; i < days; i++) {
    const d = addDays(day, i);
    perMonth += alerts.reduce((s, a) => s + count(a, d), 0);
    extraMax += alerts.reduce((s, a) => s + (isOneWay(a) ? 0 : count(a, d)), 0);
  }
  return { perDay, perMonth, extraMax };
}

// ---------------------------------------------------------------------------
// Programul căutărilor: ultima căutare, următoarea și dacă GitHub a întârziat.
// Aceeași regulă ca plan_searches() din scraper/main.py: o combinație e „la zi” dacă a fost căutată azi
// după ultima oră programată care a trecut (ex. la 15:xx, pentru [8, 20], trebuie căutată azi după 08:00).
// ---------------------------------------------------------------------------

/** Ora curentă în România (0–23). */
export function hourRO(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', hourCycle: 'h23' }).format(date));
}

/** Data și ora din România pentru un moment ISO: {day: 'AAAA-LL-ZZ', hour}. */
function roParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return { day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(d), hour: hourRO(d) };
}

/** Ultima oră programată care a trecut azi (null dacă n-a venit încă prima). */
export function currentSlot(alert, hour) {
  const past = searchHours(alert).filter((h) => h <= hour);
  return past.length ? Math.max(...past) : null;
}

/** Cea mai recentă căutare a alertei (ISO) sau null. */
export function lastSearchedAt(results) {
  const times = (results?.combinations || []).map((c) => c.searched_at).filter(Boolean).sort();
  return times.length ? times[times.length - 1] : null;
}

/**
 * Căutarea programată a întârziat? (a trecut ora programată și combinațiile active nu au fost căutate după ea)
 * day = 'AAAA-LL-ZZ' (azi, ora României), hour = ora curentă în România.
 */
export function isOverdue(alert, results, day, hour) {
  const slot = currentSlot(alert, hour);
  if (slot === null) return false;
  const combos = activeCombinations(alert, day);
  if (!combos.length) return false;
  const byKey = new Map((results?.combinations || []).map((c) => [comboKey(c), c]));
  return combos.some((c) => {
    const old = byKey.get(comboKey(c));
    const at = old?.searched_at && roParts(old.searched_at);
    return !at || at.day !== day || at.hour < slot || !['ok', 'no_results'].includes(old.status);
  });
}

/**
 * Următoarea căutare programată: {when: 'now' | 'today' | 'tomorrow' | 'later', hour, day} sau null (alertă oprită/expirată).
 * 'now' = ora a trecut, dar GitHub încă nu a căutat.
 */
export function nextSearch(alert, results, day, hour) {
  const hours = searchHours(alert);
  if (alert.active === false) return null;
  if (alert.monitor_start && day < alert.monitor_start) return { when: 'later', hour: hours[0], day: alert.monitor_start };
  if (!isActive(alert, day)) return null;
  if (isOverdue(alert, results, day, hour)) return { when: 'now', hour: currentSlot(alert, hour), day };
  const later = hours.find((h) => h > hour);
  if (later !== undefined) return { when: 'today', hour: later, day };
  const tomorrow = addDays(day, 1);
  return isMonitoringOn(alert, tomorrow) && combinations(alert, tomorrow).length ? { when: 'tomorrow', hour: hours[0], day: tomorrow } : null;
}
