// Ecranul 3: detaliul unei alerte – preț curent, verdict, calendar de prețuri, grafic, combinații și zboruri.

import { alertStatus, comboKey, hoursLabel, isOneWay } from '../budget.js';
import { renderChart, SERIES_COLORS } from '../chart.js';
import { currencyToggle, bindCurrencyToggle, convertedNote } from '../currency-ui.js';
import { forDisplay } from '../currency.js';
import { hasWriteAccess, saveAlert } from '../data.js';
import { renderHeatmap } from '../heatmap.js';
import { icon } from '../icons.js';
import { verdict } from '../insights.js';
import { celebrate, countUp } from '../motion.js';
import {
  bindResults, comboDates, comboNights, decorateHero, focusCombo, heroRoute, maxStopsOf, newView, resultsSections,
  shareCombo, stopsLabel, tripLabel, verdictCard,
} from '../results-view.js';
import { fillTrip, tripDates, tripSection } from '../trip.js';
import {
  airlineNames, ensureAlerts, ensureConfig, loadHistory, loadResults, state, summarize,
} from '../state.js';
import { overallMinSeries, setNav, skeleton, vtName } from '../ui.js';
import { dateTime, h, money, shortDate, toast, todayRO } from '../util.js';

// preferințele de afișare (păstrate cât timp aplicația e deschisă)
const view = newView();

export async function renderDetail(app, id) {
  const route = location.hash;
  setNav({ title: '', back: '#/' });
  await ensureConfig();
  const alerts = await ensureAlerts();
  const alert = alerts.find((a) => a.id === id);
  if (!alert) {
    app.innerHTML = `<div class="card empty"><div class="empty-ico">${icon('info', 28)}</div>
      <h2>Alert not found</h2><p>It may have been deleted.</p><a class="btn primary" href="#/">Back to alerts</a></div>`;
    return;
  }

  // Dacă venim din listă, datele sunt deja în memorie: afișăm imediat, apoi verificăm dacă există ceva mai nou
  const cached = id in state.results;
  if (cached) {
    draw(app, alert, state.results[id], state.history[id], true);
  } else {
    app.innerHTML = skeleton(2);
  }
  const before = state.results[id]?.updated_at;
  const [results, history] = await Promise.all([loadResults(id), loadHistory(id)]);
  if (location.hash !== route) return;
  if (!cached || results?.updated_at !== before) draw(app, alert, results, history, !cached);
}

function draw(app, rawAlert, rawResults, rawHistory, animate) {
  // prețurile se afișează în moneda aleasă (EUR/RON); datele salvate rămân neschimbate
  const disp = forDisplay(rawAlert, rawResults, rawHistory);
  const { alert, results, history } = disp;
  const id = alert.id;
  const today = todayRO();
  const st = alertStatus(alert, today);
  const sum = summarize(alert, results, today);
  const cur = alert.currency || 'EUR';
  const max = Number(alert.max_price) || 0;
  const vt = vtName(id);

  setNav({
    title: alert.name,
    back: '#/',
    actions: [
      ...(hasWriteAccess() ? [{ icon: rawAlert.active === false ? 'play' : 'pause', label: rawAlert.active === false ? 'Resume' : 'Pause', id: 'toggle-active' }] : []),
      { icon: 'edit', label: 'Edit', href: `#/alerta/${encodeURIComponent(alert.id)}/editeaza` },
    ],
  });
  view.flightsShown = 25;

  const deps = alert.departure_airports || [];
  const routeLabel = `${deps.join(', ')} → ${alert.destination?.name || ''}`;
  const hero = heroRoute(deps, alert.destination);

  // Bara „preț vs. prag”
  const scale = Math.max(max, sum.lowest || 0) * 1.25 || 1;
  const fillPct = sum.lowest !== null ? Math.min(100, (sum.lowest / scale) * 100) : 0;
  const markPct = Math.min(100, (max / scale) * 100);
  const diff = sum.lowest !== null ? max - sum.lowest : null;
  const bestFlight = sum.best?.flights?.[0];

  // Verdict din istoric (minimul zilnic pe toată alerta) + datele Google
  const keys = sum.combos.map(comboKey);
  const overall = overallMinSeries(history, keys, cur);
  const v = !sum.stale && st.key !== 'expired' ? verdict({ series: overall, best: sum.best, maxPrice: max, currency: cur }) : null;

  app.innerHTML = `
    <div class="card hero" style="view-transition-name:${vt};${hero.tint ? `--dest-tint:${hero.tint}` : ''}">
      ${hero.html}

      <div class="hero-price">
        <div>
          <div class="label">Lowest price · ${tripLabel(alert)}</div>
          <div class="price-xl ${sum.under ? 'good-text' : ''}" style="view-transition-name:${vt}-price">${sum.lowest !== null
            ? `<span data-count="${sum.lowest}">${money(sum.lowest)}</span>` : '—'}<small>${cur}</small></div>
        </div>
        <div class="hero-side">
          ${sum.lowest !== null
            ? (sum.under ? `<span class="badge good">${icon('check')}Under target</span>` : '<span class="badge">Over target</span>')
            : `<span class="badge ${st.cls}">${st.label}</span>`}
          ${currencyToggle(rawResults?.currency || rawAlert.currency || 'EUR', cur)}
        </div>
      </div>
      ${sum.best ? `<div class="hero-sub">${comboDates(sum.best)} · ${comboNights(sum.best)}${bestFlight ? ` · ${h(bestFlight.airlines.join(' / '))}` : ''}</div>` : ''}
      ${convertedNote(disp)}

      ${max ? `<div class="threshold-bar ${sum.under ? 'under' : ''}">
        <div class="track"><div class="fill" style="width:${fillPct}%"></div><div class="mark" style="left:calc(${markPct}% - 1px)"></div></div>
        <div class="legend-row"><span>${diff === null ? 'Waiting for the first search' : diff >= 0
          ? `<span class="good-text">${money(diff, cur)} under target</span>` : `${money(-diff, cur)} over target`}</span><span>target ${money(max, cur)}</span></div>
      </div>` : ''}

      <div class="meta-chips">
        <span>${icon('plane')}${tripLabel(alert)}</span>
        <span>${icon('calendar')}${shortDate(alert.monitor_start)} – ${shortDate(alert.monitor_end)}</span>
        <span>${icon('clock')}${hoursLabel(alert)}</span>
        <span>${icon('users')}${alert.adults || 1} ${Number(alert.adults) > 1 ? 'adults' : 'adult'}</span>
        <span>${icon('bag')}${alert.bags || 0} carry-on${Number(alert.bags) === 1 ? '' : 's'}</span>
        <span>${icon('zap')}${stopsLabel(maxStopsOf(alert))}</span>
        <span>${icon('plane')}${h(airlineNames(alert.airlines).join(', '))}</span>
      </div>

      ${sum.stale ? `<div class="banner warn">${icon('warning', 18)}<div>The currency was changed. Prices will be in ${cur} after the next search.</div></div>` : ''}

      ${sum.best?.google_flights_url ? `<div class="btn-row" style="margin-top:14px">
        <a class="btn primary" href="${h(sum.best.google_flights_url)}" target="_blank" rel="noopener">View on Google Flights ${icon('external', 16)}</a>
        <button type="button" class="btn icon-share" id="hero-share" aria-label="Share">${icon('share', 18)}</button>
      </div>` : ''}
      <div class="small muted" style="text-align:center;margin-top:10px">Updated ${dateTime(results?.updated_at)}</div>
    </div>

    ${verdictCard(v)}

    ${tripSection()}

    <div id="heat-section">
      <div class="section-label"><span>Price calendar</span></div>
      <div class="card"><div id="heatmap"></div></div>
    </div>

    <div class="section-label"><span>Lowest price trend</span></div>
    <div class="card"><div id="chart"></div></div>

    <div id="results"></div>
  `;

  // Grafic: câte o linie pentru fiecare combinație încă valabilă (culoare fixă după ordinea datelor)
  const activeKeys = [...keys].sort();
  const series = activeKeys.slice(0, SERIES_COLORS.length).map((key, i) => {
    const [o, r] = key.split('_');
    return {
      label: r ? `${shortDate(o)}→${shortDate(r)}` : shortDate(o),
      color: SERIES_COLORS[i],
      points: (history?.series?.[key] || []).filter((p) => (p.currency || cur) === cur),
    };
  });
  renderChart(app.querySelector('#chart'), { series, threshold: max || null, currency: cur, animate });
  if (activeKeys.length > SERIES_COLORS.length) {
    app.querySelector('#chart').insertAdjacentHTML('beforeend',
      `<p class="small muted" style="margin-top:8px">The chart shows the first ${SERIES_COLORS.length} of ${activeKeys.length} combinations.</p>`);
  }

  const resultsEl = app.querySelector('#results');
  const ctx = {
    combos: sum.combos, maxPrice: max, cur, view, oneWay: isOneWay(alert), route: routeLabel, airlineCodes: alert.airlines,
  };
  resultsEl.innerHTML = resultsSections(ctx);
  bindResults(resultsEl, ctx);

  // Calendarul de prețuri: atingerea unui pătrat deschide combinația respectivă
  const heat = app.querySelector('#heatmap');
  renderHeatmap(heat, { combos: sum.combos, maxPrice: max, currency: cur, onPick: (c) => focusCombo(resultsEl, c) });
  app.querySelector('#heat-section').hidden = heat.hidden;

  app.querySelector('#hero-share')?.addEventListener('click', () => shareCombo(ctx, sum.best));

  bindCurrencyToggle(app);
  decorateHero(app, alert.destination);
  fillTrip(app, { deps, destination: alert.destination, combos: sum.combos, dates: tripDates(sum.best, alert.departures) });

  if (animate) countUp(app);
  if (sum.under && st.key === 'active') celebrate(app.querySelector('.hero'), id, today);

  document.getElementById('toggle-active')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const updated = { ...rawAlert, active: rawAlert.active === false, updated_at: new Date().toISOString() };
      const doc = await saveAlert(updated);
      state.alerts = doc.alerts;
      toast(updated.active ? 'Alert resumed' : 'Alert paused');
      draw(app, updated, rawResults, rawHistory, false);
    } catch (err) {
      toast(err.message, 6000);
      btn.disabled = false;
    }
  });
}
