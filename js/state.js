// Datele încărcate de aplicație (configurări, alerte, rezultate) și funcții de interpretare.

import { loadJSON } from './data.js';

export const state = {
  config: null,   // {airports, airlines, destinations, settings}
  alerts: null,   // lista alertelor din data/alerts.json
  status: null,   // data/status.json (ultima rulare)
  results: {},    // {alert_id: data/results/<id>.json}
  history: {},    // {alert_id: data/history/<id>.json}
};

/** Configurările (se încarcă o singură dată). */
export async function ensureConfig() {
  if (state.config) return state.config;
  const [airports, airlines, destinations, custom, settings] = await Promise.all([
    loadJSON('config/airports.json'),
    loadJSON('config/airlines.json'),
    loadJSON('config/destinations.json'),
    loadJSON('config/destinations_custom.json').catch(() => null),
    loadJSON('config/settings.json'),
  ]);
  const customList = (custom?.destinations || []).map((d) => ({ ...d, region: d.region || 'Adăugate de mine', custom: true }));
  state.config = {
    airports: airports?.airports || [],
    airlines: airlines?.airlines || [],
    destinations: [...customList, ...(destinations?.destinations || [])],
    settings: settings || {},
  };
  return state.config;
}

export async function ensureAlerts(force = false) {
  if (state.alerts && !force) return state.alerts;
  const doc = await loadJSON('data/alerts.json');
  state.alerts = doc?.alerts || [];
  return state.alerts;
}

export async function loadStatus() {
  try {
    state.status = await loadJSON('data/status.json');
  } catch {
    state.status = null;
  }
  return state.status;
}

export async function loadResults(id) {
  try {
    state.results[id] = await loadJSON(`data/results/${id}.json`);
  } catch {
    state.results[id] = null;
  }
  return state.results[id];
}

export async function loadHistory(id) {
  try {
    state.history[id] = await loadJSON(`data/history/${id}.json`);
  } catch {
    state.history[id] = null;
  }
  return state.history[id];
}

/** Numele companiilor pentru o listă de coduri IATA (grupurile complete apar cu numele lor). */
export function airlineNames(codes) {
  if (!codes || !codes.length) return ['Oricare companie'];
  const left = new Set(codes);
  const names = [];
  for (const a of state.config?.airlines || []) {
    if (a.codes.every((c) => left.has(c))) {
      names.push(a.name);
      a.codes.forEach((c) => left.delete(c));
    }
  }
  return [...names, ...left];
}

/** Nume aeroport după cod (lista de plecări, apoi lista de destinații). */
export function airportName(code) {
  return state.config?.airports.find((a) => a.code === code)?.name
    || state.config?.destinations.find((d) => d.codes.length === 1 && d.codes[0] === code)?.name
    || code;
}

/**
 * Rezumatul rezultatelor unei alerte, pentru azi:
 * doar combinațiile cu plecarea încă în viitor și cu moneda curentă a alertei.
 */
export function summarize(alert, results, today) {
  if (!results) return { combos: [], lowest: null, under: false, stale: false, best: null };
  const stale = results.currency && results.currency !== (alert.currency || 'EUR');
  const combos = (results.combinations || []).filter((c) => c.outbound_date >= today);
  const priced = combos.filter((c) => c.lowest_price !== null && c.lowest_price !== undefined);
  const best = priced.reduce((b, c) => (!b || c.lowest_price < b.lowest_price ? c : b), null);
  const lowest = best ? best.lowest_price : null;
  const under = !stale && lowest !== null && Number(alert.max_price) > 0 && lowest <= Number(alert.max_price);
  return { combos, lowest, under, stale, best };
}

/** Nivelul prețului de la Google, în română. */
export function priceLevel(level) {
  const map = {
    low: { label: 'scăzut', cls: 'good' },
    typical: { label: 'obișnuit', cls: '' },
    high: { label: 'ridicat', cls: 'bad' },
  };
  if (!level) return null;
  return map[String(level).toLowerCase()] || { label: level, cls: '' };
}
