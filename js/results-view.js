// Afișarea rezultatelor (comună pentru alerte și căutări rapide):
// bilete de zbor, lista combinațiilor și lista tuturor zborurilor cu filtre și sortare.

import { comboKey, hourRO, lastSearchedAt, nextSearch } from './budget.js';
import { airportFlag, countryTint, destFlag, destinationIso } from './flags.js';
import { icon } from './icons.js';
import { VERDICT_STYLE } from './insights.js';
import { locateDestination, nameCandidates } from './geo.js';
import { cityPhoto, loadImage } from './media.js';
import { bindPriceChecks, priceSlot } from './price-check.js';
import { routeArc, skyPhase } from './motion.js';
import { airportName, priceLevel, state } from './state.js';
import { dateTime, dayDate, duration, fold, h, hour, money, share, shortDate, shortDateTime, todayRO } from './util.js';

/**
 * Textul unei oferte, pentru partajare.
 * ctx: {cur, route: 'OTP → Roma'}; combo: combinația; flight: zborul (opțional, altfel cel mai ieftin).
 */
export function dealText(ctx, combo, flight = combo.flights?.[0]) {
  const lines = [`✈️ ${ctx.route}: ${money(combo.lowest_price, ctx.cur)} ${combo.return_date ? 'return' : 'one way'}`,
    `📅 ${comboDates(combo)} · ${comboNights(combo)}`];
  if (flight) {
    lines.push(`🛫 ${flight.airlines.join('/')} ${flight.flight_numbers.join(', ')} · ${hour(flight.departure_time)}–${hour(flight.arrival_time)} · ${flight.stops ? `${flight.stops} ${flight.stops === 1 ? 'stop' : 'stops'}` : 'direct'}`);
  }
  if (combo.return_flight) {
    const r = combo.return_flight;
    lines.push(`🛬 ${r.airlines.join('/')} ${r.flight_numbers.join(', ')} · ${hour(r.departure_time)}–${hour(r.arrival_time)}`);
  }
  return lines.join('\n');
}

export function shareCombo(ctx, combo) {
  return share({ title: `Flight ${ctx.route}`, text: dealText(ctx, combo), url: combo.google_flights_url || '' });
}

/** Preferințe de afișare (păstrate cât timp aplicația e deschisă). */
export function newView() {
  return { sort: 'price', onlyUnder: false, comboSort: 'date', flightsShown: 25, route: null, airline: null, airlineAll: false };
}

/** Datele unei combinații: 'Thu 12 Nov → Mon 16 Nov' sau 'Thu 12 Nov' (doar dus). */
export function comboDates(c, arrow = ' → ') {
  return c.return_date ? `${dayDate(c.outbound_date)}${arrow}${dayDate(c.return_date)}` : dayDate(c.outbound_date);
}

/** '4 nights' sau 'one way'. */
export function comboNights(c) {
  if (!c.return_date) return 'one way';
  return `${c.nights} ${c.nights === 1 ? 'night' : 'nights'}`;
}

const isUnder = (price, maxPrice) => maxPrice > 0 && price !== null && price !== undefined && price <= maxPrice;

/** Numele unui loc după codul IATA (din destinații sau aeroporturile de plecare). */
export function placeName(code) {
  const d = state.config?.destinations.find((x) => x.codes.length === 1 && x.codes[0] === code);
  return d?.name || airportName(code) || code;
}

/** Logo-ul unei companii (de la Google), cu inițialele ca rezervă dacă imaginea lipsește. */
function logo(url, name, size = 28) {
  const initials = String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="al-logo" style="--s:${size}px" data-initials="${h(initials)}">${url
    ? `<img src="${h(url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
}

/**
 * Logo-ul unui segment: cel trimis de Google sau, pentru rezultatele mai vechi,
 * dedus din codul companiei din numărul de zbor („LO 640” -> LO).
 */
function legLogo(l) {
  if (l?.logo) return l.logo;
  const code = String(l?.flight_number || '').split(' ')[0];
  return /^[A-Z0-9]{2}$/.test(code) ? `https://www.gstatic.com/flights/airline_logos/70px/${code}.png` : '';
}

/** Logo-urile companiilor unui zbor (maxim 2, suprapuse). */
function flightLogos(f) {
  const seen = new Map();
  (f.legs || []).forEach((l) => { if (l.airline && !seen.has(l.airline)) seen.set(l.airline, legLogo(l)); });
  if (!seen.size && f.airlines?.length) seen.set(f.airlines[0], f.logo || '');
  return `<span class="al-logos">${[...seen].slice(0, 2).map(([n, u]) => logo(u, n)).join('')}</span>`;
}

/** Detaliile unui zbor: segmentele, escalele, avionul, spațiul pentru picioare, facilitățile. */
function flightDetails(f) {
  const legs = f.legs || [];
  if (!legs.length) return '';
  const parts = [];
  legs.forEach((l, i) => {
    const extras = [l.airplane, ...(l.extensions || []).slice(0, 3)].filter(Boolean);
    parts.push(`<div class="seg-leg">
      <div class="seg-time"><b>${hour(l.departure_time)}</b><span>${h(l.from)}</span></div>
      <div class="seg-body">
        <div class="seg-place">${h(l.from_name || placeName(l.from))}</div>
        <div class="seg-flight">${logo(legLogo(l), l.airline, 18)} ${h(l.airline)} · ${h(l.flight_number)} · ${duration(l.duration)}</div>
        ${extras.length ? `<div class="seg-extras">${extras.map((x) => `<span>${h(x)}</span>`).join('')}</div>` : ''}
        ${l.often_delayed ? `<div class="seg-warn">${icon('clock', 12)} Often delayed by 30+ minutes</div>` : ''}
        <div class="seg-place arr">${h(l.to_name || placeName(l.to))}</div>
      </div>
      <div class="seg-time end"><b>${hour(l.arrival_time)}</b><span>${h(l.to)}</span></div>
    </div>`);
    const lay = f.layovers?.[i];
    if (lay && i < legs.length - 1) {
      parts.push(`<div class="seg-layover ${lay.overnight ? 'night' : ''}">
        ${icon('clock', 13)} ${duration(lay.duration)} layover in ${h(lay.name || placeName(lay.airport))} (${h(lay.airport)})
        ${lay.overnight ? '<b>· overnight</b>' : ''}</div>`);
    }
  });
  const co2 = typeof f.carbon_diff === 'number'
    ? `<span class="badge ${f.carbon_diff <= 0 ? 'good' : ''}">CO₂ ${f.carbon_diff > 0 ? '+' : ''}${f.carbon_diff}% vs typical</span>` : '';
  return `<details class="ticket-more"><summary>Flight details ${icon('chevronDown', 14)}</summary>
    <div class="seg-list">${parts.join('')}</div>
    ${co2 ? `<div class="seg-foot">${co2}</div>` : ''}
  </details>`;
}

/** Un zbor, afișat ca bilet (card). */
export function ticket(f, ctx, showCombo) {
  const under = isUnder(f.price, ctx.maxPrice);
  const nextDay = f.arrival_time && f.departure_time && f.arrival_time.slice(0, 10) !== f.departure_time.slice(0, 10);
  const stops = f.stops
    ? `${f.stops} ${f.stops === 1 ? 'stop' : 'stops'}`
    : '<span class="stops-direct">direct</span>';
  const overnight = (f.layovers || []).some((l) => l.overnight);
  return `<div class="ticket">
    <div class="ticket-head">
      <div class="ticket-airline">${flightLogos(f)}<span class="ticket-names">${h(f.airlines.join(' / '))}<small>${h(f.flight_numbers.join(', '))}</small></span></div>
      <div class="ticket-price ${under ? 'under' : ''}">${money(f.price, ctx.cur)}</div>
    </div>
    <div class="ticket-times">
      <div><div class="t">${hour(f.departure_time)}</div><div class="ap">${h(f.from)}</div></div>
      <div class="ticket-line"><span>${duration(f.total_duration)} · ${stops}</span></div>
      <div class="end"><div class="t">${hour(f.arrival_time)}${nextDay ? '<sup class="small muted">+1</sup>' : ''}</div><div class="ap">${h(f.to)}</div></div>
    </div>
    <div class="ticket-foot">
      <span>${showCombo ? `${comboDates(f.combo)} · ${comboNights(f.combo)}` : ''}</span>
      <span>${f.stops ? `via ${h(f.layovers.map((l) => l.airport).join(', '))}` : ''}${overnight ? ' · 🌙 overnight' : ''}</span>
    </div>
    ${priceSlot(f, ctx)}
    ${flightDetails(f)}
  </div>`;
}

/** Secțiunile „Combinații” și „Toate zborurile”, cu filtre. ctx = {combos, maxPrice, cur, view} */
export function resultsSections(ctx) {
  const { view } = ctx;
  return `
    <div class="section-label"><span>Date combinations</span>
      <div class="seg" role="group" aria-label="Sort combinations">
        <button type="button" data-csort="date" aria-pressed="${view.comboSort === 'date'}">Date</button>
        <button type="button" data-csort="price" aria-pressed="${view.comboSort === 'price'}">Price</button>
      </div>
    </div>
    <div class="group" data-box="combos"></div>

    <div data-box="routes"></div>

    <div class="section-label"><span>All flights</span></div>
    <div class="air-tabs" data-box="airlines" role="tablist" aria-label="Airlines"></div>
    <div class="list-toolbar">
      ${ctx.maxPrice > 0 ? `<div class="seg" role="group" aria-label="Filter">
        <button type="button" data-filter="all" aria-pressed="${!view.onlyUnder}">All</button>
        <button type="button" data-filter="under" aria-pressed="${view.onlyUnder}">Under target</button>
      </div>` : '<span></span>'}
      <div class="seg" role="group" aria-label="Sort flights">
        <button type="button" data-sort="price" aria-pressed="${view.sort === 'price'}">Price</button>
        <button type="button" data-sort="time" aria-pressed="${view.sort === 'time'}">Time</button>
        <button type="button" data-sort="duration" aria-pressed="${view.sort === 'duration'}">Duration</button>
      </div>
    </div>
    <div class="group" data-box="flights"></div>
    <p class="section-note">${ctx.oneWay
    ? 'Prices are one way, total for all passengers.'
    : 'Prices are round-trip totals for all passengers. Times are for the outbound flight.'}</p>`;
}

/** Desenează listele și leagă butoanele de filtrare/sortare. */
export function bindResults(root, ctx) {
  const { view } = ctx;
  if (!(ctx.maxPrice > 0)) view.onlyUnder = false;
  const combosBox = root.querySelector('[data-box="combos"]');
  const flightsBox = root.querySelector('[data-box="flights"]');
  const routesBox = root.querySelector('[data-box="routes"]');
  const airlinesBox = root.querySelector('[data-box="airlines"]');
  const redrawCombos = () => renderCombos(combosBox, ctx);
  const redrawFlights = () => {
    renderRoutes(routesBox, ctx, redrawFlights);
    renderAirlineTabs(airlinesBox, ctx, redrawFlights);
    renderFlights(flightsBox, ctx);
  };
  redrawCombos();
  redrawFlights();
  bindPriceChecks(root); // „Preț la companie” (doar la cerere, din fiecare bilet)

  root.querySelectorAll('[data-csort]').forEach((b) => b.addEventListener('click', () => {
    view.comboSort = b.dataset.csort;
    root.querySelectorAll('[data-csort]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    redrawCombos();
  }));
  root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    view.onlyUnder = b.dataset.filter === 'under';
    view.flightsShown = 25;
    root.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    redrawFlights();
  }));
  root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    view.sort = b.dataset.sort;
    root.querySelectorAll('[data-sort]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    redrawFlights();
  }));
}

function renderCombos(box, ctx) {
  const { combos, cur, view } = ctx;
  if (!combos.length) {
    box.innerHTML = `<div class="row"><span class="row-icon">${icon('clock', 16)}</span><span class="row-main">
      <span class="row-title">No results yet</span><span class="row-sub">They appear after the first search.</span></span></div>`;
    return;
  }
  const rows = [...combos].sort((a, b) => view.comboSort === 'price'
    ? (a.lowest_price ?? Infinity) - (b.lowest_price ?? Infinity)
    : comboKey(a).localeCompare(comboKey(b)));

  box.innerHTML = rows.map((c) => {
    const under = isUnder(c.lowest_price, ctx.maxPrice);
    const lvl = priceLevel(c.price_insights?.price_level);
    const range = c.price_insights?.typical_price_range;
    const ret = c.return_flight;
    let price = `<b class="${under ? 'under' : ''}">${money(c.lowest_price, cur)}</b>`;
    if (c.status === 'error') price = `<span class="badge bad">${icon('warning')}Eroare</span>`;
    if (c.status === 'no_results') price = '<span class="small muted">no flights</span>';
    const flights = (c.flights || []).map((f) => ({ ...f, combo: c }));
    return `<details class="combo" data-combo="${h(comboKey(c))}">
      <summary>
        <div style="min-width:0">
          <div class="combo-dates">${comboDates(c, '<span class="arrow">→</span>')}</div>
          <div class="combo-sub"><span>${comboNights(c)}</span>
            ${lvl ? `<span class="badge ${lvl.cls}">${h(lvl.label)} price</span>` : ''}
            ${Array.isArray(range) && range.length ? `<span>typical ${range.map((v) => money(v)).join('–')}</span>` : ''}</div>
        </div>
        <div class="combo-price">${price}</div>
        <span class="chev">${icon('chevron', 16)}</span>
      </summary>
      <div class="combo-body">
        ${c.status === 'error' ? `<div class="banner bad">${icon('warning', 16)}<div>${h(c.error)}</div></div>` : ''}
        ${ret ? `<div class="combo-return">${icon('plane', 14)}<span><b>Return:</b> ${h(ret.airlines.join('/'))} ${h(ret.flight_numbers.join(', '))} · ${hour(ret.departure_time)}–${hour(ret.arrival_time)} · ${ret.stops ? `${ret.stops} ${ret.stops === 1 ? 'stop' : 'stops'}` : 'direct'}</span></div>` : ''}
        ${flights.length ? `<div class="group" style="box-shadow:none">${flights.slice(0, 5).map((f) => ticket(f, ctx, false)).join('')}</div>` : ''}
        ${flights.length > 5 ? `<p class="small muted" style="margin:8px 2px 0">+${flights.length - 5} flights in the full list below</p>` : ''}
        <div class="btn-row" style="margin-top:10px">
          ${c.google_flights_url ? `<a class="btn tonal sm" href="${h(c.google_flights_url)}" target="_blank" rel="noopener">Google Flights ${icon('external', 14)}</a>` : ''}
          ${c.lowest_price !== null && c.lowest_price !== undefined ? `<button type="button" class="btn sm" data-share="${h(comboKey(c))}">${icon('share', 14)} Share</button>` : ''}
        </div>
        <p class="small muted" style="margin:8px 2px 0">Searched ${dateTime(c.searched_at)}</p>
      </div>
    </details>`;
  }).join('');
  box.querySelectorAll('[data-share]').forEach((b) => b.addEventListener('click', () => {
    const combo = combos.find((c) => comboKey(c) === b.dataset.share);
    if (combo) shareCombo(ctx, combo);
  }));
}

/** Deschide o combinație din listă și o aduce în ecran (folosit de calendarul de prețuri). */
export function focusCombo(root, combo) {
  const el = root.querySelector(`details.combo[data-combo="${CSS.escape(comboKey(combo))}"]`);
  if (!el) return;
  el.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
}

/** Toate zborurile (din toate combinațiile), cu combinația atașată. */
function allFlights(ctx) {
  let rows = ctx.combos.flatMap((c) => (c.flights || []).map((f) => ({ ...f, combo: c })));
  if (ctx.view.onlyUnder) rows = rows.filter((f) => isUnder(f.price, ctx.maxPrice));
  return rows;
}
const routeOf = (f) => `${f.from}→${f.to}`;
const minPrice = (rows) => Math.min(...rows.map((f) => f.price ?? Infinity));

/** Cardurile pe rute (perechi de aeroporturi), doar dacă rezultatul are mai multe rute. */
function renderRoutes(box, ctx, redraw) {
  const rows = allFlights(ctx);
  const groups = new Map();
  rows.forEach((f) => {
    const k = routeOf(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  });
  if (groups.size < 2) {
    box.innerHTML = '';
    if (ctx.view.route && !groups.has(ctx.view.route)) ctx.view.route = null;
    return;
  }
  const routes = [...groups].map(([k, fl]) => ({
    k, fl, min: minPrice(fl), direct: fl.some((f) => !f.stops), airlines: new Set(fl.flatMap((f) => f.airlines)).size,
  })).sort((a, b) => a.min - b.min);
  const best = routes[0].min;
  box.innerHTML = `<div class="section-label"><span>Routes found</span><span class="muted" style="text-transform:none;letter-spacing:0">${routes.length} routes · one single call</span></div>
    <div class="route-tiles">
      <button type="button" class="route-tile ${!ctx.view.route ? 'active' : ''}" data-route="">
        <span class="rt-codes">All routes</span>
        <span class="rt-price">${money(best, ctx.cur)}</span>
        <span class="rt-meta">${rows.length} options</span>
      </button>
      ${routes.map((r) => {
        const [a, b] = r.k.split('→');
        return `<button type="button" class="route-tile ${ctx.view.route === r.k ? 'active' : ''}" data-route="${h(r.k)}">
          <span class="rt-codes">${h(a)} <i>→</i> ${h(b)}</span>
          <span class="rt-names">${h(placeName(a))} – ${h(placeName(b))}</span>
          <span class="rt-price ${r.min === best ? 'best' : ''}">${money(r.min, ctx.cur)}</span>
          <span class="rt-meta">${r.fl.length} options · ${r.airlines} ${r.airlines === 1 ? 'airline' : 'airlines'}${r.direct ? ' · <b>direct</b>' : ''}</span>
        </button>`;
      }).join('')}
    </div>`;
  box.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => {
    ctx.view.route = b.dataset.route || null;
    ctx.view.flightsShown = 25;
    redraw();
  }));
}

/** Numele companiilor alese în alertă (pentru a arăta și companiile fără rezultate). */
function expectedAirlines(ctx) {
  const codes = new Set(ctx.airlineCodes || []);
  if (!codes.size) return [];
  return (state.config?.airlines || [])
    .filter((a) => a.codes.some((c) => codes.has(c)) && !a.codes.some((c) => c.includes('_')))
    .map((a) => a.name);
}
/** Potrivește numele din configurare cu numele trimis de Google (ex. „Austrian Airlines” ~ „Austrian”). */
const sameAirline = (cfgName, googleName) => {
  const a = fold(cfgName);
  const b = fold(googleName);
  const first = a.split(' ')[0];
  return a === b || b.startsWith(first === 'air' ? a : first) || a.startsWith(b);
};

/** Taburile pe companii: „Toate” + fiecare companie, cu prețul minim. */
function renderAirlineTabs(box, ctx, redraw) {
  const rows = allFlights(ctx).filter((f) => !ctx.view.route || routeOf(f) === ctx.view.route);
  const map = new Map();
  rows.forEach((f) => {
    (f.airlines || []).forEach((name) => {
      if (!map.has(name)) map.set(name, { name, count: 0, min: Infinity, logo: '' });
      const e = map.get(name);
      e.count += 1;
      e.min = Math.min(e.min, f.price ?? Infinity);
      e.logo = e.logo || legLogo((f.legs || []).find((l) => l.airline === name));
    });
  });
  const list = [...map.values()].sort((a, b) => a.min - b.min);
  const missing = expectedAirlines(ctx).filter((n) => !list.some((e) => sameAirline(n, e.name)));
  if (ctx.view.airline && !map.has(ctx.view.airline)) ctx.view.airline = null;
  if (list.length < 2 && !missing.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = `
    <button type="button" role="tab" class="air-tab ${!ctx.view.airline ? 'active' : ''}" data-airline="" aria-selected="${!ctx.view.airline}">
      <span class="at-name">All</span><span class="at-price">${rows.length} flights</span></button>
    ${list.map((e) => `
      <button type="button" role="tab" class="air-tab ${ctx.view.airline === e.name ? 'active' : ''}" data-airline="${h(e.name)}" aria-selected="${ctx.view.airline === e.name}">
        ${logo(e.logo, e.name, 22)}<span class="at-name">${h(e.name)}</span>
        <span class="at-price">from ${money(e.min, ctx.cur)} · ${e.count}</span></button>`).join('')}
    ${missing.map((n) => `
      <span class="air-tab none" title="The airline was included in the search but did not appear in the results">
        ${logo('', n, 22)}<span class="at-name">${h(n)}</span><span class="at-price">not found</span></span>`).join('')}`;
  box.querySelectorAll('[data-airline]').forEach((b) => b.addEventListener('click', () => {
    ctx.view.airline = b.dataset.airline || null;
    ctx.view.airlineAll = false;
    ctx.view.flightsShown = 25;
    redraw();
    b.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }));
}

function renderFlights(box, ctx) {
  const { view } = ctx;
  let rows = allFlights(ctx);
  if (view.route) rows = rows.filter((f) => routeOf(f) === view.route);
  if (view.airline) rows = rows.filter((f) => (f.airlines || []).includes(view.airline));
  if (!rows.length) {
    box.innerHTML = `<div class="row"><span class="row-icon">${icon('search', 16)}</span><span class="row-main">
      <span class="row-title">${view.onlyUnder ? 'No flights under your target right now' : 'No flights yet'}</span>
      <span class="row-sub">${view.onlyUnder ? 'We will notify you when one shows up.' : 'Results appear after the search.'}</span></span></div>`;
    return;
  }
  const key = {
    price: (f) => [f.price ?? Infinity],
    time: (f) => [f.combo.outbound_date, f.departure_time || ''],
    duration: (f) => [f.total_duration ?? Infinity],
  }[view.sort];
  rows.sort((a, b) => {
    const x = key(a);
    const y = key(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    return (a.price ?? 0) - (b.price ?? 0);
  });

  // Pe o companie: primele 10 variante (cu opțiunea „Arată toate”)
  if (view.airline) {
    const shown = view.airlineAll ? rows : rows.slice(0, 10);
    box.innerHTML = `<div class="air-head">${h(view.airline)} · ${view.airlineAll || rows.length <= 10
      ? `${rows.length} ${rows.length === 1 ? 'option' : 'options'}` : `top 10 of ${rows.length}`}</div>`
      + shown.map((f) => ticket(f, ctx, true)).join('')
      + (rows.length > shown.length
        ? `<button type="button" class="add-row" data-all style="justify-content:center">Show all ${rows.length}</button>` : '');
    box.querySelector('[data-all]')?.addEventListener('click', () => {
      view.airlineAll = true;
      renderFlights(box, ctx);
    });
    return;
  }

  const shown = rows.slice(0, view.flightsShown);
  box.innerHTML = shown.map((f) => ticket(f, ctx, true)).join('')
    + (rows.length > shown.length
      ? `<button type="button" class="add-row" data-more style="justify-content:center">Show ${Math.min(25, rows.length - shown.length)} more of ${rows.length - shown.length}</button>`
      : '');
  box.querySelector('[data-more]')?.addEventListener('click', () => {
    view.flightsShown += 25;
    renderFlights(box, ctx);
  });
}

/**
 * Rândul „Last search … · Next …” pentru o alertă (results = rezultatele brute, necovertite).
 * „due now” = ora programată a trecut, dar GitHub încă n-a căutat (aplicația îl trezește singură).
 */
export function scheduleLine(alert, results) {
  const last = lastSearchedAt(results);
  const n = nextSearch(alert, results, todayRO(), hourRO());
  const hh = (x) => `${String(x).padStart(2, '0')}:00`;
  let next = '';
  if (n?.when === 'now') next = `<b class="warn-text">next: due now (${hh(n.hour)}, GitHub is late)</b>`;
  else if (n?.when === 'today') next = `next: today ${hh(n.hour)}`;
  else if (n?.when === 'tomorrow') next = `next: tomorrow ${hh(n.hour)}`;
  else if (n?.when === 'later') next = `first search: ${shortDate(n.day)} ${hh(n.hour)}`;
  const parts = [last ? `Last search: ${shortDateTime(last)}` : 'Not searched yet', next].filter(Boolean);
  return `<div class="sched-line">${icon('clock', 12)}<span>${parts.join(' · ')}</span></div>`;
}

/** Tipul călătoriei, ca text. */
export function tripLabel(x) {
  return x.trip_type === 'one_way' ? 'one way' : 'return';
}

/** Text scurt pentru numărul maxim de escale. */
export function stopsLabel(maxStops) {
  if (maxStops === 0) return 'direct only';
  if (maxStops === 1) return 'max. 1 stop';
  if (maxStops === 2) return 'max. 2 stops';
  return 'any stops';
}

/** Numărul maxim de escale al unei alerte/căutări (compatibil cu vechiul „direct_only”). */
export function maxStopsOf(x) {
  if (x.max_stops === 0 || x.max_stops === 1 || x.max_stops === 2) return x.max_stops;
  return x.direct_only ? 0 : null;
}

/**
 * Partea de sus a cardului principal: un „banner” cu cerul momentului zilei (sau poza destinației,
 * încărcată ulterior de decorateHero), cu ruta, steagurile și arcul animat deasupra.
 */
export function heroRoute(deps = [], destination = {}) {
  const codes = destination?.codes || [];
  const fromCode = deps.length > 2 ? `${deps[0]} +${deps.length - 1}` : deps.join(' · ');
  const fromPlace = deps.length === 1 ? airportName(deps[0]) : `${deps.length} airports`;
  const toCode = codes.length > 2 ? `${codes[0]} +${codes.length - 1}` : codes.join(' · ');
  const fromFlag = airportFlag(deps[0]);
  const toFlag = destFlag(destination);
  const phase = skyPhase();
  return {
    tint: countryTint(destinationIso(destination)),
    html: `<div class="hero-banner sky-${phase}">
      <div class="hero-photo" aria-hidden="true"></div>
      <div class="hero-route v2">
        <div class="iata">${h(fromCode)}</div>
        <div class="iata right">${h(toCode)}</div>
        <div class="path">${routeArc()}</div>
        <div class="place">${fromFlag ? `${fromFlag} ` : ''}${h(fromPlace)}</div>
        <div class="place right">${toFlag ? `${toFlag} ` : ''}${h(destination?.name || '')}</div>
      </div>
      <a class="photo-credit" hidden target="_blank" rel="noopener">Photo: Wikipedia</a>
    </div>`,
  };
}

/** Încarcă poza destinației în bannerul cardului principal (dacă găsim una potrivită). */
export async function decorateHero(root, destination) {
  const banner = root.querySelector('.hero-banner');
  if (!banner) return;
  const full = state.config?.destinations.find((d) => d.id === destination?.id);
  const name = full?.name || destination?.name || '';
  const place = await locateDestination(destination);
  const photo = await cityPhoto([place?.name, ...nameCandidates(name)]);
  if (!photo || !banner.isConnected) return;
  const url = await loadImage(photo.hero, photo.original);
  if (!url || !banner.isConnected) return;
  banner.querySelector('.hero-photo').style.backgroundImage = `url("${url}")`;
  banner.classList.add('has-photo');
  const credit = banner.querySelector('.photo-credit');
  credit.href = photo.page;
  credit.title = photo.title;
  credit.hidden = false;
}

/** Cardul cu verdictul „Cumpără acum / Mai așteaptă”. */
export function verdictCard(v) {
  if (!v) return '';
  const st = VERDICT_STYLE[v.kind];
  return `<div class="card verdict verdict-${v.kind}">
    <div class="verdict-head">
      <span class="row-icon ${st.cls}">${icon(st.icon, 18)}</span>
      <div class="row-main"><b>${h(v.title)}</b><span class="row-sub">${h(v.text)}</span></div>
    </div>
    ${v.tags.length ? `<div class="verdict-tags">${v.tags.map((t) => `<span class="badge ${t.tone}">${h(t.label)}</span>`).join('')}</div>` : ''}
    <p class="small muted" style="margin:10px 0 0">Indicative only, based on your history and Google data. Prices cannot be predicted with certainty.</p>
  </div>`;
}
