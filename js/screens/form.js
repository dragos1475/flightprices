// Ecranul 2: formularul de creare / editare a unei alerte, cu estimarea căutărilor.
// Același formular servește și pentru căutarea rapidă (mode = 'search').

import { DEFAULT_HOURS, combinations, estimateBudget, searchHours } from '../budget.js';
import {
  createFile, deleteAlert, githubLinks, hasWriteAccess, loadJSON, saveAlert, saveCustomDestination, signSearch,
} from '../data.js';
import { countryFlag, destFlag } from '../flags.js';
import { icon } from '../icons.js';
import { successCheck } from '../motion.js';
import { maxStopsOf } from '../results-view.js';
import { ensureAlerts, ensureConfig, loadStatus, state } from '../state.js';
import { setNav, setTabbarVisible, skeleton, stepper, toggle } from '../ui.js';
import { addDays, copyText, dayDate, fold, h, slugify, toast, todayRO } from '../util.js';

let draft = null;    // alerta în lucru (starea formularului)
let original = null; // alerta originală (la editare)
let mode = 'alert';  // 'alert' = alertă zilnică, 'search' = căutare rapidă (o singură dată)
const PASSWORD_KEY = 'zboruri.search_password';

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
  const knownAirports = new Set(config.airports.map((a) => a.code));
  return {
    id: alert.id,
    name: alert.name || '',
    active: alert.active !== false,
    monitor_start: alert.monitor_start || todayRO(),
    monitor_end: alert.monitor_end || '',
    airports: new Set((alert.departure_airports || []).filter((c) => knownAirports.has(c))),
    extraAirports: (alert.departure_airports || []).filter((c) => !knownAirports.has(c)).join(', '),
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
    // verificarea fiecărei companii: implicit DA la căutarea rapidă, NU la alerte (costă zilnic)
    complete_airlines: alert.complete_airlines ?? mode === 'search',
  };
}

function emptyDraft() {
  return {
    id: null, name: '', active: true, monitor_start: todayRO(), monitor_end: '',
    airports: new Set(['OTP']), extraAirports: '', destination: null,
    trip_type: 'round_trip',
    departures: [{ date: '', nights: '' }],
    anyAirline: true, airlineGroups: new Set(), extraAirlines: '',
    max_price: '', currency: 'EUR', adults: 1, bags: 0, max_stops: null, return_details: false, search_hours: [8],
    complete_airlines: mode === 'search',
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
    departure_airports: [...new Set([...draft.airports, ...parseCodes(draft.extraAirports, 3)])],
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
    complete_airlines: !draft.anyAirline && Boolean(draft.complete_airlines),
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
    title: a.name || `${a.departure_airports.join(',')} → ${a.destination?.name || '?'}${firstDate ? ` · ${firstDate.slice(8, 10)}.${firstDate.slice(5, 7)}` : ''}`,
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
    complete_airlines: a.complete_airlines,
  };
}

function validate(alert) {
  const errors = [];
  const today = todayRO();
  if (mode === 'alert' && !alert.name) errors.push('Dă un nume alertei.');
  if (!alert.departure_airports.length) errors.push('Alege cel puțin un aeroport de plecare.');
  if (!alert.destination?.codes?.length) errors.push('Alege destinația.');
  if (!alert.departures.length) {
    errors.push(alert.trip_type === 'one_way'
      ? 'Adaugă cel puțin o zi de plecare.'
      : 'Adaugă cel puțin o zi de plecare cu numărul de nopți (ex. 4, 5).');
  }
  if (alert.departures.length && alert.departures.every((d) => d.date < today)) {
    errors.push('Toate zilele de plecare au trecut deja. Adaugă o dată viitoare.');
  }
  if (!draft.anyAirline && !alert.airlines.length) errors.push('Alege cel puțin o companie sau activează „Oricare companie”.');
  if (mode === 'alert' && !(alert.max_price > 0)) errors.push('Introdu prețul maxim dus-întors.');
  if (mode === 'alert' && alert.monitor_end && alert.monitor_start > alert.monitor_end) {
    errors.push('Perioada de monitorizare: începutul este după sfârșit.');
  }
  if (mode === 'search') {
    const max = state.config.settings.one_time_max_searches || 20;
    const n = combinations(alert, today).length;
    if (n > max) errors.push(`O căutare rapidă poate avea cel mult ${max} combinații (acum ${n}).`);
  }
  if (alert.bags > alert.adults) errors.push('Numărul de trolere nu poate depăși numărul de adulți.');
  if (mode === 'alert' && new Set(draft.search_hours).size !== draft.search_hours.length) {
    errors.push('Orele de căutare trebuie să fie diferite între ele.');
  }
  return errors;
}

function returnsText(d) {
  const nights = parseNights(d.nights);
  if (!d.date || !nights.length) return '';
  return nights.map((n) => `<span>${icon('plane')}${dayDate(addDays(d.date, n))} · ${n} ${n === 1 ? 'noapte' : 'nopți'}</span>`).join('');
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
    ? { title: 'Căutare rapidă', back: '#/cautare' }
    : { title: id ? 'Editează alerta' : 'Alertă nouă', back: id ? `#/alerta/${encodeURIComponent(id)}` : '#/' });
  app.innerHTML = skeleton(3);
  const cfg = await ensureConfig();
  const alerts = await ensureAlerts();
  if (!state.status) await loadStatus();
  original = !isSearch && id ? alerts.find((a) => a.id === id) : null;
  if (!isSearch && id && !original) {
    setTabbarVisible(true);
    app.innerHTML = `<div class="card empty"><h2>Alerta nu există</h2><a class="btn primary" href="#/">Înapoi</a></div>`;
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
      <div class="banner info" style="margin-top:4px">${icon('search', 18)}<div>O singură căutare, făcută acum. Costă câte un credit
        pe combinație și cere parola de căutare. Rezultatele apar în 1–2 minute.</div></div>
      <div class="section-label"><span>Căutare</span></div>
      <div class="group">
        <div class="row-stack">
          <label class="label" for="f-name">Titlu (opțional)</label>
          <input id="f-name" type="text" maxlength="60" placeholder="ex. Lisabona weekend" value="${h(draft.name)}">
        </div>
      </div>` : `
      <div class="section-label"><span>Alertă</span></div>
      <div class="group">
        <div class="row-stack">
          <label class="label" for="f-name">Nume</label>
          <input id="f-name" type="text" maxlength="60" placeholder="ex. Roma în noiembrie" value="${h(draft.name)}">
        </div>
        ${toggle('f-active', draft.active, 'Alertă pornită', 'Oprită, nu consumă căutări')}
      </div>`}

      <div class="section-label"><span>Rută</span></div>
      <div class="group">
        <div class="row-stack">
          <span class="label">Pleci din</span>
          <div class="chips">${cfg.airports.map((a) => `
            <label class="chip"><input type="checkbox" name="airport" value="${h(a.code)}" ${draft.airports.has(a.code) ? 'checked' : ''}>
            <span><b>${h(a.code)}</b>${h(a.name)}</span></label>`).join('')}
          </div>
          <details style="margin-top:10px" ${draft.extraAirports ? 'open' : ''}>
            <summary class="small" style="color:var(--accent);cursor:pointer;font-weight:600">Alt aeroport (cod IATA)</summary>
            <input type="text" id="f-extra-airports" style="margin-top:8px" placeholder="ex. VIE, BEG" value="${h(draft.extraAirports)}" autocapitalize="characters">
          </details>
        </div>
        <button type="button" class="dest-pick" id="dest-open"></button>
      </div>

      <div class="section-label"><span>Plecări</span></div>
      <div class="group">
        <div class="row-stack">
          <div class="seg full" role="group" aria-label="Tipul călătoriei">
            <button type="button" data-trip="round_trip" aria-pressed="${draft.trip_type !== 'one_way'}">Dus-întors</button>
            <button type="button" data-trip="one_way" aria-pressed="${draft.trip_type === 'one_way'}">Doar dus</button>
          </div>
        </div>
        <div id="departures"></div>
        <button type="button" class="add-row" id="add-dep">${icon('plus', 18)} Adaugă zi de plecare</button>
      </div>
      <p class="section-note" id="dep-note"></p>

      ${isSearch ? '' : `<div class="section-label"><span>Perioada de monitorizare</span></div>
      <div class="group">
        <div class="row-stack">
          <div class="grid2">
            <div><label class="label" for="f-start">De la</label><input id="f-start" type="date" value="${h(draft.monitor_start)}"></div>
            <div><label class="label" for="f-end">Până la</label><input id="f-end" type="date" value="${h(draft.monitor_end)}"></div>
          </div>
          <p class="hint">Gol la „Până la” = până la ultima zi de plecare.</p>
        </div>
        <div class="row-stack">
          <span class="label">De câte ori pe zi caut</span>
          <div class="seg full" role="group" aria-label="De câte ori pe zi">
            ${[1, 2, 3, 4].map((n) => `<button type="button" data-freq="${n}" aria-pressed="${draft.search_hours.length === n}">${n}×</button>`).join('')}
          </div>
          <div class="hours-grid" id="hours-grid"></div>
          <p class="hint">Ora României. GitHub poate porni căutarea cu 5–20 de minute mai târziu.
            O alertă nouă sau modificată se caută imediat după salvare.</p>
        </div>
      </div>`}

      <div class="section-label"><span>Companii aeriene</span></div>
      <div class="group">
        ${toggle('f-any-airline', draft.anyAirline, 'Oricare companie')}
        <div class="row-stack" id="airline-box" ${draft.anyAirline ? 'hidden' : ''}>
          <div class="chips">${cfg.airlines.map((a) => `
            <label class="chip" title="${h(a.codes.join(', '))}"><input type="checkbox" name="airline" value="${h(a.id)}" ${draft.airlineGroups.has(a.id) ? 'checked' : ''}>
            <span>${h(a.name)}</span></label>`).join('')}
          </div>
          <label class="label" for="f-extra-airlines" style="margin-top:12px">Alte coduri IATA (opțional)</label>
          <input type="text" id="f-extra-airlines" placeholder="ex. VY, U2" value="${h(draft.extraAirlines)}" autocapitalize="characters">
        </div>
        <div id="complete-box" ${draft.anyAirline ? 'hidden' : ''}>
          ${toggle('f-complete', draft.complete_airlines, 'Verifică fiecare companie aleasă',
            'Dacă una lipsește din rezultat, mai caut o dată doar pentru ea: +1 credit pe combinație, doar când e nevoie')}
        </div>
      </div>

      <div class="section-label"><span>Preț și pasageri</span></div>
      <div class="group">
        <div class="row-stack">
          <label class="label" for="f-price" id="price-label"></label>
          <div class="price-input">
            <input id="f-price" type="number" inputmode="numeric" min="1" step="1" placeholder="250" value="${h(draft.max_price)}">
            <div class="seg" role="group" aria-label="Moneda">
              <button type="button" data-cur="EUR" aria-pressed="${draft.currency === 'EUR'}">EUR</button>
              <button type="button" data-cur="RON" aria-pressed="${draft.currency === 'RON'}">RON</button>
            </div>
          </div>
        </div>
        ${stepper('f-adults', draft.adults, 1, 9, 'Adulți')}
        ${stepper('f-bags', draft.bags, 0, draft.adults, 'Bagaje de mână', 'troler în cabină')}
        <div class="row-stack">
          <span class="label">Număr maxim de escale</span>
          <div class="seg full" role="group" aria-label="Număr maxim de escale">
            ${[[null, 'Oricâte'], [0, 'Direct'], [1, 'Max. 1'], [2, 'Max. 2']].map(([v, l]) => `
              <button type="button" data-stops="${v === null ? '' : v}" aria-pressed="${draft.max_stops === v}">${l}</button>`).join('')}
          </div>
        </div>
        ${isSearch ? `<div id="return-box">${toggle('f-return', draft.return_details, 'Detalii zbor de întoarcere', 'Pentru cel mai ieftin zbor: +1 credit pe combinație')}</div>` : ''}
      </div>

      <div class="section-label"><span>${isSearch ? 'Cost' : 'Consum de căutări'}</span></div>
      <div class="card budget-card" id="budget-box"></div>

      ${original ? `<button type="button" class="btn danger block" id="delete-btn" style="margin-top:18px">${icon('trash', 18)} Șterge alerta</button>` : ''}
    </form>

    <dialog class="sheet" id="dest-sheet" aria-label="Alege destinația"></dialog>
    <dialog class="modal" id="json-dialog"></dialog>
    <dialog class="modal" id="password-dialog"></dialog>
  `;

  // Bara fixă de jos cu estimarea și butonul Salvează (în afara <main>)
  document.getElementById('savebar')?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="savebar" id="savebar"><div class="savebar-inner">
      <div class="savebar-info" id="savebar-info"></div>
      <button type="submit" form="alert-form" class="btn primary" id="save-btn">${isSearch ? `${icon('search', 16)} Caută acum` : hasWriteAccess() ? 'Salvează' : 'Pregătește'}</button>
    </div></div>`);

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
      ? `<span class="row-sub">${d.parts?.length > 1 ? `${d.parts.length} destinații, căutate împreună` : 'Destinația'}</span>
         <b>${destFlag(d) ? `${destFlag(d)} ` : ''}${h(d.name)}</b><span class="row-sub">${h(d.codes.join(', '))}</span>`
      : '<span class="row-title">Alege destinația</span><span class="row-sub">Una sau mai multe: oraș, țară sau cod IATA</span>'}</span>
    <span class="chev muted">${icon('chevron', 18)}</span>`;
}

/** Mai multe destinații -> una singură, cu toate codurile (căutată într-un singur apel). */
function mergeDestinations(parts) {
  if (!parts.length) return null;
  if (parts.length === 1) return { id: parts[0].id, name: parts[0].name, codes: [...parts[0].codes] };
  return {
    id: `multi:${parts.map((p) => p.id).join('+')}`,
    name: parts.map((p) => p.name.replace(/\s*\(toate[^)]*\)/i, '')).join(' / '),
    codes: [...new Set(parts.flatMap((p) => p.codes))],
    parts: parts.map((p) => ({ id: p.id, name: p.name, codes: p.codes })),
  };
}

function openDestinationSheet() {
  const sheet = document.getElementById('dest-sheet');
  sheet.innerHTML = `
    <div class="sheet-head">
      <div class="sheet-grip"></div>
      <div class="sheet-title"><h2>Destinații</h2>
        <button type="button" class="btn primary sm" id="sheet-done">Gata</button></div>
      <div class="search-box">${icon('search', 18)}<input type="search" id="dest-search" placeholder="Caută: Roma, Bali, Japonia, FCO…" autocomplete="off"></div>
      <div class="dest-selected" id="dest-selected"></div>
    </div>
    <div class="sheet-body">
      <div id="dest-list"></div>
      <div class="section-label"><span>Nu o găsești? Adaug-o</span></div>
      <div class="group"><div class="row-stack">
        <label class="label" for="nd-name">Nume</label>
        <input type="text" id="nd-name" placeholder="ex. Mauritius">
        <div class="grid2" style="margin-top:10px">
          <div><label class="label" for="nd-codes">Cod(uri) IATA</label><input type="text" id="nd-codes" placeholder="MRU" autocapitalize="characters"></div>
          <div><label class="label" for="nd-country">Țara</label><input type="text" id="nd-country" placeholder="Mauritius"></div>
        </div>
        ${hasWriteAccess() ? '<label class="check small" style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="nd-save" checked> Salvează în lista mea</label>' : ''}
        <button type="button" class="btn tonal block" id="nd-add" style="margin-top:12px">Folosește destinația</button>
        <p class="hint">Codul IATA îl găsești căutând „cod IATA aeroport &lt;oraș&gt;”. Mai multe coduri se separă prin virgulă.</p>
      </div></div>
    </div>`;

  const search = sheet.querySelector('#dest-search');
  const list = sheet.querySelector('#dest-list');
  const selectedBox = sheet.querySelector('#dest-selected');
  const MAX_CODES = 7;
  // selecția curentă (poate avea mai multe destinații, căutate împreună într-un singur apel)
  let picked = draft.destination ? (draft.destination.parts || [draft.destination]).map((p) => ({ ...p })) : [];
  const totalCodes = () => new Set(picked.flatMap((p) => p.codes)).size;
  const drawSelected = () => {
    selectedBox.innerHTML = picked.length ? `${picked.map((p) => `
      <button type="button" class="dest-chip" data-unpick="${h(p.id)}">${destFlag(p) ? `${destFlag(p)} ` : ''}${h(p.name)} ${icon('close', 12)}</button>`).join('')}
      <span class="small ${totalCodes() > MAX_CODES ? 'bad-text' : 'muted'}">${totalCodes()} aeroporturi${totalCodes() > MAX_CODES ? ` (maxim ${MAX_CODES})` : ''}</span>`
      : '<span class="small muted">Atinge una sau mai multe destinații. Toate se caută împreună, fără credite în plus.</span>';
    selectedBox.querySelectorAll('[data-unpick]').forEach((b) => b.addEventListener('click', () => {
      picked = picked.filter((p) => p.id !== b.dataset.unpick);
      drawSelected();
      draw();
    }));
  };
  const draw = () => {
    const q = fold(search.value.trim());
    let items = state.config.destinations;
    if (q) {
      items = items.filter((d) => fold(`${d.name} ${d.country} ${d.codes.join(' ')} ${d.id}`).includes(q));
      items = [...items].sort((a, b) => (fold(b.id) === q) - (fold(a.id) === q));
    }
    items = items.slice(0, 120);
    const groups = [];
    for (const d of items) {
      const g = `${d.country} · ${d.region}`;
      if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, items: [] });
      groups[groups.length - 1].items.push(d);
    }
    list.innerHTML = groups.map(({ g, items: its }) => `
      <div class="pick-group">${countryFlag(its[0].country) ? `${countryFlag(its[0].country)} ` : ''}${h(g)}</div>
      <div class="group">${its.map((d) => `
        <button type="button" class="pick-item ${picked.some((p) => p.id === d.id) ? 'picked' : ''}" data-id="${h(d.id)}" aria-pressed="${picked.some((p) => p.id === d.id)}">
          <span class="pick-code ${d.codes.length > 1 ? 'multi' : ''}">${d.codes.length > 1 ? `${d.codes.length}×` : h(d.codes[0])}</span>
          <span class="row-main"><span class="row-title">${h(d.name)}</span>${d.codes.length > 1 ? `<span class="row-sub">${h(d.codes.join(', '))}</span>` : ''}</span>
          <span class="pick-check">${icon('check', 14)}</span>
        </button>`).join('')}</div>`).join('')
      || '<p class="muted" style="padding:16px 4px">Nicio destinație găsită. Adaug-o mai jos după codul IATA.</p>';
  };
  draw();
  drawSelected();
  search.addEventListener('input', draw);

  const toggle = (dest) => {
    picked = picked.some((p) => p.id === dest.id) ? picked.filter((p) => p.id !== dest.id) : [...picked, dest];
    drawSelected();
    draw();
  };
  list.addEventListener('click', (e) => {
    const b = e.target.closest('.pick-item');
    if (!b) return;
    const d = state.config.destinations.find((x) => x.id === b.dataset.id);
    toggle({ id: d.id, name: d.name, codes: [...d.codes] });
  });
  sheet.querySelector('#sheet-done').onclick = () => {
    if (totalCodes() > MAX_CODES) {
      toast(`Prea multe aeroporturi (${totalCodes()}). Maxim ${MAX_CODES} într-o căutare.`);
      return;
    }
    draft.destination = mergeDestinations(picked);
    renderDestination();
    renderBudget();
    sheet.close();
  };
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

  sheet.querySelector('#nd-add').onclick = async () => {
    const name = sheet.querySelector('#nd-name').value.trim();
    const codes = parseCodes(sheet.querySelector('#nd-codes').value, 3);
    const country = sheet.querySelector('#nd-country').value.trim() || 'Altele';
    if (!name || !codes.length) {
      toast('Completează numele și cel puțin un cod IATA de 3 litere');
      return;
    }
    const dest = { id: codes.join('-'), name, country, region: 'Adăugate de mine', codes };
    if (sheet.querySelector('#nd-save')?.checked) {
      try {
        await saveCustomDestination(dest);
        state.config.destinations = [{ ...dest, custom: true }, ...state.config.destinations.filter((d) => d.id !== dest.id)];
        toast('Destinația a fost salvată în lista ta');
      } catch (e) {
        toast(`Folosită, dar nesalvată în listă: ${e.message}`, 6000);
      }
    }
    if (!picked.some((p) => p.id === dest.id)) picked.push({ id: dest.id, name, codes });
    drawSelected();
    draw();
    toast('Destinația a fost adăugată în selecție');
  };

  sheet.showModal();
  setTimeout(() => search.focus(), 250);
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
        <input type="date" class="dep-date" min="${today}" value="${h(d.date)}" aria-label="Data plecării ${i + 1}">
        ${oneWay ? '' : `<input type="text" class="dep-nights" inputmode="text" placeholder="nopți: 4, 5" value="${h(d.nights)}" aria-label="Nopți pentru plecarea ${i + 1}">`}
        <button type="button" class="icon-btn dep-del" aria-label="Șterge ziua ${i + 1}" ${draft.departures.length === 1 ? 'disabled' : ''}>${icon('trash', 17)}</button>
      </div>
      ${oneWay ? '' : `<div class="dep-returns">${returnsText(d) || '<span class="muted" style="background:none;padding:0">Alege data și numărul de nopți</span>'}</div>`}
    </div>`).join('');
  syncTripTexts();
}

/** Textele care depind de tipul călătoriei (dus-întors / doar dus). */
function syncTripTexts() {
  const oneWay = draft.trip_type === 'one_way';
  const note = document.getElementById('dep-note');
  if (note) {
    note.textContent = oneWay
      ? 'Fiecare zi de plecare înseamnă o căutare. Poți adăuga mai multe zile ca să compari prețurile.'
      : 'Poți scrie mai multe variante de nopți separate prin virgulă (ex. „4, 5”). Data întoarcerii = plecarea + nopțile.';
  }
  const label = document.getElementById('price-label');
  if (label) {
    label.textContent = mode === 'search'
      ? `Preț maxim ${oneWay ? 'doar dus' : 'dus-întors'} (opțional, doar pentru evidențiere)`
      : `Preț maxim ${oneWay ? 'doar dus' : 'dus-întors'} (total, toți pasagerii)`;
  }
  const ret = document.getElementById('return-box');
  if (ret) ret.hidden = oneWay;
}

// ---------------------------------------------------------------------------
// Estimarea bugetului de căutări
// ---------------------------------------------------------------------------
function renderBudget() {
  const box = document.getElementById('budget-box');
  if (!box) return;
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
    ${!alert.active ? `<div class="banner info" style="margin-top:0">${icon('pause', 16)}<div>Alerta este oprită și nu consumă căutări.</div></div>` : ''}
    <div class="nums">
      <div><b>${mine.perDay}</b> <span>căutări / zi</span></div>
      <div style="text-align:right"><b>~${mine.perMonth}</b> <span>în 30 de zile</span></div>
    </div>
    <div class="small muted" style="margin-bottom:6px">${combos} ${combos === 1 ? 'combinație' : 'combinații'} × ${alert.search_hours.length} ${alert.search_hours.length === 1 ? 'căutare' : 'căutări'} pe zi</div>
    <div class="meter ${level}"><div style="width:${Math.min(100, ratio * 100)}%"></div></div>
    <div class="small ${level === 'bad' ? 'bad-text' : 'muted'}" style="margin-top:6px">
      Toate alertele: <b>~${all.perMonth}</b> din ${limit} pe lună${level === 'bad' ? ' — depășești limita!' : level === 'warn' ? ' — aproape de limită' : ''}</div>
    <p>${mine.extraMax ? `Când o combinație e sub prag, se face încă o căutare pentru zborul de întoarcere (maxim ${mine.extraMax} în 30 de zile).` : ''}
      ${alert.complete_airlines ? `Verificarea fiecărei companii poate adăuga până la ${mine.perMonth} căutări în 30 de zile (doar când lipsește o companie).` : ''}
      ${left !== undefined && left !== null ? `Credite rămase: <b>${left}</b>.` : ''}</p>`;

  const info = document.getElementById('savebar-info');
  if (info) {
    info.innerHTML = `<b class="${level === 'bad' ? 'bad' : ''}">${mine.perDay} căutări/zi · ~${mine.perMonth}/lună</b>
      total ~${all.perMonth} din ${limit}`;
  }
}

/** Costul unei căutări rapide (credite consumate o singură dată). */
function renderSearchCost(box) {
  const today = todayRO();
  const req = buildAlert();
  const n = combinations(req, today).length;
  const complete = draft.complete_airlines && !draft.anyAirline ? n : 0;
  const extra = (draft.return_details && draft.trip_type !== 'one_way' ? n : 0) + complete;
  const max = state.config.settings.one_time_max_searches || 20;
  const left = state.status?.searches_left_after ?? state.status?.searches_left_before;
  const tooMany = n > max;
  const notEnough = left !== undefined && left !== null && n + extra > left;
  box.innerHTML = `
    <div class="nums">
      <div><b class="${tooMany || notEnough ? 'bad-text' : ''}">${n}${extra ? `–${n + extra}` : ''}</b> <span>credite</span></div>
      <div style="text-align:right"><b>${n}</b> <span>${n === 1 ? 'combinație' : 'combinații'}</span></div>
    </div>
    ${tooMany ? `<div class="small bad-text">Maxim ${max} combinații pe căutare.</div>` : ''}
    ${notEnough ? `<div class="small bad-text">Nu ai destule credite (rămase: ${left}).</div>` : ''}
    <p>1 credit pentru fiecare combinație${extra - complete ? ', plus până la 1 credit pentru detaliile întoarcerii' : ''}${complete
      ? ', plus până la 1 credit dacă lipsește vreo companie aleasă' : ''}.
      ${left !== undefined && left !== null ? `Credite rămase: <b>${left}</b>.` : ''}
      Dacă parola e greșită, nu se consumă nimic.</p>`;
  const info = document.getElementById('savebar-info');
  if (info) {
    info.innerHTML = `<b class="${tooMany || notEnough ? 'bad' : ''}">${n}${extra ? `–${n + extra}` : ''} credite</b>
      ${n} ${n === 1 ? 'combinație' : 'combinații'}, o singură dată`;
  }
}

/** Cere parola de căutare (sau o folosește pe cea memorată până la închiderea aplicației). */
function askPassword(app) {
  let remembered = '';
  try { remembered = sessionStorage.getItem(PASSWORD_KEY) || ''; } catch { /* indisponibil */ }
  if (remembered) return Promise.resolve(remembered);
  const dlg = app.querySelector('#password-dialog');
  dlg.innerHTML = `
    <form method="dialog" id="pw-form">
      <h2>${icon('key', 18, 'inline')} Parola de căutare</h2>
      <p>Parola nu pleacă de pe telefon: se trimite doar o semnătură, verificată de GitHub cu secretul <code>SEARCH_PASSWORD</code>.</p>
      <input type="password" id="pw-input" autocomplete="current-password" placeholder="Parola" required>
      <label class="small" style="display:flex;gap:8px;align-items:center;margin-top:10px">
        <input type="checkbox" id="pw-remember"> Ține minte până închid aplicația</label>
      <div class="btn-row">
        <button type="button" class="btn" id="pw-cancel">Renunță</button>
        <button type="submit" class="btn primary">Caută</button>
      </div>
    </form>`;
  return new Promise((resolve) => {
    dlg.querySelector('#pw-cancel').onclick = () => { dlg.close(); resolve(null); };
    dlg.querySelector('#pw-form').onsubmit = (e) => {
      e.preventDefault();
      const pw = dlg.querySelector('#pw-input').value;
      if (!pw) return;
      if (dlg.querySelector('#pw-remember').checked) {
        try { sessionStorage.setItem(PASSWORD_KEY, pw); } catch { /* indisponibil */ }
      }
      dlg.close();
      resolve(pw);
    };
    dlg.showModal();
    setTimeout(() => dlg.querySelector('#pw-input').focus(), 50);
  });
}

/** Trimite căutarea rapidă: semnează cererea și o scrie în data/searches/<id>.json. */
async function submitSearch(app, errBox) {
  const req = buildSearchRequest();
  const password = await askPassword(app);
  if (!password) return;
  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Se trimite…';
  try {
    const text = JSON.stringify(req);
    const sig = await signSearch(req.id, text, password);
    const doc = { id: req.id, status: 'pending', created_at: req.created_at, request: text, sig };
    await createFile(`data/searches/${req.id}.json`, JSON.stringify(doc, null, 2) + '\n', `Căutare rapidă: ${req.title}`);
    await successCheck('Căutare trimisă');
    toast('Rezultatele apar în 1–2 minute.', 4000);
    location.hash = `#/cautare/${encodeURIComponent(req.id)}`;
  } catch (err) {
    errBox.innerHTML = `<div class="banner bad">${icon('warning', 18)}<div><b>Nu am putut porni căutarea.</b><br>${h(err.message)}</div></div>`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    btn.disabled = false;
    btn.innerHTML = `${icon('search', 16)} Caută acum`;
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
    if (t.id === 'f-extra-airports') draft.extraAirports = t.value;
    if (t.id === 'f-extra-airlines') draft.extraAirlines = t.value;
    if (t.id === 'f-price') draft.max_price = t.value;
    if (t.classList.contains('dep-date') || t.classList.contains('dep-nights')) {
      const card = t.closest('.dep-card');
      const d = draft.departures[Number(card.dataset.i)];
      if (t.classList.contains('dep-date')) d.date = t.value;
      else d.nights = t.value;
      const returns = card.querySelector('.dep-returns');
      if (returns) returns.innerHTML = returnsText(d)
        || '<span class="muted" style="background:none;padding:0">Alege data și numărul de nopți</span>';
    }
    renderBudget();
  });

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'f-active') draft.active = t.checked;
    if (t.name === 'airport') t.checked ? draft.airports.add(t.value) : draft.airports.delete(t.value);
    if (t.name === 'airline') t.checked ? draft.airlineGroups.add(t.value) : draft.airlineGroups.delete(t.value);
    if (t.id === 'f-any-airline') {
      draft.anyAirline = t.checked;
      app.querySelector('#airline-box').hidden = t.checked;
      app.querySelector('#complete-box').hidden = t.checked;
    }
    if (t.id === 'f-return') draft.return_details = t.checked;
    if (t.id === 'f-complete') draft.complete_airlines = t.checked;
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
        <select data-hour-index="${i}" aria-label="Ora căutării ${i + 1}">
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
      errBox.innerHTML = `<div class="banner bad">${icon('warning', 18)}<div><b>Mai ai de completat:</b>
        <ul>${errors.map((x) => `<li>${h(x)}</li>`).join('')}</ul></div></div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    errBox.innerHTML = '';
    if (mode === 'search') {
      if (!hasWriteAccess()) {
        errBox.innerHTML = `<div class="banner warn">${icon('key', 18)}<div>Pentru căutarea rapidă ai nevoie de tokenul GitHub.
          Adaugă-l în <a href="#/setari">Setări</a>.</div></div>`;
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
    btn.textContent = 'Se salvează…';
    try {
      const doc = await saveAlert(alert);
      state.alerts = doc.alerts;
      await successCheck(original ? 'Alertă actualizată' : 'Alertă creată');
      toast('Căutarea pornește în 1–2 minute.', 4000);
      location.hash = `#/alerta/${encodeURIComponent(alert.id)}`;
    } catch (err) {
      errBox.innerHTML = `<div class="banner bad">${icon('warning', 18)}<div><b>Nu am putut salva.</b><br>${h(err.message)}</div></div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      btn.disabled = false;
      btn.textContent = 'Salvează';
    }
  });

  app.querySelector('#delete-btn')?.addEventListener('click', async () => {
    if (!hasWriteAccess()) {
      toast('Pentru ștergere adaugă tokenul GitHub în Setări sau editează data/alerts.json.', 6000);
      return;
    }
    if (!confirm(`Ștergi alerta „${original.name}”?`)) return;
    try {
      const doc = await deleteAlert(original.id, original.name);
      state.alerts = doc.alerts;
      toast('Alerta a fost ștearsă');
      location.hash = '#/';
    } catch (err) {
      toast(`Nu am putut șterge: ${err.message}`, 6000);
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
    <h2>Salvează alerta manual</h2>
    <p>Fără token, aplicația nu poate salva singură. Copiază textul și înlocuiește tot conținutul fișierului
    <code>data/alerts.json</code> pe GitHub, apoi apasă „Commit changes”.</p>
    <textarea readonly rows="8">${h(text)}</textarea>
    <div class="btn-row">
      <button type="button" class="btn primary" id="dlg-copy">${icon('copy', 16)} Copiază</button>
      ${links.editAlerts ? `<a class="btn tonal" href="${links.editAlerts}" target="_blank" rel="noopener">GitHub ${icon('external', 14)}</a>` : ''}
    </div>
    <button type="button" class="btn block" id="dlg-close" style="margin-top:8px">Închide</button>`;
  dlg.querySelector('#dlg-copy').onclick = async () => toast((await copyText(text)) ? 'Copiat!' : 'Nu am putut copia automat');
  dlg.querySelector('#dlg-close').onclick = () => dlg.close();
  dlg.showModal();
}
