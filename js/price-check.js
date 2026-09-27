// „Preț la companie”: la cerere, pentru UN zbor, aflăm opțiunile de rezervare (ca în Google Flights →
// „Booking options”) și arătăm prețul vândut direct de companie, separat de agenții (Kiwi, eDreams…).
// Nimic automat: doar când utilizatorul apasă butonul din bilet. Costă 1–2 credite SerpApi.
// Cererea se scrie semnat în data/prices/<id>.json; GitHub Actions (scraper/price_check.py) o procesează.

import { creditsChanged } from './credits.js';
import { convertPrice } from './currency.js';
import { createFile, hasWriteAccess, loadJSON, signSearch } from './data.js';
import { icon } from './icons.js';
import { haptic } from './motion.js';
import { PASSWORD_KEY, askPassword } from './password.js';
import { state } from './state.js';
import { dateTime, h, money, store, toast } from './util.js';

const POLL_MS = 6000;
const MAX_WAIT_MS = 8 * 60 * 1000;
const PENDING_KEY = 'zboruri.price_pending';

const flights = new Map(); // cheia zborului -> {f, cur} (ultimul bilet desenat)
const live = new Map();    // cheia zborului -> starea din sesiunea curentă
const docs = new Map();    // id -> documentul complet (cu toate opțiunile)
let index = new Map();     // cheia zborului -> ultima verificare reușită (din data/prices/index.json)
const polling = new Set();

/** Cheia unui zbor: căutarea + numerele de zbor + ora plecării. */
export function flightKey(f) {
  return `${f.combo?.search_key || ''}|${(f.flight_numbers || []).join(',')}|${f.departure_time || ''}`;
}

const sameFlight = (a, b) => (a.flight_numbers || []).join(',') === (b.flight_numbers || []).join(',')
  && a.departure_time === b.departure_time;

/**
 * Ce trimitem și cât costă; null pentru rezultatele vechi (fără jetoanele Google).
 * - doar dus: jetonul de rezervare al zborului -> 1 credit
 * - dus-întors, zborul pentru care căutarea a aflat deja întoarcerea: jetonul întoarcerii -> 1 credit
 *   (dacă a expirat, GitHub reîncearcă singur prin zborurile de întoarcere: încă 1–2 credite)
 * - dus-întors, restul zborurilor: întâi zborurile de întoarcere, apoi rezervarea -> 2 credite
 */
function plan(f) {
  const c = f.combo;
  if (!c?.search_params) return null;
  if (f.booking_token) return { booking_token: f.booking_token, cost: 1 };
  const ret = c.return_flight;
  const owner = c.return_for || c.flights?.[0];
  if (ret?.booking_token && owner && sameFlight(owner, f)) {
    return {
      booking_token: ret.booking_token,
      departure_token: f.departure_token || null,
      return_flight: {
        flight_numbers: ret.flight_numbers, departure_time: ret.departure_time, stops: ret.stops, airlines: ret.airlines,
      },
      cost: 1,
      fallback: Boolean(f.departure_token),
    };
  }
  if (f.departure_token) return { departure_token: f.departure_token, cost: 2 };
  return null;
}

/** '2026-09-27T23:15:12+03:00' -> '27.09, 23:15' (scurt, pentru bilet) */
function when(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d)) return '';
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

const credits = (n) => `${n} ${n === 1 ? 'credit' : 'credite'}`;

/** Locul din bilet unde apare butonul / rezultatul. */
export function priceSlot(f, ctx) {
  const key = flightKey(f);
  flights.set(key, { f, cur: ctx.cur });
  return `<div class="co" data-fkey="${h(key)}">${slotInner(key)}</div>`;
}

function slotInner(key) {
  const { f, cur } = flights.get(key) || {};
  if (!f) return '';
  const st = live.get(key);
  const airline = f.airlines?.[0] || 'companie';
  const p = plan(f);

  if (st?.phase === 'confirm') {
    const left = state.status?.searches_left_after ?? state.status?.searches_left_before;
    return `<div class="co-box co-confirm">
      <div class="co-text">Verific cât costă zborul direct la <b>${h(airline)}</b>, fără agenții?
        <small>Costă ${credits(p.cost)} SerpApi${p.fallback ? ' (întoarcerea e deja cunoscută; 3 doar dacă Google a schimbat între timp datele)' : ''}${left !== undefined && left !== null ? ` · rămase ${left}` : ''}. Rezultatul apare aici în 1–2 minute.</small></div>
      <div class="co-actions">
        <button type="button" class="btn sm" data-pc="cancel">Renunță</button>
        <button type="button" class="btn primary sm" data-pc="go">${icon('check', 14)} Verifică</button>
      </div></div>`;
  }
  if (st?.phase === 'sending' || st?.phase === 'pending') {
    return `<div class="co-box co-pending"><span class="spinner"></span>
      <span class="co-text"><b>${st.phase === 'sending' ? 'Se trimite cererea…' : `Se verifică prețul la ${h(airline)}…`}</b>
      <small>GitHub întreabă Google Flights · de obicei 1–2 minute. Poți închide ecranul.</small></span></div>`;
  }
  if (st?.phase === 'error') {
    return `<div class="co-box co-error">${icon('warning', 16)}
      <span class="co-text"><b>Nu am putut afla prețul</b><small>${h(st.message)}</small></span>
      ${p ? `<button type="button" class="btn sm" data-pc="check">Încearcă</button>` : ''}</div>`;
  }

  let res = null;
  if (st?.phase === 'done') res = { ...st.doc.result, id: st.doc.id, checked_at: st.doc.processed_at };
  else if (index.has(key)) {
    const e = index.get(key);
    const doc = docs.get(e.id);
    res = doc ? { ...doc.result, id: e.id, checked_at: doc.processed_at } : { ...e, checked_at: e.processed_at || e.created_at };
  }
  if (res) return resultHtml(res, f, cur, Boolean(p));

  if (!p) return '';
  return `<button type="button" class="co-btn" data-pc="check">
    <span class="co-ic">${icon('ticket', 16)}</span>
    <span class="co-text"><b>Preț la companie</b><small>Cât costă direct la ${h(airline)}, fără agenții · ${credits(p.cost)}</small></span>
    ${icon('chevron', 14)}</button>`;
}

/** Rezultatul, integrat în bilet. */
function resultHtml(res, f, cur, canRecheck) {
  const from = res.currency || cur;
  const conv = (v) => {
    const x = convertPrice(v, from, cur);
    return x === null ? { v, c: from } : { v: x, c: cur };
  };
  const show = (v) => { const x = conv(v); return money(x.v, x.c); };
  const airlineP = typeof res.airline_price === 'number' ? conv(res.airline_price) : null;
  const agencyP = typeof res.cheapest_agency_price === 'number' ? conv(res.cheapest_agency_price) : null;

  let main;
  if (airlineP) {
    const opt = (res.options || []).find((o) => o.airline);
    const logo = opt?.logos?.[0];
    main = `<div class="co-main">
      <span class="co-logo">${logo ? `<img src="${h(logo)}" alt="" loading="lazy" onerror="this.remove()">` : icon('check', 16)}</span>
      <span class="co-name">${h(res.airline_name)}<small>vândut direct de companie${opt?.option_title ? ` · ${h(opt.option_title)}` : ''}</small></span>
      <b class="co-price">${money(airlineP.v, airlineP.c)}</b></div>`;
  } else {
    main = `<div class="co-main none">
      <span class="co-logo">${icon('info', 16)}</span>
      <span class="co-name">Compania nu vinde direct<small>pe Google apar doar agenții pentru această variantă</small></span></div>`;
  }

  const notes = [];
  if (airlineP && agencyP && agencyP.c === airlineP.c) {
    const diff = airlineP.v - agencyP.v;
    if (diff > 0) {
      notes.push(`<div class="co-note warn">${h(res.cheapest_agency)} (agenție) e cu <b>${money(diff, airlineP.c)}</b> mai ieftin,
        dar bagajele, modificările și anulările trec prin agenție.</div>`);
    } else {
      notes.push(`<div class="co-note good">${icon('check', 13)} Cel mai bun preț e chiar la companie${agencyP ? ` (agenții de la ${money(agencyP.v, agencyP.c)})` : ''}.</div>`);
    }
  } else if (airlineP && !agencyP) {
    notes.push(`<div class="co-note good">${icon('check', 13)} Doar compania vinde această variantă.</div>`);
  } else if (!airlineP && agencyP) {
    notes.push(`<div class="co-note">Cea mai ieftină agenție: <b>${h(res.cheapest_agency)} ${money(agencyP.v, agencyP.c)}</b>.</div>`);
  }
  if (airlineP && typeof f.price === 'number' && airlineP.c === cur && Math.abs(airlineP.v - f.price) >= 1) {
    notes.push(`<div class="co-note muted">În căutare apărea ${money(f.price, cur)} (cel mai mic preț, de la oricine).</div>`);
  }
  const ret = res.return_flight;
  if (ret) {
    notes.push(`<div class="co-note muted">${icon('plane', 12)} Cu întoarcerea ${h((ret.flight_numbers || []).join(', '))}
      · ${h(dateTime(ret.departure_time).replace(/\.\d{4}/, ''))}${ret.stops ? ` · ${ret.stops} escale` : ' · direct'}</div>`);
  }

  const options = res.options;
  const list = options
    ? `<details class="co-all"><summary>Toate opțiunile de rezervare (${options.length}) ${icon('chevronDown', 13)}</summary>
      ${options.map((o, i) => ({ o, i })).sort((a, b) => Number(b.o.airline) - Number(a.o.airline)).map(({ o, i }) => `<div class="co-opt ${o.airline ? 'airline' : ''}">
        <span class="co-opt-name">${h(o.book_with)}<small>${o.airline ? 'companie' : 'agenție'}${o.option_title ? ` · ${h(o.option_title)}` : ''}${o.separate_tickets ? ' · bilete separate' : ''}${o.baggage?.length ? ` · ${h(o.baggage.slice(0, 2).join(', '))}` : ''}</small></span>
        <b>${o.price === null || o.price === undefined ? '—' : show(o.price)}</b>
        ${validBooking(o) ? `<button type="button" class="btn ${o.airline ? 'primary' : ''} sm" data-pc="book" data-i="${i}">Rezervă</button>` : ''}
      </div>`).join('')}</details>`
    : `<button type="button" class="co-link" data-pc="more" data-id="${h(res.id)}">Toate opțiunile și rezervarea ${icon('chevronDown', 13)}</button>`;

  return `<div class="co-box co-result">
    <div class="co-head"><span class="co-tag">${icon('ticket', 12)} Preț la companie</span>
      <span class="co-when">${h(when(res.checked_at))}${canRecheck ? ` · <button type="button" class="co-link inline" data-pc="check">din nou</button>` : ''}</span></div>
    ${main}${notes.join('')}${list}</div>`;
}

const validBooking = (o) => /^https:\/\/(www\.)?google\.[a-z.]+\//.test(o.booking_url || '');

/** Deschide pagina de rezervare (Google trimite mai departe către companie/agenție). */
function openBooking(o) {
  if (!validBooking(o)) return;
  if (!o.booking_post) {
    window.open(o.booking_url, '_blank', 'noopener');
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = o.booking_url;
  form.target = '_blank';
  new URLSearchParams(o.booking_post).forEach((v, k) => {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = v;
    form.append(input);
  });
  document.body.append(form);
  form.submit();
  form.remove();
}

function refresh(key) {
  document.querySelectorAll(`.co[data-fkey="${CSS.escape(key)}"]`).forEach((el) => {
    el.innerHTML = slotInner(key);
  });
}
function refreshAll(root) {
  root.querySelectorAll('.co[data-fkey]').forEach((el) => { el.innerHTML = slotInner(el.dataset.fkey); });
}

// ---------------------------------------------------------------------------
// Cereri în așteptare (supraviețuiesc închiderii ecranului)
// ---------------------------------------------------------------------------
function pendingList() {
  try {
    return JSON.parse(store.get(PENDING_KEY) || '{}');
  } catch {
    return {};
  }
}
function setPending(key, value) {
  const all = pendingList();
  if (value) all[key] = value;
  else delete all[key];
  store.set(PENDING_KEY, JSON.stringify(all));
}

async function poll(key, id, since) {
  if (polling.has(id)) return;
  polling.add(id);
  try {
    while (Date.now() - since < MAX_WAIT_MS) {
      await new Promise((r) => { setTimeout(r, POLL_MS); });
      const doc = await loadJSON(`data/prices/${id}.json`).catch(() => null);
      if (!doc || doc.status === 'pending') continue;
      docs.set(id, doc);
      setPending(key, null);
      creditsChanged(); // bara de sus arată imediat creditele rămase
      if (doc.status === 'done') {
        live.set(key, { phase: 'done', doc });
        index.set(key, { id, created_at: doc.created_at, processed_at: doc.processed_at, ...doc.result });
        haptic([10, 40, 10]);
      } else {
        if (/parol/i.test(doc.message || '')) {
          try { sessionStorage.removeItem(PASSWORD_KEY); } catch { /* indisponibil */ }
        }
        live.set(key, { phase: 'error', message: doc.message || 'Cererea a fost respinsă.' });
      }
      refresh(key);
      return;
    }
    setPending(key, null);
    live.set(key, { phase: 'error', message: 'GitHub nu a răspuns încă. Verifică tabul Actions sau încearcă mai târziu.' });
    refresh(key);
  } finally {
    polling.delete(id);
  }
}

async function send(key) {
  const { f } = flights.get(key) || {};
  const p = f && plan(f);
  if (!p) return;
  const password = await askPassword({ action: 'Verifică', note: `Preț la companie · ${credits(p.cost)}` });
  if (!password) {
    live.delete(key);
    refresh(key);
    return;
  }
  live.set(key, { phase: 'sending' });
  refresh(key);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const id = `p-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.random().toString(36).slice(2, 6)}`;
  const req = {
    id,
    created_at: d.toISOString(),
    flight_key: key,
    flight_numbers: f.flight_numbers,
    airlines: f.airlines,
    search_params: f.combo.search_params,
    booking_token: p.booking_token || null,
    departure_token: p.departure_token || null,
    return_flight: p.return_flight || null,
  };
  try {
    const text = JSON.stringify(req);
    const sig = await signSearch(id, text, password);
    const doc = { id, status: 'pending', created_at: req.created_at, request: text, sig };
    await createFile(`data/prices/${id}.json`, `${JSON.stringify(doc, null, 2)}\n`,
      `Preț la companie: ${f.flight_numbers.join(', ')}`);
    const since = Date.now();
    setPending(key, { id, since });
    live.set(key, { phase: 'pending', id, since });
    refresh(key);
    poll(key, id, since);
  } catch (err) {
    live.set(key, { phase: 'error', message: err.message });
    refresh(key);
  }
}

async function onClick(e) {
  const btn = e.target.closest('[data-pc]');
  if (!btn) return;
  const slot = btn.closest('.co[data-fkey]');
  if (!slot) return;
  e.preventDefault();
  const key = slot.dataset.fkey;
  const action = btn.dataset.pc;
  if (action === 'check') {
    if (!hasWriteAccess()) {
      toast('Pentru asta ai nevoie de tokenul GitHub (Setări).', 4000);
      return;
    }
    haptic();
    live.set(key, { phase: 'confirm' });
  } else if (action === 'cancel') {
    live.delete(key);
  } else if (action === 'go') {
    send(key);
    return;
  } else if (action === 'more') {
    btn.disabled = true;
    const doc = await loadJSON(`data/prices/${btn.dataset.id}.json`).catch(() => null);
    if (!doc?.result) {
      toast('Nu am putut încărca opțiunile.');
      btn.disabled = false;
      return;
    }
    docs.set(doc.id || btn.dataset.id, doc);
  } else if (action === 'book') {
    const st = live.get(key);
    const e2 = index.get(key);
    const doc = st?.doc || (e2 && docs.get(e2.id));
    const o = doc?.result?.options?.[Number(btn.dataset.i)];
    if (o) openBooking(o);
    return;
  }
  refresh(key);
  if (action === 'more') slot.querySelector('.co-all')?.setAttribute('open', '');
}

/** Leagă butoanele din rezultate și încarcă verificările făcute anterior. */
export function bindPriceChecks(root) {
  if (!root.dataset.pcBound) {
    root.dataset.pcBound = '1';
    root.addEventListener('click', onClick);
  }
  // cereri pornite anterior și încă neterminate
  Object.entries(pendingList()).forEach(([key, { id, since }]) => {
    if (Date.now() - since > MAX_WAIT_MS) {
      setPending(key, null);
      return;
    }
    if (!live.has(key)) live.set(key, { phase: 'pending', id, since });
    poll(key, id, since);
  });
  refreshAll(root);
  loadJSON('data/prices/index.json').then((doc) => {
    const next = new Map();
    (doc?.prices || []).forEach((e) => {
      if (e.status === 'done' && e.flight_key && !next.has(e.flight_key)) next.set(e.flight_key, e);
    });
    index = next;
    refreshAll(root);
  }).catch(() => { /* fără verificări anterioare */ });
}
