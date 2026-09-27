// Ecranul 2: formularul de creare / editare a unei alerte, cu estimarea căutărilor.
// Același formular servește și pentru căutarea rapidă (mode = 'search').

import { DEFAULT_HOURS, combinations, estimateBudget, searchHours } from '../budget.js';
import {
  createFile, deleteAlert, githubLinks, hasWriteAccess, loadJSON, saveAlert, saveCustomDestination, signSearch,
} from '../data.js';
import { countryFlag, destFlag } from '../flags.js';
import { icon } from '../icons.js';
import { successCheck } from '../motion.js';
import { askPassword } from '../password.js';
import { maxStopsOf } from '../results-view.js';
import { ensureAlerts, ensureConfig, loadStatus, state } from '../state.js';
import { setNav, setTabbarVisible, skeleton, stepper, toggle } from '../ui.js';
import { addDays, copyText, dayDate, fold, h, shortDate, slugify, toast, todayRO } from '../util.js';

let draft = null;    // alerta în lucru (starea formularului)
let original = null; // alerta originală (la editare)
let mode = 'alert';  // 'alert' = alertă zilnică, 'search' = căutare rapidă (o singură dată)

/** Transformă o alertă salvată în starea formularului. */
function toDraft(alert, config) {
  const codes = new Set(alert.airlines || []);
  const groups = new Set();
  for (const a of config.airlines) {
    if (a.codes.every((c) => codes.has(c))) {
      groups.add(a.id);
      a.codes.forEach((c) => codes.delete(c));
    }
  }
  return {
    id: alert.id,
    name: alert.name || '',
    active: alert.active !== false,
    monitor_start: alert.monitor_start || todayRO(),
    monitor_end: alert.monitor_end || '',
    airports: new Set(alert.departure_airports || []),
    destination: alert.destination || null,
    trip_type: alert.trip_type === 'one_way' ? 'one_way' : 'round_trip',
    departures: (alert.departures || []).map((d) => ({ date: d.date, nights: (d.nights || []).join(', ') })),
    anyAirline: !(alert.airlines || []).length,
    airlineGroups: groups,
    extraAirlines: [...codes].join(', '),
    max_price: alert.max_price ?? '',
    currency: alert.currency || 'EUR',
    adults: alert.adults || 1,
    bags: alert.bags || 0,
    max_stops: maxStopsOf(alert),
    search_hours: searchHours(alert),
    return_details: Boolean(alert.return_details),
  };
}

function emptyDraft() {
  return {
    id: null, name: '', active: true, monitor_start: todayRO(), monitor_end: '',
    airports: new Set(['OTP']), destination: null,
    trip_type: 'round_trip',
    departures: [{ date: '', nights: '' }],
    anyAirline: true, airlineGroups: new Set(), extraAirlines: '',
    max_price: '', currency: 'EUR', adults: 1, bags: 0, max_stops: null, return_details: false, search_hours: [8],
  };
}

/** Citește o listă de coduri IATA scrise de mână: 'vy, u2' -> ['VY', 'U2'] */
function parseCodes(text, len) {
  const re = len === 2 ? /^[A-Z0-9]{2}$/ : /^[A-Z]{3}$/;
  return String(text || '').toUpperCase().split(/[\s,;]+/).filter((c) => re.test(c));
}

function parseNights(text) {
  return [...new Set(String(text || '').split(/[\s,;]+/).map((n) => parseInt(n, 10)).filter((n) => n >= 0 && n <= 60))]
    .sort((a, b) => a - b);
}

/** Construiește alerta (formatul din data/alerts.json) din starea formularului. */
function buildAlert() {
  const cfg = state.config;
  const oneWay = draft.trip_type === 'one_way';
  const departures = draft.departures
    .filter((d) => d.date)
    .map((d) => ({ date: d.date, nights: oneWay ? [] : parseNights(d.nights) }))
    .filter((d) => oneWay || d.nights.length) // la dus-întors e nevoie de nopți
    .sort((a, b) => a.date.localeCompare(b.date));
  let airlines = [];
  if (!draft.anyAirline) {
    for (const a of cfg.airlines) if (draft.airlineGroups.has(a.id)) airlines.push(...a.codes);
    airlines.push(...parseCodes(draft.extraAirlines, 2));
    airlines = [...new Set(airlines)];
  }
  const lastDeparture = departures.length ? departures[departures.length - 1].date : '';
  return {
    id: draft.id || `${slugify(draft.name)}-${Math.random().toString(36).slice(2, 6)}`,
    name: draft.name.trim(),
    active: draft.active,
    monitor_start: draft.monitor_start || todayRO(),
    monitor_end: draft.monitor_end || lastDeparture,
    departure_airports: [...draft.airports],
    destination: draft.destination,
    trip_type: draft.trip_type,
    departures,
    airlines,
    max_price: Number(draft.max_price) || 0,
    currency: draft.currency,
    adults: Number(draft.adults) || 1,
    bags: Number(draft.bags) || 0,
    max_stops: draft.max_stops,
    search_hours: [...new Set(draft.search_hours)].sort((a, b) => a - b),
    updated_at: new Date().toISOString(),
  };
}

/** Cererea pentru o căutare rapidă (aceleași câmpuri ca o alertă, fără perioadă de monitorizare). */
function buildSearchRequest() {
  const a = buildAlert();
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const id = `s-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
  const firstDate = a.departures[0]?.date;
  return {
    id,
    created_at: d.toISOString(),
    title: a.name || `${a.departure_airports.join(',')} → ${a.destination?.name || '?'}${firstDate ? ` · ${shortDate(firstDate)}` : ''}`,
    departure_airports: a.departure_airports,
    destination: a.destination,
    trip_type: a.trip_type,
    departures: a.departures,
    airlines: a.airlines,
    max_price: a.max_price || null,
    currency: a.currency,
    adults: a.adults,
    bags: a.bags,
    max_stops: a.max_stops,
    return_details: a.trip_type !== 'one_way' && Boolean(draft.return_details),
  };
}

function validate(alert) {
  const errors = [];
  const today = todayRO();
  if (mode === 'alert' && !alert.name) errors.push('Give the alert a name.');
  if (!alert.departure_airports.length) errors.push('Pick at least one departure airport.');
  if (alert.departure_airports.length > MAX_CODES) errors.push(`At most ${MAX_CODES} departure airports in one search.`);
  if (!alert.destination?.codes?.length) errors.push('Pick the destination.');
  if (!alert.departures.length) {
    errors.push(alert.trip_type === 'one_way'
      ? 'Add at least one departure day.'
      : 'Add at least one departure day with the number of nights (e.g. 4, 5).');
  }
  if (alert.departures.length && alert.departures.every((d) => d.date < today)) {
    errors.push('All departure days are in the past. Add a future date.');
  }
  if (!draft.anyAirline && !alert.airlines.length) errors.push('Pick at least one airline or turn on “Any airline”.');
  if (mode === 'alert' && !(alert.max_price > 0)) errors.push('Enter the maximum price.');
  if (mode === 'alert' && alert.monitor_end && alert.monitor_start > alert.monitor_end) {
    errors.push('Monitoring period: the start is after the end.');
  }
  if (mode === 'search') {
    const max = state.config.settings.one_time_max_searches || 20;
    const n = combinations(alert, today).length;
    if (n > max) errors.push(`A quick search can have at most ${max} combinations (now ${n}).`);
  }
  if (alert.bags > alert.adults) errors.push('Carry-on bags cannot exceed the number of adults.');
  if (mode === 'alert' && new Set(draft.search_hours).size !== draft.search_hours.length) {
    errors.push('The search times must be different from each other.');
  }
  return errors;
}

function returnsText(d) {
  const nights = parseNights(d.nights);
  if (!d.date || !nights.length) return '';
  return nights.map((n) => `<span>${icon('plane')}${dayDate(addDays(d.date, n))} · ${n} ${n === 1 ? 'night' : 'nights'}</span>`).join('');
}

// ---------------------------------------------------------------------------

/**
 * id: alerta de editat (sau null)
 * options.mode: 'alert' (implicit) sau 'search' (căutare rapidă)
 * options.fromSearch: id-ul unei căutări rapide anterioare, ca punct de plecare („Repetă”)
 */
export async function renderForm(app, id, options = {}) {
  mode = options.mode || 'alert';
  const isSearch = mode === 'search';
  setTabbarVisible(false);
  setNav(isSearch
    ? { title: 'Quick search', back: '#/cautare' }
    : { title: id ? 'Edit alert' : 'New alert', back: id ? `#/alerta/${encodeURIComponent(id)}` : '#/' });
  app.innerHTML = skeleton(3);
  const cfg = await ensureConfig();
  const alerts = await ensureAlerts();
  if (!state.status) await loadStatus();
  original = !isSearch && id ? alerts.find((a) => a.id === id) : null;
  if (!isSearch && id && !original) {
    setTabbarVisible(true);
    app.innerHTML = `<div class="card empty"><h2>Alert not found</h2><a class="btn primary" href="#/">Back</a></div>`;
    return;
  }
  draft = original ? toDraft(original, cfg) : emptyDraft();
  if (isSearch && options.fromSearch) {
    // „Repetă căutarea”: pornim de la parametrii unei căutări anterioare
    try {
      const doc = await loadJSON(`data/searches/${options.fromSearch}.json`);
      const req = JSON.parse(doc?.request || '{}');
      draft = { ...toDraft({ ...req, name: '' }, cfg), id: null };
      const today = todayRO();
      draft.departures = draft.departures.filter((d) => d.date >= today);
      if (!draft.departures.length) draft.departures = [{ date: '', nights: '' }];
    } catch { /* pornim de la zero */ }
  }

  app.innerHTML = `
    <div id="form-errors"></div>
    <form id="alert-form" novalidate autocomplete="off">
      ${isSearch ? `
      <div class="banner info" style="margin-top:4px">${icon('search', 18)}<div>A single search, made right now. It costs one credit
        per combination and needs the search password. Results appear in 1–2 minutes.</div></div>
      <div class="section-label"><span>Search</span></div>
      <div class="group">
        <div class="row-stack">
          <label class="label" for="f-name">Title (optional)</label>
          <input id="f-name" type="text" maxlength="60" placeholder="e.g. Lisbon weekend" value="${h(draft.name)}">
        </div>
      </div>` : `
      <div class="section-label"><span>Alert</span></div>
      <div class="group">
        <div class="row-stack">
          <label class="label" for="f-name">Name</label>
          <input id="f-name" type="text" maxlength="60" placeholder="e.g. Rome in November" value="${h(draft.name)}">
        </div>
        ${toggle('f-active', draft.active, 'Alert on', 'When off, it uses no searches')}
      </div>`}

      <div class="section-label"><span>Route</span></div>
      <div class="group">
        <button type="button" class="dest-pick" id="orig-open"></button>
        <button type="button" class="dest-pick" id="dest-open"></button>
      </div>

      <div class="section-label"><span>Departures</span></div>
      <div class="group">
        <div class="row-stack">
          <div class="seg full" role="group" aria-label="Trip type">
            <button type="button" data-trip="round_trip" aria-pressed="${draft.trip_type !== 'one_way'}">Return</button>
            <button type="button" data-trip="one_way" aria-pressed="${draft.trip_type === 'one_way'}">One way</button>
          </div>
        </div>
        <div id="departures"></div>
        <button type="button" class="add-row" id="add-dep">${icon('plus', 18)} Add departure day</button>
      </div>
      <p class="section-note" id="dep-note"></p>

      ${isSearch ? '' : `<div class="section-label"><span>Monitoring period</span></div>
      <div class="group">
        <div class="row-stack">
          <div class="grid2">
            <div><label class="label" for="f-start">From</label><input id="f-start" type="date" value="${h(draft.monitor_start)}"></div>
            <div><label class="label" for="f-end">Until</label><input id="f-end" type="date" value="${h(draft.monitor_end)}"></div>
          </div>
          <p class="hint">Empty “Until” = until the last departure day.</p>
          <p class="hint warn-text" id="monitor-warn"></p>
        </div>
        <div class="row-stack">
          <span class="label">Searches per day</span>
          <div class="seg full" role="group" aria-label="Searches per day">
            ${[1, 2, 3, 4].map((n) => `<button type="button" data-freq="${n}" aria-pressed="${draft.search_hours.length === n}">${n}×</button>`).join('')}
          </div>
          <div class="hours-grid" id="hours-grid"></div>
          <p class="hint">Romania time. GitHub may start the search 5–20 minutes late.
            A new or changed alert is searched right after saving.</p>
        </div>
      </div>`}

      <div class="section-label"><span>Airlines</span></div>
      <div class="group">
        ${toggle('f-any-airline', draft.anyAirline, 'Any airline')}
        <div class="row-stack" id="airline-box" ${draft.anyAirline ? 'hidden' : ''}>
          <div class="chips">${cfg.airlines.map((a) => `
            <label class="chip" title="${h(a.codes.join(', '))}"><input type="checkbox" name="airline" value="${h(a.id)}" ${draft.airlineGroups.has(a.id) ? 'checked' : ''}>
            <span>${h(a.name)}</span></label>`).join('')}
          </div>
          <label class="label" for="f-extra-airlines" style="margin-top:12px">Other IATA codes (optional)</label>
          <input type="text" id="f-extra-airlines" placeholder="e.g. VY, U2" value="${h(draft.extraAirlines)}" autocapitalize="characters">
        </div>
      </div>

      <div class="section-label"><span>Price and passengers</span></div>
      <div class="group">
        <div class="row-stack">
          <label class="label" for="f-price" id="price-label"></label>
          <div class="price-input">
            <input id="f-price" type="number" inputmode="numeric" min="1" step="1" placeholder="250" value="${h(draft.max_price)}">
            <div class="seg" role="group" aria-label="Currency">
              <button type="button" data-cur="EUR" aria-pressed="${draft.currency === 'EUR'}">EUR</button>
              <button type="button" data-cur="RON" aria-pressed="${draft.currency === 'RON'}">RON</button>
            </div>
          </div>
        </div>
        ${stepper('f-adults', draft.adults, 1, 9, 'Adults')}
        ${stepper('f-bags', draft.bags, 0, draft.adults, 'Carry-on bags', 'cabin trolley')}
        <div class="row-stack">
          <span class="label">Maximum stops</span>
          <div class="seg full" role="group" aria-label="Maximum stops">
            ${[[null, 'Any'], [0, 'Direct'], [1, 'Max. 1'], [2, 'Max. 2']].map(([v, l]) => `
              <button type="button" data-stops="${v === null ? '' : v}" aria-pressed="${draft.max_stops === v}">${l}</button>`).join('')}
          </div>
        </div>
        ${isSearch ? `<div id="return-box">${toggle('f-return', draft.return_details, 'Return flight details', 'For the cheapest flight: +1 credit per combination')}</div>` : ''}
      </div>

      <div class="section-label"><span>${isSearch ? 'Cost' : 'Search usage'}</span></div>
      <div class="card budget-card" id="budget-box"></div>

      ${original ? `<button type="button" class="btn danger block" id="delete-btn" style="margin-top:18px">${icon('trash', 18)} Delete alert</button>` : ''}
    </form>

    <dialog class="sheet" id="place-sheet" aria-label="Choose"></dialog>
    <dialog class="modal" id="json-dialog"></dialog>
  `;

  // Bara fixă de jos cu estimarea și butonul Salvează (în afara <main>)
  document.getElementById('savebar')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="savebar" id="savebar"><div class="savebar-inner">
      <div class="savebar-info" id="savebar-info"></div>
      <button type="submit" form="alert-form" class="btn primary" id="save-btn">${isSearch ? `${icon('search', 16)} Search now` : hasWriteAccess() ? 'Save' : 'Prepare'}</button>
    </div></div>`);

  renderOrigins();
  renderDestination();
  renderDepartures();
  renderBudget();
  bindEvents(app);
}

// ---------------------------------------------------------------------------
// Destinația: ecran de căutare (sheet) + adăugare destinație nouă
// ---------------------------------------------------------------------------
function renderDestination() {
  const btn = document.getElementById('dest-open');
  const d = draft.destination;
  btn.innerHTML = `
    <span class="row-icon">${icon('pin', 16)}</span>
    <span class="row-main">${d
      ? `<span class="row-sub">${d.parts?.length > 1 ? `${d.parts.length} destinations, searched together` : 'Destination'}</span>
         <b>${destFlag(d) ? `${destFlag(d)} ` : ''}${h(d.name)}</b><span class="row-sub">${h(d.codes.join(', '))}</span>`
      : '<span class="row-title">Choose the destination</span><span class="row-sub">One or more: city, country or IATA code</span>'}</span>
    <span class="chev muted">${icon('chevron', 18)}</span>`;
}

/** Mai multe destinații -> una singură, cu toate codurile (căutată într-un singur apel). */
function mergeDestinations(parts) {
  if (!parts.length) return null;
  if (parts.length === 1) return { id: parts[0].id, name: parts[0].name, codes: [...parts[0].codes] };
  return {
    id: `multi:${parts.map((p) => p.id).join('+')}`,
    name: parts.map((p) => p.name.replace(/\s*\((toate|all)[^)]*\)/i, '')).join(' / '),
    codes: [...new Set(parts.flatMap((p) => p.codes))],
    parts: parts.map((p) => ({ id: p.id, name: p.name, codes: p.codes })),
  };
}

/** Numărul maxim de aeroporturi într-o căutare (plecare sau destinație). */
const MAX_CODES = 7;

/**
 * Ecranul de alegere (sheet) comun pentru plecări și destinații: listă mare cu căutare,
 * selecție multiplă (toate se caută împreună, într-un singur apel), maxim MAX_CODES aeroporturi.
 * opts: {title, placeholder, emptyText, items, picked, addHtml, bindAdd(sheet, add), onDone(picked)}
 *   items: [{id, name, country, region, codes, group?}]; picked: [{id, name, codes}]
 */
function openPlaceSheet(opts) {
  const sheet = document.getElementById('place-sheet');
  sheet.setAttribute('aria-label', opts.title);
  sheet.innerHTML = `
    <div class="sheet-head">
      <div class="sheet-grip"></div>
      <div class="sheet-title"><h2>${h(opts.title)}</h2>
        <button type="button" class="btn primary sm" id="sheet-done">Done</button></div>
      <div class="search-box">${icon('search', 18)}<input type="search" id="place-search" placeholder="${h(opts.placeholder)}" autocomplete="off"></div>
      <div class="dest-selected" id="place-selected"></div>
    </div>
    <div class="sheet-body">
      <div id="place-list"></div>
      ${opts.addHtml}
    </div>`;

  const search = sheet.querySelector('#place-search');
  const list = sheet.querySelector('#place-list');
  const selectedBox = sheet.querySelector('#place-selected');
  let picked = opts.picked.map((p) => ({ ...p, codes: [...p.codes] }));
  const totalCodes = () => new Set(picked.flatMap((p) => p.codes)).size;
  // un aeroport e bifat dacă e ales direct sau prin codul lui (ex. la editarea unei alerte)
  const matches = (p, d) => p.id === d.id || (d.codes.length === 1 && p.codes.length === 1 && p.codes[0] === d.codes[0]);
  const isPicked = (d) => picked.some((p) => matches(p, d));

  const drawSelected = () => {
    selectedBox.innerHTML = picked.length ? `${picked.map((p, i) => `
      <button type="button" class="dest-chip" data-unpick="${i}">${destFlag(p) ? `${destFlag(p)} ` : ''}${h(p.name)}${p.codes.length === 1 && p.name !== p.codes[0] ? ` <small>${h(p.codes[0])}</small>` : ''} ${icon('close', 12)}</button>`).join('')}
      <span class="small ${totalCodes() > MAX_CODES ? 'bad-text' : 'muted'}">${totalCodes()} ${totalCodes() === 1 ? 'airport' : 'airports'}${totalCodes() > MAX_CODES ? ` (max. ${MAX_CODES})` : ''}</span>`
      : `<span class="small muted">${h(opts.emptyText)}</span>`;
  };
  const draw = () => {
    const q = fold(search.value.trim());
    let items = opts.items;
    if (q) {
      items = items.filter((d) => !d.group && fold(`${d.name} ${d.country} ${d.alt || ''} ${d.codes.join(' ')} ${d.id}`).includes(q));
      items = [...items].sort((a, b) => (fold(b.id) === q) - (fold(a.id) === q));
    }
    items = items.slice(0, 140);
    const groups = [];
    for (const d of items) {
      const g = d.group || `${d.country} · ${d.region}`;
      if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, flag: d.group ? '' : countryFlag(d.country), items: [] });
      groups[groups.length - 1].items.push(d);
    }
    list.innerHTML = groups.map(({ g, flag, items: its }) => `
      <div class="pick-group">${flag ? `${flag} ` : ''}${h(g)}</div>
      <div class="group">${its.map((d) => `
        <button type="button" class="pick-item ${isPicked(d) ? 'picked' : ''}" data-id="${h(d.id)}" aria-pressed="${isPicked(d)}">
          <span class="pick-code ${d.codes.length > 1 ? 'multi' : ''}">${d.codes.length > 1 ? `${d.codes.length}×` : h(d.codes[0])}</span>
          <span class="row-main"><span class="row-title">${h(d.name)}</span>${d.codes.length > 1
            ? `<span class="row-sub">${h(d.codes.join(', '))}</span>` : d.group && d.country ? `<span class="row-sub">${h(d.country)}</span>` : ''}</span>
          <span class="pick-check">${icon('check', 14)}</span>
        </button>`).join('')}</div>`).join('')
      || '<p class="muted" style="padding:16px 4px">Nothing found. Add it below by IATA code.</p>';
  };
  const redraw = () => { drawSelected(); draw(); };
  const add = (place) => {
    if (!picked.some((p) => matches(p, place))) picked.push(place);
    redraw();
  };
  redraw();
  search.addEventListener('input', draw);

  selectedBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-unpick]');
    if (!b) return;
    picked.splice(Number(b.dataset.unpick), 1);
    redraw();
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.pick-item');
    if (!b) return;
    const d = opts.items.find((x) => x.id === b.dataset.id);
    if (isPicked(d)) picked = picked.filter((p) => !matches(p, d));
    else picked.push({ id: d.id, name: d.name, country: d.country, codes: [...d.codes] });
    redraw();
  });
  sheet.querySelector('#sheet-done').onclick = () => {
    if (totalCodes() > MAX_CODES) {
      toast(`Too many airports (${totalCodes()}). At most ${MAX_CODES} in one search.`);
      return;
    }
    opts.onDone(picked);
    renderBudget();
    sheet.close();
  };
  sheet.onclick = (e) => { if (e.target === sheet) sheet.close(); };
  opts.bindAdd(sheet, add);

  sheet.showModal();
  setTimeout(() => search.focus(), 250);
}

// ---------------------------------------------------------------------------
// Plecarea: aceeași listă mare ca la destinații, cu aeroporturile tale frecvente primele
// ---------------------------------------------------------------------------
/** Numele unui aeroport după cod (din lista de plecări sau din destinații). */
function codeName(code) {
  const own = state.config.airports.find((a) => a.code === code);
  if (own) return { name: own.name, country: '' };
  const d = state.config.destinations.find((x) => x.codes.length === 1 && x.codes[0] === code);
  return d ? { name: d.name, country: d.country } : { name: code, country: '' };
}

function renderOrigins() {
  const btn = document.getElementById('orig-open');
  const codes = [...draft.airports];
  const names = codes.map((c) => codeName(c).name);
  btn.innerHTML = `
    <span class="row-icon">${icon('plane', 16)}</span>
    <span class="row-main">${codes.length
      ? `<span class="row-sub">${codes.length > 1 ? `Departing from ${codes.length} airports, searched together` : 'Departing from'}</span>
         <b>${h(names.join(' / '))}</b><span class="row-sub">${h(codes.join(', '))}</span>`
      : '<span class="row-title">Choose where you depart from</span><span class="row-sub">One or more airports: city, country or IATA code</span>'}</span>
    <span class="chev muted">${icon('chevron', 18)}</span>`;
}

function openOriginSheet() {
  const own = state.config.airports.map((a) => {
    const known = state.config.destinations.find((x) => x.codes.length === 1 && x.codes[0] === a.code);
    return { id: `own:${a.code}`, name: a.name, country: known?.country || '', region: '', codes: [a.code], group: 'Your airports' };
  });
  openPlaceSheet({
    title: 'Departing from',
    placeholder: 'Search: Bucharest, Vienna, Italy, OTP…',
    emptyText: 'Tap one or more airports. They are all searched together, at no extra cost.',
    items: [...own, ...state.config.destinations],
    picked: [...draft.airports].map((c) => ({ id: c, ...codeName(c), codes: [c] })),
    addHtml: `
      <div class="section-label"><span>Not listed? Add it by code</span></div>
      <div class="group"><div class="row-stack">
        <label class="label" for="no-codes">IATA code(s)</label>
        <input type="text" id="no-codes" placeholder="e.g. VIE, BEG" autocapitalize="characters">
        <button type="button" class="btn tonal block" id="no-add" style="margin-top:12px">Add</button>
        <p class="hint">Find the IATA code by searching “&lt;city&gt; airport IATA code”. Separate several codes with commas.</p>
      </div></div>`,
    bindAdd(sheet, add) {
      sheet.querySelector('#no-add').onclick = () => {
        const input = sheet.querySelector('#no-codes');
        const codes = parseCodes(input.value, 3);
        if (!codes.length) {
          toast('Type at least one 3-letter IATA code');
          return;
        }
        codes.forEach((c) => add({ id: c, ...codeName(c), codes: [c] }));
        input.value = '';
      };
    },
    onDone(picked) {
      draft.airports = new Set(picked.flatMap((p) => p.codes));
      renderOrigins();
    },
  });
}

// ---------------------------------------------------------------------------
// Destinația
// ---------------------------------------------------------------------------
function openDestinationSheet() {
  openPlaceSheet({
    title: 'Destinations',
    placeholder: 'Search: Rome, Bali, Japan, FCO…',
    emptyText: 'Tap one or more destinations. They are all searched together, at no extra cost.',
    items: state.config.destinations,
    picked: draft.destination ? (draft.destination.parts || [draft.destination]) : [],
    addHtml: `
      <div class="section-label"><span>Not listed? Add it</span></div>
      <div class="group"><div class="row-stack">
        <label class="label" for="nd-name">Name</label>
        <input type="text" id="nd-name" placeholder="e.g. Mauritius">
        <div class="grid2" style="margin-top:10px">
          <div><label class="label" for="nd-codes">IATA code(s)</label><input type="text" id="nd-codes" placeholder="MRU" autocapitalize="characters"></div>
          <div><label class="label" for="nd-country">Country</label><input type="text" id="nd-country" placeholder="Mauritius"></div>
        </div>
        ${hasWriteAccess() ? '<label class="check small" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="nd-save" checked> Save to my list</label>' : ''}
        <button type="button" class="btn tonal block" id="nd-add" style="margin-top:12px">Use this destination</button>
        <p class="hint">Find the IATA code by searching “&lt;city&gt; airport IATA code”. Separate several codes with commas.</p>
      </div></div>`,
    bindAdd(sheet, add) {
      sheet.querySelector('#nd-add').onclick = async () => {
        const name = sheet.querySelector('#nd-name').value.trim();
        const codes = parseCodes(sheet.querySelector('#nd-codes').value, 3);
        const country = sheet.querySelector('#nd-country').value.trim() || 'Other';
        if (!name || !codes.length) {
          toast('Fill in the name and at least one 3-letter IATA code');
          return;
        }
        const dest = { id: codes.join('-'), name, country, region: 'Added by me', codes };
        if (sheet.querySelector('#nd-save')?.checked) {
          try {
            await saveCustomDestination(dest);
            state.config.destinations = [{ ...dest, custom: true }, ...state.config.destinations.filter((d) => d.id !== dest.id)];
            toast('Destination saved to your list');
          } catch (e) {
            toast(`Used, but not saved to the list: ${e.message}`, 6000);
          }
        }
        add({ id: dest.id, name, country, codes });
        toast('Destination added to the selection');
      };
    },
    onDone(picked) {
      draft.destination = mergeDestinations(picked);
      renderDestination();
    },
  });
}

// ---------------------------------------------------------------------------
// Zilele de plecare
// ---------------------------------------------------------------------------
function renderDepartures() {
  const box = document.getElementById('departures');
  const today = todayRO();
  const oneWay = draft.trip_type === 'one_way';
  box.innerHTML = draft.departures.map((d, i) => `
    <div class="dep-card" data-i="${i}">
      <div class="dep-grid ${oneWay ? 'one-way' : ''}">
        <input type="date" class="dep-date" min="${today}" value="${h(d.date)}" aria-label="Departure date ${i + 1}">
        ${oneWay ? '' : `<input type="text" class="dep-nights" inputmode="text" placeholder="nights: 4, 5" value="${h(d.nights)}" aria-label="Nights for departure ${i + 1}">`}
        <button type="button" class="icon-btn dep-del" aria-label="Delete day ${i + 1}" ${draft.departures.length === 1 ? 'disabled' : ''}>${icon('trash', 17)}</button>
      </div>
      ${oneWay ? '' : `<div class="dep-returns">${returnsText(d) || '<span class="muted" style="background:none;padding:0">Choose the date and number of nights</span>'}</div>`}
    </div>`).join('');
  syncTripTexts();
}

/** Textele care depind de tipul călătoriei (dus-întors / doar dus). */
function syncTripTexts() {
  const oneWay = draft.trip_type === 'one_way';
  const note = document.getElementById('dep-note');
  if (note) {
    note.textContent = oneWay
      ? 'Each departure day is one search. You can add several days to compare prices.'
      : 'You can enter several night options separated by commas (e.g. “4, 5”). Return date = departure + nights.';
  }
  const label = document.getElementById('price-label');
  if (label) {
    label.textContent = mode === 'search'
      ? `Maximum ${oneWay ? 'one-way' : 'return'} price (optional, only for highlighting)`
      : `Maximum ${oneWay ? 'one-way' : 'return'} price (total, all passengers)`;
  }
  const ret = document.getElementById('return-box');
  if (ret) ret.hidden = oneWay;
}

// ---------------------------------------------------------------------------
// Estimarea bugetului de căutări
// ---------------------------------------------------------------------------
/** Avertisment: monitorizarea începe mai târziu sau se oprește mult înainte de plecare. */
function renderMonitorWarning(alert) {
  const el = document.getElementById('monitor-warn');
  if (!el) return;
  const today = todayRO();
  const last = alert.departures.map((d) => d.date).sort().pop();
  const msgs = [];
  if (alert.monitor_start > today) {
    msgs.push(`Searching only starts on ${shortDate(alert.monitor_start)} (until then the alert is “scheduled”).`);
  }
  if (last && alert.monitor_end && alert.monitor_end < last) {
    const days = Math.round((new Date(last) - new Date(alert.monitor_end)) / 86400000);
    if (days > 7) msgs.push(`Monitoring stops on ${shortDate(alert.monitor_end)}, ${days} days before departure.`);
  }
  el.textContent = msgs.join(' ');
  el.hidden = !msgs.length;
}

function renderBudget() {
  const box = document.getElementById('budget-box');
  if (!box) return;
  if (mode === 'alert') renderMonitorWarning(buildAlert());
  if (mode === 'search') {
    renderSearchCost(box);
    return;
  }
  const today = todayRO();
  const limit = state.config.settings.monthly_search_limit || 250;
  const alert = buildAlert();
  const others = (state.alerts || []).filter((a) => a.id !== alert.id);
  const mine = estimateBudget([alert], today);
  const all = estimateBudget([...others, alert], today);
  const combos = combinations(alert).length;
  const ratio = all.perMonth / limit;
  const level = ratio > 1 ? 'bad' : ratio > 0.8 ? 'warn' : '';
  const left = state.status?.searches_left_after ?? state.status?.searches_left_before;

  box.innerHTML = `
    ${!alert.active ? `<div class="banner info" style="margin-top:0">${icon('pause', 16)}<div>The alert is paused and uses no searches.</div></div>` : ''}
    <div class="nums">
      <div><b>${mine.perDay}</b> <span>searches / day</span></div>
      <div style="text-align:right"><b>~${mine.perMonth}</b> <span>in 30 days</span></div>
    </div>
    <div class="small muted" style="margin-bottom:6px">${combos} ${combos === 1 ? 'combination' : 'combinations'} × ${alert.search_hours.length} ${alert.search_hours.length === 1 ? 'search' : 'searches'} per day</div>
    <div class="meter ${level}"><div style="width:${Math.min(100, ratio * 100)}%"></div></div>
    <div class="small ${level === 'bad' ? 'bad-text' : 'muted'}" style="margin-top:6px">
      All alerts: <b>~${all.perMonth}</b> of ${limit} per month${level === 'bad' ? ' — over the limit!' : level === 'warn' ? ' — close to the limit' : ''}</div>
    <p>${mine.extraMax ? `When a combination is under target, one more search is made for the return flight (max. ${mine.extraMax} in 30 days).` : ''}
      ${left !== undefined && left !== null ? `Credits left: <b>${left}</b>.` : ''}</p>`;

  const info = document.getElementById('savebar-info');
  if (info) {
    info.innerHTML = `<b class="${level === 'bad' ? 'bad' : ''}">${mine.perDay} searches/day · ~${mine.perMonth}/month</b>
      total ~${all.perMonth} of ${limit}`;
  }
}

/** Costul unei căutări rapide (credite consumate o singură dată). */
function renderSearchCost(box) {
  const today = todayRO();
  const req = buildAlert();
  const n = combinations(req, today).length;
  const extra = draft.return_details && draft.trip_type !== 'one_way' ? n : 0;
  const max = state.config.settings.one_time_max_searches || 20;
  const left = state.status?.searches_left_after ?? state.status?.searches_left_before;
  const tooMany = n > max;
  const notEnough = left !== undefined && left !== null && n + extra > left;
  box.innerHTML = `
    <div class="nums">
      <div><b class="${tooMany || notEnough ? 'bad-text' : ''}">${n}${extra ? `–${n + extra}` : ''}</b> <span>credits</span></div>
      <div style="text-align:right"><b>${n}</b> <span>${n === 1 ? 'combination' : 'combinations'}</span></div>
    </div>
    ${tooMany ? `<div class="small bad-text">At most ${max} combinations per search.</div>` : ''}
    ${notEnough ? `<div class="small bad-text">Not enough credits (left: ${left}).</div>` : ''}
    <p>1 credit per combination${extra ? ', plus up to 1 credit for the return details' : ''}.
      ${left !== undefined && left !== null ? `Credits left: <b>${left}</b>.` : ''}
      If the password is wrong, nothing is used.</p>`;
  const info = document.getElementById('savebar-info');
  if (info) {
    info.innerHTML = `<b class="${tooMany || notEnough ? 'bad' : ''}">${n}${extra ? `–${n + extra}` : ''} credits</b>
      ${n} ${n === 1 ? 'combination' : 'combinations'}, one time`;
  }
}

/** Trimite căutarea rapidă: semnează cererea și o scrie în data/searches/<id>.json. */
async function submitSearch(app, errBox) {
  const req = buildSearchRequest();
  const password = await askPassword();
  if (!password) return;
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const text = JSON.stringify(req);
    const sig = await signSearch(req.id, text, password);
    const doc = { id: req.id, status: 'pending', created_at: req.created_at, request: text, sig };
    await createFile(`data/searches/${req.id}.json`, JSON.stringify(doc, null, 2) + '\n', `Quick search: ${req.title}`);
    await successCheck('Search sent');
    toast('Results appear in 1–2 minutes.', 4000);
    location.hash = `#/cautare/${encodeURIComponent(req.id)}`;
  } catch (err) {
    errBox.innerHTML = `<div class="banner bad">${icon('warning', 18)}<div><b>Could not start the search.</b><br>${h(err.message)}</div></div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    btn.disabled = false;
    btn.innerHTML = `${icon('search', 16)} Search now`;
  }
}

// ---------------------------------------------------------------------------
// Evenimente
// ---------------------------------------------------------------------------
function bindEvents(app) {
  const form = app.querySelector('#alert-form');

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'f-name') draft.name = t.value;
    if (t.id === 'f-start') draft.monitor_start = t.value;
    if (t.id === 'f-end') draft.monitor_end = t.value;
    if (t.id === 'f-extra-airlines') draft.extraAirlines = t.value;
    if (t.id === 'f-price') draft.max_price = t.value;
    if (t.classList.contains('dep-date') || t.classList.contains('dep-nights')) {
      const card = t.closest('.dep-card');
      const d = draft.departures[Number(card.dataset.i)];
      if (t.classList.contains('dep-date')) d.date = t.value;
      else d.nights = t.value;
      const returns = card.querySelector('.dep-returns');
      if (returns) returns.innerHTML = returnsText(d)
        || '<span class="muted" style="background:none;padding:0">Choose the date and number of nights</span>';
    }
    renderBudget();
  });

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'f-active') draft.active = t.checked;
    if (t.name === 'airline') t.checked ? draft.airlineGroups.add(t.value) : draft.airlineGroups.delete(t.value);
    if (t.id === 'f-any-airline') {
      draft.anyAirline = t.checked;
      app.querySelector('#airline-box').hidden = t.checked;
    }
    if (t.id === 'f-return') draft.return_details = t.checked;
    renderBudget();
  });

  // tipul călătoriei
  app.querySelectorAll('[data-trip]').forEach((b) => b.addEventListener('click', () => {
    draft.trip_type = b.dataset.trip;
    app.querySelectorAll('[data-trip]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderDepartures();
    renderBudget();
  }));

  // de câte ori pe zi și la ce ore
  const hoursGrid = app.querySelector('#hours-grid');
  const drawHours = () => {
    if (!hoursGrid) return;
    hoursGrid.innerHTML = draft.search_hours.map((hr, i) => `
      <label class="hour-pick"><span>${i + 1}.</span>
        <select data-hour-index="${i}" aria-label="Search time ${i + 1}">
          ${Array.from({ length: 24 }, (_, x) => `<option value="${x}" ${x === hr ? 'selected' : ''}>${String(x).padStart(2, '0')}:00</option>`).join('')}
        </select></label>`).join('');
  };
  drawHours();
  app.querySelectorAll('[data-freq]').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.freq);
    draft.search_hours = [...DEFAULT_HOURS[n]];
    app.querySelectorAll('[data-freq]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    drawHours();
    renderBudget();
  }));
  hoursGrid?.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-hour-index]');
    if (!sel) return;
    draft.search_hours[Number(sel.dataset.hourIndex)] = Number(sel.value);
    renderBudget();
  });

  // numărul maxim de escale
  app.querySelectorAll('[data-stops]').forEach((b) => b.addEventListener('click', () => {
    draft.max_stops = b.dataset.stops === '' ? null : Number(b.dataset.stops);
    app.querySelectorAll('[data-stops]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));

  // moneda
  app.querySelectorAll('[data-cur]').forEach((b) => b.addEventListener('click', () => {
    draft.currency = b.dataset.cur;
    app.querySelectorAll('[data-cur]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));

  // butoanele +/−
  const syncSteppers = () => {
    app.querySelectorAll('[data-stepper]').forEach((s) => {
      const key = s.dataset.stepper === 'f-adults' ? 'adults' : 'bags';
      const max = key === 'bags' ? draft.adults : Number(s.dataset.max);
      s.querySelector('output').textContent = draft[key];
      s.querySelector('[data-step="-1"]').disabled = draft[key] <= Number(s.dataset.min);
      s.querySelector('[data-step="1"]').disabled = draft[key] >= max;
    });
  };
  app.querySelectorAll('[data-stepper]').forEach((s) => s.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const key = s.dataset.stepper === 'f-adults' ? 'adults' : 'bags';
    const max = key === 'bags' ? draft.adults : Number(s.dataset.max);
    draft[key] = Math.min(max, Math.max(Number(s.dataset.min), draft[key] + Number(b.dataset.step)));
    if (draft.bags > draft.adults) draft.bags = draft.adults;
    syncSteppers();
  }));
  syncSteppers();

  app.querySelector('#orig-open').onclick = openOriginSheet;
  app.querySelector('#dest-open').onclick = openDestinationSheet;

  app.querySelector('#add-dep').onclick = () => {
    const last = draft.departures[draft.departures.length - 1];
    draft.departures.push({ date: last?.date ? addDays(last.date, 1) : '', nights: last?.nights || '' });
    renderDepartures();
    renderBudget();
  };
  app.querySelector('#departures').addEventListener('click', (e) => {
    const del = e.target.closest('.dep-del');
    if (!del) return;
    draft.departures.splice(Number(del.closest('.dep-card').dataset.i), 1);
    renderDepartures();
    renderBudget();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    draft.name = app.querySelector('#f-name').value;
    const alert = buildAlert();
    const errors = validate(alert);
    const errBox = app.querySelector('#form-errors');
    if (errors.length) {
      errBox.innerHTML = `<div class="banner bad">${icon('warning', 18)}<div><b>Still to fill in:</b>
        <ul>${errors.map((x) => `<li>${h(x)}</li>`).join('')}</ul></div></div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    errBox.innerHTML = '';
    if (mode === 'search') {
      if (!hasWriteAccess()) {
        errBox.innerHTML = `<div class="banner warn">${icon('key', 18)}<div>Quick search needs the GitHub token.
          Add it in <a href="#/setari">Settings</a>.</div></div>`;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      await submitSearch(app, errBox);
      return;
    }
    alert.created_at = original?.created_at || alert.updated_at;

    if (!hasWriteAccess()) {
      showJsonDialog(app, alert);
      return;
    }
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const doc = await saveAlert(alert);
      state.alerts = doc.alerts;
      await successCheck(original ? 'Alert updated' : 'Alert created');
      toast('The search starts in 1–2 minutes.', 4000);
      location.hash = `#/alerta/${encodeURIComponent(alert.id)}`;
    } catch (err) {
      errBox.innerHTML = `<div class="banner bad">${icon('warning', 18)}<div><b>Could not save.</b><br>${h(err.message)}</div></div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      btn.disabled = false;
      btn.textContent = 'Save';
    }
  });

  app.querySelector('#delete-btn')?.addEventListener('click', async () => {
    if (!hasWriteAccess()) {
      toast('To delete, add the GitHub token in Settings or edit data/alerts.json.', 6000);
      return;
    }
    if (!confirm(`Delete the alert “${original.name}”?`)) return;
    try {
      const doc = await deleteAlert(original.id, original.name);
      state.alerts = doc.alerts;
      toast('Alert deleted');
      location.hash = '#/';
    } catch (err) {
      toast(`Could not delete: ${err.message}`, 6000);
    }
  });
}

/** Fără token: arătăm fișierul alerts.json complet, de copiat manual pe GitHub. */
function showJsonDialog(app, alert) {
  const alerts = (state.alerts || []).filter((a) => a.id !== alert.id).concat(alert);
  const text = JSON.stringify({ alerts }, null, 2);
  const links = githubLinks();
  const dlg = app.querySelector('#json-dialog');
  dlg.innerHTML = `
    <h2>Save the alert manually</h2>
    <p>Without a token the app cannot save by itself. Copy the text and replace the whole content of
    <code>data/alerts.json</code> on GitHub, then tap “Commit changes”.</p>
    <textarea readonly rows="8">${h(text)}</textarea>
    <div class="btn-row">
      <button type="button" class="btn primary" id="dlg-copy">${icon('copy', 16)} Copy</button>
      ${links.editAlerts ? `<a class="btn tonal" href="${links.editAlerts}" target="_blank" rel="noopener">GitHub ${icon('external', 14)}</a>` : ''}
    </div>
    <button type="button" class="btn block" id="dlg-close" style="margin-top:8px">Close</button>`;
  dlg.querySelector('#dlg-copy').onclick = async () => toast((await copyText(text)) ? 'Copied!' : 'Could not copy automatically');
  dlg.querySelector('#dlg-close').onclick = () => dlg.close();
  dlg.showModal();
}
