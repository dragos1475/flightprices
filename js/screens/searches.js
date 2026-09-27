// Căutările rapide (one-time): istoricul și ecranul cu rezultatul unei căutări.
//
// O căutare este un fișier data/searches/<id>.json:
//   status "pending"  -> scris de aplicație, așteaptă robotul din GitHub Actions
//   status "done"     -> are rezultate
//   status "rejected" -> refuzată (parolă greșită, credite insuficiente etc.), fără credite consumate

import { deleteFile, githubLinks, hasWriteAccess, listDir, loadJSON } from '../data.js';
import { destFlag } from '../flags.js';
import { enablePullToRefresh } from '../gestures.js';
import { renderHeatmap } from '../heatmap.js';
import { icon } from '../icons.js';
import { verdict } from '../insights.js';
import { countUp } from '../motion.js';
import {
  bindResults, comboDates, comboNights, focusCombo, heroRoute, maxStopsOf, newView, resultsSections, shareCombo,
  stopsLabel, tripLabel, verdictCard,
} from '../results-view.js';
import { airlineNames, ensureConfig } from '../state.js';
import { setNav, skeleton } from '../ui.js';
import { dateTime, h, money, shortDate, toast } from '../util.js';

const view = newView();
const POLL_MS = 6000;
const POLL_MAX_MS = 8 * 60 * 1000;

function parseRequest(doc) {
  try {
    return JSON.parse(doc?.request || '{}');
  } catch {
    return {};
  }
}

function summaryOf(id, doc) {
  const req = parseRequest(doc);
  const res = doc?.results || {};
  return {
    id,
    title: req.title || id,
    created_at: doc?.created_at || req.created_at,
    status: doc?.status,
    message: doc?.message,
    lowest_price: res.lowest_price ?? null,
    currency: res.currency || req.currency,
    departures: req.departures || [],
    destination: req.destination,
  };
}

/**
 * Lista căutărilor. index.json este scris de robot; căutările în așteptare
 * (încă neprocesate) le găsim listând folderul (doar cu token).
 */
async function loadSearchList() {
  const index = (await loadJSON('data/searches/index.json').catch(() => null))?.searches || [];
  if (!hasWriteAccess()) return index;
  const files = await listDir('data/searches');
  const ids = new Set(files.filter((f) => f.name.endsWith('.json') && f.name !== 'index.json').map((f) => f.name.slice(0, -5)));
  const known = index.filter((s) => ids.has(s.id));
  const missing = [...ids].filter((id) => !index.some((s) => s.id === id));
  const extra = await Promise.all(missing.map(async (id) => summaryOf(id, await loadJSON(`data/searches/${id}.json`))));
  return [...extra, ...known].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

function statusIcon(status) {
  if (status === 'done') return `<span class="row-icon good">${icon('check', 16)}</span>`;
  if (status === 'rejected') return `<span class="row-icon warn">${icon('warning', 16)}</span>`;
  return `<span class="row-icon"><span class="spinner"></span></span>`;
}

// ---------------------------------------------------------------------------
// Istoricul căutărilor
// ---------------------------------------------------------------------------
export async function renderSearchList(app) {
  setNav({ title: 'Căutare rapidă', large: true, actions: [{ icon: 'refresh', label: 'Reîncarcă', id: 'nav-refresh' }] });
  app.innerHTML = skeleton(2);
  document.getElementById('nav-refresh').onclick = () => renderSearchList(app);
  enablePullToRefresh(() => renderSearchList(app));
  await ensureConfig();
  let list = [];
  let error = '';
  try {
    list = await loadSearchList();
  } catch (e) {
    error = e.message;
  }

  app.innerHTML = `
    <div class="page-head"><h1>Căutare rapidă</h1><p>O singură căutare, acum, protejată cu parolă.</p></div>

    <a class="card search-cta" href="#/cautare/noua">
      <span class="cta-ico">${icon('search', 24)}</span>
      <span class="row-main"><b>Căutare nouă</b><span class="row-sub">Alegi ruta și datele, vezi prețurile în 1–2 minute</span></span>
      <span class="chev">${icon('chevron', 18)}</span>
    </a>
    ${!hasWriteAccess() ? `<a class="banner info" href="#/setari">${icon('key', 18)}<div>Pentru căutări ai nevoie de tokenul GitHub (în <b>Setări</b>) și de parola de căutare.</div></a>` : ''}
    ${error ? `<div class="banner bad">${icon('warning', 18)}<div>${h(error)}</div></div>` : ''}

    <div class="section-label"><span>Istoric</span>${list.length ? `<span class="muted" style="text-transform:none;letter-spacing:0">ultimele ${list.length}</span>` : ''}</div>
    ${list.length ? `<div class="group">${list.map((s) => `
      <a class="row" href="#/cautare/${encodeURIComponent(s.id)}">
        ${statusIcon(s.status)}
        <span class="row-main"><span class="row-title">${s.destination && destFlag(s.destination) ? `${destFlag(s.destination)} ` : ''}${h(s.title)}</span>
          <span class="row-sub">${dateTime(s.created_at)}${s.departures?.length ? ` · plecări ${s.departures.map((d) => shortDate(d.date)).join(', ')}` : ''}</span></span>
        <span class="row-value">${s.status === 'done'
          ? (s.lowest_price !== null ? `<b>${money(s.lowest_price, s.currency)}</b>` : 'fără zboruri')
          : s.status === 'rejected' ? '<span class="badge warn">refuzată</span>' : '<span class="badge info">în lucru</span>'}</span>
      </a>`).join('')}</div>` : `
      <div class="card empty">
        <div class="empty-ico">${icon('search', 28)}</div>
        <h2>Nicio căutare încă</h2>
        <p>Rezultatele căutărilor rapide apar aici (ultimele 30).</p>
      </div>`}
  `;
}

// ---------------------------------------------------------------------------
// Rezultatul unei căutări (se actualizează singur cât timp e „în lucru”)
// ---------------------------------------------------------------------------
export async function renderSearchResult(app, id) {
  const route = location.hash;
  setNav({ title: 'Căutare', back: '#/cautare' });
  app.innerHTML = skeleton(2);
  await ensureConfig();
  const started = Date.now();

  const load = () => loadJSON(`data/searches/${id}.json`).catch(() => null);
  let doc = await load();
  if (!doc) {
    app.innerHTML = `<div class="card empty"><div class="empty-ico">${icon('info', 28)}</div><h2>Căutarea nu există</h2>
      <p>Poate a fost ștearsă (se păstrează ultimele 30).</p><a class="btn primary" href="#/cautare">Înapoi</a></div>`;
    return;
  }

  const draw = () => {
    const req = parseRequest(doc);
    const res = doc.results || {};
    const cur = res.currency || req.currency || 'EUR';
    const maxPrice = Number(req.max_price) || 0;
    const combos = res.combinations || [];
    const best = combos.filter((c) => c.lowest_price !== null && c.lowest_price !== undefined)
      .sort((a, b) => a.lowest_price - b.lowest_price)[0];
    setNav({
      title: req.title || 'Căutare',
      back: '#/cautare',
      actions: hasWriteAccess() ? [
        { icon: 'refresh', label: 'Repetă căutarea', href: `#/cautare/noua/${encodeURIComponent(id)}` },
        { icon: 'trash', label: 'Șterge', id: 'search-delete' },
      ] : [],
    });

    const deps = req.departure_airports || [];
    const hero = heroRoute(deps, req.destination);
    const links = githubLinks();
    const v = doc.status === 'done' ? verdict({ series: [], best, maxPrice, currency: cur }) : null;

    let head = '';
    if (doc.status === 'pending') {
      const secs = Math.round((Date.now() - new Date(doc.created_at || req.created_at).getTime()) / 1000);
      head = `<div class="card pending-card">
        <div class="big-spinner"></div>
        <h2>Caut zboruri…</h2>
        <p class="muted">GitHub pornește căutarea și verifică parola. De obicei durează 1–2 minute.<br>
          Pagina se actualizează singură${secs > 0 ? ` · trimis acum ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : ''}.</p>
        ${links.actions ? `<a class="btn tonal sm" href="${links.actions}" target="_blank" rel="noopener">Vezi rularea în GitHub ${icon('external', 14)}</a>` : ''}
      </div>`;
    } else if (doc.status === 'rejected') {
      head = `<div class="banner bad">${icon('warning', 18)}<div><b>Căutarea a fost refuzată.</b><br>${h(doc.message || '')}</div></div>
        <a class="btn primary block" href="#/cautare/noua/${encodeURIComponent(id)}">Încearcă din nou</a>`;
    }

    app.innerHTML = `
      <div class="card hero" style="${hero.tint ? `--dest-tint:${hero.tint}` : ''}">
        ${hero.html}
        ${doc.status === 'done' ? `
        <div class="hero-price">
          <div>
            <div class="label">Cel mai mic preț ${tripLabel(req)}</div>
            <div class="price-xl ${best && maxPrice && best.lowest_price <= maxPrice ? 'good-text' : ''}">${best
              ? `<span data-count="${best.lowest_price}">${money(best.lowest_price)}</span>` : '—'}<small>${cur}</small></div>
          </div>
          ${maxPrice ? `<span class="small muted">prag ${money(maxPrice, cur)}</span>` : ''}
        </div>
        ${best ? `<div class="hero-sub">${comboDates(best)} · ${comboNights(best)} · ${h((best.flights?.[0]?.airlines || []).join(' / '))}</div>` : ''}` : ''}
        <div class="meta-chips">
          <span>${icon('plane')}${tripLabel(req)}</span>
          <span>${icon('calendar')}${(req.departures || []).map((d) => (req.trip_type === 'one_way' || !(d.nights || []).length
            ? shortDate(d.date) : `${shortDate(d.date)} (${d.nights.join('/')}n)`)).join(', ')}</span>
          <span>${icon('users')}${req.adults || 1} ${Number(req.adults) > 1 ? 'adulți' : 'adult'}</span>
          <span>${icon('bag')}${req.bags || 0} troler${Number(req.bags) === 1 ? '' : 'e'}</span>
          <span>${icon('zap')}${stopsLabel(maxStopsOf(req))}</span>
          <span>${icon('plane')}${h(airlineNames(req.airlines).join(', '))}</span>
        </div>
        ${best?.google_flights_url ? `<div class="btn-row" style="margin-top:14px">
          <a class="btn primary" href="${h(best.google_flights_url)}" target="_blank" rel="noopener">Vezi pe Google Flights ${icon('external', 16)}</a>
          <button type="button" class="btn icon-share" id="hero-share" aria-label="Partajează">${icon('share', 18)}</button>
        </div>` : ''}
        <div class="small muted" style="text-align:center;margin-top:10px">Trimis ${dateTime(doc.created_at || req.created_at)}${doc.processed_at ? ` · procesat ${dateTime(doc.processed_at)}` : ''}</div>
      </div>
      ${head}
      ${verdictCard(v)}
      <div id="heat-section" hidden>
        <div class="section-label"><span>Calendar de prețuri</span></div>
        <div class="card"><div id="heatmap"></div></div>
      </div>
      <div id="results"></div>`;

    if (doc.status === 'done') {
      const el = app.querySelector('#results');
      const ctx = {
        combos, maxPrice, cur, view, oneWay: req.trip_type === 'one_way',
        route: `${deps.join(', ')} → ${req.destination?.name || ''}`,
      };
      el.innerHTML = resultsSections(ctx);
      bindResults(el, ctx);
      const heat = app.querySelector('#heatmap');
      renderHeatmap(heat, { combos, maxPrice, currency: cur, onPick: (c) => focusCombo(el, c) });
      app.querySelector('#heat-section').hidden = heat.hidden;
      app.querySelector('#hero-share')?.addEventListener('click', () => shareCombo(ctx, best));
      if (!animated) {
        countUp(app);
        animated = true;
      }
    }

    document.getElementById('search-delete')?.addEventListener('click', async () => {
      if (!confirm('Ștergi această căutare din istoric?')) return;
      try {
        await deleteFile(`data/searches/${id}.json`, `Căutare ștearsă: ${req.title || id}`);
        toast('Căutarea a fost ștearsă');
        location.hash = '#/cautare';
      } catch (e) {
        toast(e.message, 6000);
      }
    });
  };

  let animated = false;
  draw();

  // Cât timp e „în lucru”, verificăm periodic (doar dacă utilizatorul a rămas pe acest ecran)
  while (doc.status === 'pending' && Date.now() - started < POLL_MAX_MS) {
    await new Promise((r) => { setTimeout(r, POLL_MS); });
    if (location.hash !== route) return;
    const fresh = await load();
    if (fresh) doc = fresh;
    draw();
  }
  if (doc.status === 'pending' && location.hash === route) {
    app.insertAdjacentHTML('beforeend', `<div class="banner warn">${icon('clock', 18)}<div>Durează mai mult decât de obicei.
      Verifică rularea în GitHub → Actions sau revino mai târziu (rezultatul rămâne în istoric).</div></div>`);
  }
}
