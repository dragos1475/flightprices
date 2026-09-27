// Ecranul 3: detaliul unei alerte – preț curent, grafic, combinații și toate zborurile.

import { alertStatus } from '../budget.js';
import { renderChart, SERIES_COLORS } from '../chart.js';
import { hasWriteAccess, saveAlert } from '../data.js';
import { icon } from '../icons.js';
import { bindResults, maxStopsOf, newView, resultsSections, stopsLabel } from '../results-view.js';
import {
  airlineNames, airportName, ensureAlerts, ensureConfig, loadHistory, loadResults, state, summarize,
} from '../state.js';
import { setNav, skeleton } from '../ui.js';
import { dateTime, dayDate, h, money, shortDate, toast, todayRO } from '../util.js';

// preferințele de afișare (păstrate cât timp aplicația e deschisă)
const view = newView();

export async function renderDetail(app, id) {
  setNav({ title: '', back: '#/' });
  app.innerHTML = skeleton(2);
  await ensureConfig();
  const alerts = await ensureAlerts();
  const alert = alerts.find((a) => a.id === id);
  if (!alert) {
    app.innerHTML = `<div class="card empty"><div class="empty-ico">${icon('info', 28)}</div>
      <h2>Alerta nu există</h2><p>Poate a fost ștearsă.</p><a class="btn primary" href="#/">Înapoi la alerte</a></div>`;
    return;
  }
  const [results, history] = await Promise.all([loadResults(id), loadHistory(id)]);
  const today = todayRO();
  const st = alertStatus(alert, today);
  const sum = summarize(alert, results, today);
  const cur = alert.currency || 'EUR';
  const max = Number(alert.max_price) || 0;

  setNav({
    title: alert.name,
    back: '#/',
    actions: [
      ...(hasWriteAccess() ? [{ icon: alert.active === false ? 'play' : 'pause', label: alert.active === false ? 'Pornește' : 'Oprește', id: 'toggle-active' }] : []),
      { icon: 'edit', label: 'Editează', href: `#/alerta/${encodeURIComponent(alert.id)}/editeaza` },
    ],
  });
  view.flightsShown = 25;

  // Rută: coduri de plecare -> destinație
  const deps = alert.departure_airports || [];
  const destCodes = alert.destination?.codes || [];
  const fromCode = deps.length > 2 ? `${deps[0]} +${deps.length - 1}` : deps.join(' · ');
  const fromPlace = deps.length === 1 ? airportName(deps[0]) : `${deps.length} aeroporturi`;
  const toCode = destCodes.length > 2 ? `${destCodes[0]} +${destCodes.length - 1}` : destCodes.join(' · ');

  // Bara „preț vs. prag”
  const scale = Math.max(max, sum.lowest || 0) * 1.25 || 1;
  const fillPct = sum.lowest !== null ? Math.min(100, (sum.lowest / scale) * 100) : 0;
  const markPct = Math.min(100, (max / scale) * 100);
  const diff = sum.lowest !== null ? max - sum.lowest : null;

  const bestFlight = sum.best?.flights?.[0];

  app.innerHTML = `
    <div class="card hero">
      <div class="hero-route">
        <div class="end"><div class="iata">${h(fromCode)}</div><div class="place">${h(fromPlace)}</div></div>
        <div class="path"><i></i>${icon('plane', 18)}<i></i></div>
        <div class="end"><div class="iata">${h(toCode)}</div><div class="place">${h(alert.destination?.name || '')}</div></div>
      </div>

      <div class="hero-price">
        <div>
          <div class="label">Cel mai mic preț dus-întors</div>
          <div class="price-xl ${sum.under ? 'good-text' : ''}">${sum.lowest !== null ? money(sum.lowest) : '—'}<small>${cur}</small></div>
        </div>
        ${sum.lowest !== null
          ? (sum.under ? `<span class="badge good">${icon('check')}Sub prag</span>` : '<span class="badge">Peste prag</span>')
          : `<span class="badge ${st.cls}">${st.label}</span>`}
      </div>
      ${sum.best ? `<div class="hero-sub">${dayDate(sum.best.outbound_date)} → ${dayDate(sum.best.return_date)} · ${sum.best.nights} nopți${bestFlight ? ` · ${h(bestFlight.airlines.join(' / '))}` : ''}</div>` : ''}

      ${max ? `<div class="threshold-bar ${sum.under ? 'under' : ''}">
        <div class="track"><div class="fill" style="width:${fillPct}%"></div><div class="mark" style="left:calc(${markPct}% - 1px)"></div></div>
        <div class="legend-row"><span>${diff === null ? 'Aștept prima căutare' : diff >= 0
          ? `<span class="good-text">${money(diff, cur)} sub prag</span>` : `${money(-diff, cur)} peste prag`}</span><span>prag ${money(max, cur)}</span></div>
      </div>` : ''}

      <div class="meta-chips">
        <span>${icon('calendar')}${shortDate(alert.monitor_start)} – ${shortDate(alert.monitor_end)}</span>
        <span>${icon('users')}${alert.adults || 1} ${Number(alert.adults) > 1 ? 'adulți' : 'adult'}</span>
        <span>${icon('bag')}${alert.bags || 0} troler${Number(alert.bags) === 1 ? '' : 'e'}</span>
        <span>${icon('zap')}${stopsLabel(maxStopsOf(alert))}</span>
        <span>${icon('plane')}${h(airlineNames(alert.airlines).join(', '))}</span>
      </div>

      ${sum.stale ? `<div class="banner warn">${icon('warning', 18)}<div>Moneda a fost schimbată. Prețurile vor fi în ${cur} după următoarea căutare.</div></div>` : ''}

      ${sum.best?.google_flights_url ? `<a class="btn primary block" style="margin-top:14px" href="${h(sum.best.google_flights_url)}" target="_blank" rel="noopener">
        Vezi pe Google Flights ${icon('external', 16)}</a>` : ''}
      <div class="small muted" style="text-align:center;margin-top:10px">Actualizat ${dateTime(results?.updated_at)}</div>
    </div>

    <div class="section-label"><span>Evoluția prețului minim</span></div>
    <div class="card"><div id="chart"></div></div>

    <div id="results"></div>
  `;

  // Grafic: câte o linie pentru fiecare combinație încă valabilă (culoare fixă după ordinea datelor)
  const activeKeys = sum.combos.map((c) => `${c.outbound_date}_${c.return_date}`).sort();
  const series = activeKeys.slice(0, SERIES_COLORS.length).map((key, i) => {
    const [o, r] = key.split('_');
    return {
      label: `${shortDate(o)}→${shortDate(r)}`,
      color: SERIES_COLORS[i],
      points: (history?.series?.[key] || []).filter((p) => (p.currency || cur) === cur),
    };
  });
  renderChart(app.querySelector('#chart'), { series, threshold: max || null, currency: cur });
  if (activeKeys.length > SERIES_COLORS.length) {
    app.querySelector('#chart').insertAdjacentHTML('beforeend',
      `<p class="small muted" style="margin-top:8px">Graficul arată primele ${SERIES_COLORS.length} combinații din ${activeKeys.length}.</p>`);
  }

  const resultsEl = app.querySelector('#results');
  const ctx = { combos: sum.combos, maxPrice: max, cur, view };
  resultsEl.innerHTML = resultsSections(ctx);
  bindResults(resultsEl, ctx);

  document.getElementById('toggle-active')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const updated = { ...alert, active: alert.active === false, updated_at: new Date().toISOString() };
      const doc = await saveAlert(updated);
      state.alerts = doc.alerts;
      toast(updated.active ? 'Alerta a fost pornită' : 'Alerta a fost oprită');
      renderDetail(app, id);
    } catch (err) {
      toast(err.message, 6000);
      btn.disabled = false;
    }
  });
}
