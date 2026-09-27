// Localizarea orașelor (coordonate) cu Open-Meteo Geocoding – gratuit, fără cheie.
// Rezultatele se păstrează pe telefon, ca să nu le cerem de fiecare dată.

import { airportIso, destinationIso } from './flags.js';
import { state } from './state.js';
import { store } from './util.js';

const CACHE_PREFIX = 'zboruri.geo.';

/**
 * Variante de nume de căutat pentru o destinație, de la cea mai precisă la cea mai generală.
 * 'Roma Fiumicino' -> ['Roma Fiumicino', 'Roma']; 'Bali (Denpasar)' -> ['Bali', 'Denpasar'];
 * 'Roma (toate aeroporturile)' -> ['Roma'].
 */
export function nameCandidates(name) {
  const clean = String(name || '').replace(/\(toate[^)]*\)/i, '').trim();
  const paren = (clean.match(/\(([^)]+)\)/) || [])[1];
  const base = clean.replace(/\([^)]*\)/g, '').trim();
  const out = [base, base.split(/\s+/)[0], paren].filter(Boolean);
  return [...new Set(out)];
}

async function geocodeName(name, iso) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=ro&format=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const results = (data.results || []).filter((r) => !iso || r.country_code === iso);
  // preferăm localitățile (PPL*), apoi insulele / regiunile
  results.sort((a, b) => (String(b.feature_code).startsWith('PPL') - String(a.feature_code).startsWith('PPL'))
    || ((b.population || 0) - (a.population || 0)));
  const r = results[0];
  return r ? { name: r.name, lat: r.latitude, lon: r.longitude, iso: r.country_code } : null;
}

/** Coordonatele unui loc (după nume + țară). Întoarce {name, lat, lon, iso} sau null. */
export async function locate(name, iso) {
  const key = `${CACHE_PREFIX}${name}|${iso}`;
  try {
    const cached = store.get(key);
    if (cached) return JSON.parse(cached);
  } catch { /* cache stricat */ }
  for (const candidate of nameCandidates(name)) {
    try {
      const found = await geocodeName(candidate, iso);
      if (found) {
        store.set(key, JSON.stringify(found));
        return found;
      }
    } catch {
      return null; // fără internet: încercăm data viitoare
    }
  }
  return null;
}

/** Locul destinației unei alerte / căutări. */
export function locateDestination(dest) {
  const full = state.config?.destinations.find((d) => d.id === dest?.id);
  return locate(full?.name || dest?.name || '', destinationIso(dest));
}

/** Locul unui aeroport de plecare (după cod IATA). */
export function locateAirport(code) {
  const d = state.config?.destinations.find((x) => x.codes.length === 1 && x.codes[0] === code);
  const a = state.config?.airports.find((x) => x.code === code);
  return locate(d?.name || a?.name || code, airportIso(code));
}

/** Distanța în km între două puncte (pe suprafața Pământului). */
export function distanceKm(a, b) {
  const R = 6371;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
