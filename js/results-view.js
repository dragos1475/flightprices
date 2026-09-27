// Afișarea rezultatelor (comună pentru alerte și căutări rapide):
// bilete de zbor, lista combinațiilor și lista tuturor zborurilor cu filtre și sortare.

import { comboKey } from './budget.js';
import { airportFlag, countryTint, destFlag, destinationIso } from './flags.js';
import { icon } from './icons.js';
import { VERDICT_STYLE } from './insights.js';
import { locateDestination, nameCandidates } from './geo.js';
import { cityPhoto, loadImage } from './media.js';
import { routeArc, skyPhase } from './motion.js';
import { airportName, priceLevel, state } from './state.js';
import { dateTime, dayDate, duration, h, hour, money, share } from './util.js';

/**
 * Textul unei oferte, pentru partajare.
 * ctx: {cur, route: 'OTP → Roma'}; combo: combinația; flight: zborul (opțional, altfel cel mai ieftin).
 */
export function dealText(ctx, combo, flight = combo.flights?.[0]) {
  const lines = [`✈️ ${ctx.route}: ${money(combo.lowest_price, ctx.cur)} ${combo.return_date ? 'dus-întors' : 'doar dus'}`,
    `📅 ${comboDates(combo)} · ${comboNights(combo)}`];
  if (flight) {
    lines.push(`🛫 ${flight.airlines.join('/')} ${flight.flight_numbers.join(', ')} · ${hour(flight.departure_time)}–${hour(flight.arrival_time)} · ${flight.stops ? `${flight.stops} escale` : 'direct'}`);
  }
  if (combo.return_flight) {
    const r = combo.return_flight;
    lines.push(`🛬 ${r.airlines.join('/')} ${r.flight_numbers.join(', ')} · ${hour(r.departure_time)}–${hour(r.arrival_time)}`);
  }
  return lines.join('\n');
}

export function shareCombo(ctx, combo) {
  return share({ title: `Zbor ${ctx.route}`, text: dealText(ctx, combo), url: combo.google_flights_url || '' });
}

/** Preferințe de afișare (păstrate cât timp aplicația e deschisă). */
export function newView() {
  return { sort: 'price', onlyUnder: false, comboSort: 'date', flightsShown: 25 };
}

/** Datele unei combinații: 'joi 12.11 → lun 16.11' sau 'joi 12.11' (doar dus). */
export function comboDates(c, arrow = ' → ') {
  return c.return_date ? `${dayDate(c.outbound_date)}${arrow}${dayDate(c.return_date)}` : dayDate(c.outbound_date);
}

/** '4 nopți' sau 'doar dus'. */
export function comboNights(c) {
  if (!c.return_date) return 'doar dus';
  return `${c.nights} ${c.nights === 1 ? 'noapte' : 'nopți'}`;
}

const isUnder = (price, maxPrice) => maxPrice > 0 && price !== null && price !== undefined && price <= maxPrice;

/** Un zbor, afișat ca bilet. */
export function ticket(f, ctx, showCombo) {
  const under = isUnder(f.price, ctx.maxPrice);
  const nextDay = f.arrival_time && f.departure_time && f.arrival_time.slice(0, 10) !== f.departure_time.slice(0, 10);
  const stops = f.stops
    ? `${f.stops} ${f.stops === 1 ? 'escală' : 'escale'}`
    : '<span class="stops-direct">direct</span>';
  return `<div class="ticket">
    <div class="ticket-head">
      <div class="ticket-airline">${h(f.airlines.join(' / '))}<small>${h(f.flight_numbers.join(', '))}</small></div>
      <div class="ticket-price ${under ? 'under' : ''}">${money(f.price, ctx.cur)}</div>
    </div>
    <div class="ticket-times">
      <div><div class="t">${hour(f.departure_time)}</div><div class="ap">${h(f.from)}</div></div>
      <div class="ticket-line"><span>${duration(f.total_duration)} · ${stops}</span></div>
      <div class="end"><div class="t">${hour(f.arrival_time)}${nextDay ? '<sup class="small muted">+1</sup>' : ''}</div><div class="ap">${h(f.to)}</div></div>
    </div>
    ${showCombo || f.stops ? `<div class="ticket-foot">
      <span>${showCombo ? `${comboDates(f.combo)} · ${comboNights(f.combo)}` : ''}</span>
      <span>${f.stops ? `prin ${h(f.layovers.map((l) => l.airport).join(', '))}` : ''}</span>
    </div>` : ''}
  </div>`;
}

/** Secțiunile „Combinații” și „Toate zborurile”, cu filtre. ctx = {combos, maxPrice, cur, view} */
export function resultsSections(ctx) {
  const { view } = ctx;
  return `
    <div class="section-label"><span>Combinații</span>
      <div class="seg" role="group" aria-label="Sortare combinații">
        <button type="button" data-csort="date" aria-pressed="${view.comboSort === 'date'}">Dată</button>
        <button type="button" data-csort="price" aria-pressed="${view.comboSort === 'price'}">Preț</button>
      </div>
    </div>
    <div class="group" data-box="combos"></div>

    <div class="section-label"><span>Toate zborurile</span></div>
    <div class="list-toolbar">
      ${ctx.maxPrice > 0 ? `<div class="seg" role="group" aria-label="Filtru">
        <button type="button" data-filter="all" aria-pressed="${!view.onlyUnder}">Toate</button>
        <button type="button" data-filter="under" aria-pressed="${view.onlyUnder}">Sub prag</button>
      </div>` : '<span></span>'}
      <div class="seg" role="group" aria-label="Sortare zboruri">
        <button type="button" data-sort="price" aria-pressed="${view.sort === 'price'}">Preț</button>
        <button type="button" data-sort="time" aria-pressed="${view.sort === 'time'}">Oră</button>
        <button type="button" data-sort="duration" aria-pressed="${view.sort === 'duration'}">Durată</button>
      </div>
    </div>
    <div class="group" data-box="flights"></div>
    <p class="section-note">${ctx.oneWay
    ? 'Prețurile sunt doar pentru dus, totale pentru toți pasagerii.'
    : 'Prețurile sunt totale, dus-întors, pentru toți pasagerii. Orele sunt ale zborului de dus.'}</p>`;
}

/** Desenează listele și leagă butoanele de filtrare/sortare. */
export function bindResults(root, ctx) {
  const { view } = ctx;
  if (!(ctx.maxPrice > 0)) view.onlyUnder = false;
  const combosBox = root.querySelector('[data-box="combos"]');
  const flightsBox = root.querySelector('[data-box="flights"]');
  const redrawCombos = () => renderCombos(combosBox, ctx);
  const redrawFlights = () => renderFlights(flightsBox, ctx);
  redrawCombos();
  redrawFlights();

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
      <span class="row-title">Încă nu există rezultate</span><span class="row-sub">Apar după prima căutare.</span></span></div>`;
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
    if (c.status === 'no_results') price = '<span class="small muted">fără zboruri</span>';
    const flights = (c.flights || []).map((f) => ({ ...f, combo: c }));
    return `<details class="combo" data-combo="${h(comboKey(c))}">
      <summary>
        <div style="min-width:0">
          <div class="combo-dates">${comboDates(c, '<span class="arrow">→</span>')}</div>
          <div class="combo-sub"><span>${comboNights(c)}</span>
            ${lvl ? `<span class="badge ${lvl.cls}">preț ${h(lvl.label)}</span>` : ''}
            ${Array.isArray(range) && range.length ? `<span>tipic ${range.map((v) => money(v)).join('–')}</span>` : ''}</div>
        </div>
        <div class="combo-price">${price}</div>
        <span class="chev">${icon('chevron', 16)}</span>
      </summary>
      <div class="combo-body">
        ${c.status === 'error' ? `<div class="banner bad">${icon('warning', 16)}<div>${h(c.error)}</div></div>` : ''}
        ${ret ? `<div class="combo-return">${icon('plane', 14)}<span><b>Întoarcere:</b> ${h(ret.airlines.join('/'))} ${h(ret.flight_numbers.join(', '))} · ${hour(ret.departure_time)}–${hour(ret.arrival_time)} · ${ret.stops ? `${ret.stops} escale` : 'direct'}</span></div>` : ''}
        ${flights.length ? `<div class="group" style="box-shadow:none">${flights.slice(0, 5).map((f) => ticket(f, ctx, false)).join('')}</div>` : ''}
        ${flights.length > 5 ? `<p class="small muted" style="margin:8px 2px 0">+${flights.length - 5} zboruri în lista completă de mai jos</p>` : ''}
        <div class="btn-row" style="margin-top:10px">
          ${c.google_flights_url ? `<a class="btn tonal sm" href="${h(c.google_flights_url)}" target="_blank" rel="noopener">Google Flights ${icon('external', 14)}</a>` : ''}
          ${c.lowest_price !== null && c.lowest_price !== undefined ? `<button type="button" class="btn sm" data-share="${h(comboKey(c))}">${icon('share', 14)} Partajează</button>` : ''}
        </div>
        <p class="small muted" style="margin:8px 2px 0">Căutat ${dateTime(c.searched_at)}</p>
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

function renderFlights(box, ctx) {
  const { combos, view } = ctx;
  let rows = combos.flatMap((c) => (c.flights || []).map((f) => ({ ...f, combo: c })));
  if (view.onlyUnder) rows = rows.filter((f) => isUnder(f.price, ctx.maxPrice));
  if (!rows.length) {
    box.innerHTML = `<div class="row"><span class="row-icon">${icon('search', 16)}</span><span class="row-main">
      <span class="row-title">${view.onlyUnder ? 'Niciun zbor sub prag momentan' : 'Niciun zbor încă'}</span>
      <span class="row-sub">${view.onlyUnder ? 'Îți trimitem o notificare când apare unul.' : 'Rezultatele apar după căutare.'}</span></span></div>`;
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
  const shown = rows.slice(0, view.flightsShown);
  box.innerHTML = shown.map((f) => ticket(f, ctx, true)).join('')
    + (rows.length > shown.length
      ? `<button type="button" class="add-row" data-more style="justify-content:center">Arată încă ${Math.min(25, rows.length - shown.length)} din ${rows.length - shown.length}</button>`
      : '');
  box.querySelector('[data-more]')?.addEventListener('click', () => {
    view.flightsShown += 25;
    renderFlights(box, ctx);
  });
}

/** Tipul călătoriei, ca text. */
export function tripLabel(x) {
  return x.trip_type === 'one_way' ? 'doar dus' : 'dus-întors';
}

/** Text scurt pentru numărul maxim de escale. */
export function stopsLabel(maxStops) {
  if (maxStops === 0) return 'doar directe';
  if (maxStops === 1) return 'max. 1 escală';
  if (maxStops === 2) return 'max. 2 escale';
  return 'oricâte escale';
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
  const fromPlace = deps.length === 1 ? airportName(deps[0]) : `${deps.length} aeroporturi`;
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
      <a class="photo-credit" hidden target="_blank" rel="noopener">Foto: Wikipedia</a>
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
    <p class="small muted" style="margin:10px 0 0">Orientativ, pe baza istoricului tău și a datelor Google. Prețurile nu se pot prezice sigur.</p>
  </div>`;
}
