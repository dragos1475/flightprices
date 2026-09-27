// Vremea la destinație pentru datele călătoriei (Open-Meteo, gratuit, fără cheie):
//  - dacă plecarea e în următoarele ~15 zile: prognoza reală
//  - altfel: cum a fost vremea în aceleași zile în ultimii 3 ani (istoric)

import { addDays, store, todayRO } from './util.js';

const CACHE_PREFIX = 'zboruri.weather.';

/** Coduri WMO -> emoji + descriere. */
export function weatherIcon(code) {
  if (code === null || code === undefined) return { icon: '🌤️', text: '' };
  if (code === 0) return { icon: '☀️', text: 'senin' };
  if (code <= 2) return { icon: '🌤️', text: 'parțial însorit' };
  if (code === 3) return { icon: '☁️', text: 'înnorat' };
  if (code <= 48) return { icon: '🌫️', text: 'ceață' };
  if (code <= 57) return { icon: '🌦️', text: 'burniță' };
  if (code <= 67) return { icon: '🌧️', text: 'ploaie' };
  if (code <= 77) return { icon: '❄️', text: 'ninsoare' };
  if (code <= 82) return { icon: '🌧️', text: 'averse' };
  if (code <= 86) return { icon: '🌨️', text: 'averse de zăpadă' };
  return { icon: '⛈️', text: 'furtună' };
}

const shiftYear = (iso, years) => `${Number(iso.slice(0, 4)) - years}${iso.slice(4)}`.replace(/-02-29$/, '-02-28');
const mostCommon = (arr) => {
  const counts = {};
  arr.forEach((v) => { if (v !== null) counts[v] = (counts[v] || 0) + 1; });
  return Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? NaN);
};
const avg = (arr) => {
  const v = arr.filter((x) => typeof x === 'number');
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

/**
 * place: {lat, lon}; start/end: 'AAAA-LL-ZZ'.
 * Întoarce {kind: 'forecast'|'history', max, min, rainyDays, days, code, daily: [...]} sau null.
 */
export async function tripWeather(place, start, end) {
  if (!place) return null;
  const lastDay = end && end > start ? end : addDays(start, 4);
  const today = todayRO();
  const isForecast = lastDay <= addDays(today, 15) && start >= today;
  // prognoza se schimbă zilnic; istoricul nu
  const key = `${CACHE_PREFIX}${place.lat.toFixed(2)},${place.lon.toFixed(2)}|${start}|${lastDay}${isForecast ? `|${today}` : ''}`;
  const cached = store.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch { /* ignorăm */ }
  }

  let result = null;
  try {
    if (isForecast) {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}`
        + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`
        + `&start_date=${start}&end_date=${lastDay}`;
      const d = (await (await fetch(url)).json()).daily;
      if (d?.time?.length) {
        result = {
          kind: 'forecast',
          max: avg(d.temperature_2m_max),
          min: avg(d.temperature_2m_min),
          code: mostCommon(d.weather_code),
          days: d.time.length,
          rainyDays: d.precipitation_probability_max.filter((p) => p >= 50).length,
          daily: d.time.map((t, i) => ({
            date: t, max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], code: d.weather_code[i],
          })),
        };
      }
    } else {
      // aceleași zile din ultimii 3 ani
      const years = await Promise.all([1, 2, 3].map(async (y) => {
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${place.lat}&longitude=${place.lon}`
          + `&start_date=${shiftYear(start, y)}&end_date=${shiftYear(lastDay, y)}`
          + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto';
        const res = await fetch(url);
        return res.ok ? (await res.json()).daily : null;
      }));
      const ok = years.filter((d) => d?.time?.length);
      if (ok.length) {
        const all = (k) => ok.flatMap((d) => d[k]);
        const days = ok[0].time.length;
        const rainy = all('precipitation_sum').filter((p) => p >= 1).length / ok.length;
        result = {
          kind: 'history',
          max: avg(all('temperature_2m_max')),
          min: avg(all('temperature_2m_min')),
          code: mostCommon(all('weather_code')),
          days,
          rainyDays: Math.round(rainy),
          years: ok.length,
        };
      }
    }
  } catch {
    return null; // fără internet sau serviciu indisponibil
  }
  if (result) store.set(key, JSON.stringify(result));
  return result;
}
