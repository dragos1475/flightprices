// Secțiunea „Călătoria”: harta traseului (glob), distanța, cel mai scurt zbor găsit și vremea la destinație.
// Totul se încarcă după ce ecranul e deja afișat; dacă un serviciu nu răspunde, partea respectivă nu apare.

import { distanceKm, locateAirport, locateDestination } from './geo.js';
import { renderRouteMap } from './map.js';
import { addDays, duration, h, shortDate } from './util.js';
import { tripWeather, weatherIcon } from './weather.js';

export function tripSection() {
  return `<div id="trip-section">
    <div class="section-label"><span>The trip</span></div>
    <div class="card trip-card">
      <div class="trip-map"><div class="sk" style="height:180px;border-radius:14px"></div></div>
      <div class="trip-stats"></div>
      <div class="trip-weather"></div>
    </div>
  </div>`;
}

/**
 * deps: codurile de plecare; destination: {id, name, codes}; combos: combinațiile (pentru durată);
 * dates: {start, end} pentru vreme.
 */
export async function fillTrip(root, { deps, destination, combos, dates }) {
  const section = root.querySelector('#trip-section');
  if (!section) return;
  const mapBox = section.querySelector('.trip-map');
  const statsBox = section.querySelector('.trip-stats');
  const weatherBox = section.querySelector('.trip-weather');

  const [from, to] = await Promise.all([locateAirport(deps[0]), locateDestination(destination)]);
  if (!section.isConnected) return;

  // --- harta + distanța ---
  let mapOk = false;
  if (from && to) {
    mapOk = await renderRouteMap(mapBox, from, to, { from: deps[0], to: destination.codes?.[0] || '' });
  }
  if (!mapOk) mapBox.remove();

  const shortest = Math.min(...combos.flatMap((c) => (c.flights || []).map((f) => f.total_duration || Infinity)));
  const direct = combos.some((c) => (c.flights || []).some((f) => f.stops === 0));
  const stats = [];
  if (from && to) stats.push(`<div><b>${new Intl.NumberFormat('en-GB').format(Math.round(distanceKm(from, to)))} km</b><span>distance</span></div>`);
  if (Number.isFinite(shortest)) stats.push(`<div><b>${duration(shortest)}</b><span>shortest flight</span></div>`);
  if (combos.some((c) => c.flights?.length)) stats.push(`<div><b>${direct ? 'Yes' : 'No'}</b><span>direct flights</span></div>`);
  statsBox.innerHTML = stats.join('');

  // --- vremea ---
  if (to && dates?.start) {
    const w = await tripWeather(to, dates.start, dates.end);
    if (w && section.isConnected) {
      const wi = weatherIcon(w.code);
      const range = `${shortDate(dates.start)} – ${shortDate(dates.end || addDays(dates.start, 4))}`;
      weatherBox.innerHTML = `
        <div class="weather">
          <div class="weather-icon" aria-hidden="true">${wi.icon}</div>
          <div class="row-main">
            <b>${h(to.name)}, ${range}</b>
            <span class="row-sub">${w.kind === 'forecast' ? 'Forecast' : `Usually on these days (average of the last ${w.years} years)`}${wi.text ? ` · ${wi.text}` : ''}</span>
          </div>
          <div class="weather-temp"><b>${Math.round(w.max)}°</b><span>${Math.round(w.min)}°</span></div>
        </div>
        <div class="weather-note">${w.kind === 'forecast'
          ? `Rain likely on ${w.rainyDays} of ${w.days} days`
          : `Rainy days: ~${w.rainyDays} of ${w.days}`}</div>
        ${w.daily ? `<div class="weather-days">${w.daily.map((d) => `
          <div><span>${shortDate(d.date)}</span><i>${weatherIcon(d.code).icon}</i><b>${Math.round(d.max)}°</b><small>${Math.round(d.min)}°</small></div>`).join('')}</div>` : ''}`;
    }
  }

  if (!mapOk && !statsBox.innerHTML && !weatherBox.innerHTML) section.remove();
}

/** Datele pentru vreme: combinația cea mai ieftină, altfel prima plecare. */
export function tripDates(best, departures = []) {
  if (best) return { start: best.outbound_date, end: best.return_date || null };
  const first = [...departures].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!first) return null;
  const n = (first.nights || [])[0];
  return { start: first.date, end: n ? addDays(first.date, Number(n)) : null };
}
