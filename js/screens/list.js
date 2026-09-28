// Ecranul 1: lista alertelor, cu starea fiecăreia, cel mai mic preț curent și evoluția lui.

import { alertStatus, comboKey, estimateBudget, isOneWay, searchesPerDay } from '../budget.js';
import { forDisplay } from '../currency.js';
import { deleteAlert, hasWriteAccess, saveAlert } from '../data.js';
import { locateDestination, nameCandidates } from '../geo.js';
import { cityPhoto, loadImage } from '../media.js';
import { destFlag } from '../flags.js';
import { enablePullToRefresh, enableSwipe } from '../gestures.js';
import { icon } from '../icons.js';
import { VERDICT_STYLE, verdict } from '../insights.js';
import { countUp, skyPhase } from '../motion.js';
import { localWeatherSlot, mountLocalWeather } from '../local-weather.js';
import { bindOnboarding, onboardingCard } from '../onboarding.js';
import { scheduleLine } from '../results-view.js';
import {
  ensureAlerts, ensureConfig, loadHistory, loadResults, loadStatus, state, summarize,
} from '../state.js';
import { overallMinSeries, setNav, skeleton, sparkline, vtName } from '../ui.js';
import { dateTime, h, money, shortDate, toast, todayRO } from '../util.js';

export async function renderList(app) {
  setNav({
    title: 'My flights',
    large: true,
    actions: [
      { icon: 'refresh', label: 'Reload', id: 'nav-refresh' },
      { icon: 'plus', label: 'New alert', href: '#/alerta/nou' },
    ],
  });
  bindRefresh(app);
  enablePullToRefresh(() => renderList(app));

  // La revenire, afișăm imediat lista din memorie, apoi o actualizăm cu datele noi
  const route = location.hash;
  const cached = state.config && state.alerts && state.listLoaded;
  if (cached) draw(app, true);
  else app.innerHTML = skeleton(3);

  await ensureConfig();
  const [alerts] = await Promise.all([ensureAlerts(true), loadStatus()]);
  await Promise.all(alerts.flatMap((a) => [loadResults(a.id), loadHistory(a.id)]));
  state.listLoaded = true;
  if (location.hash !== route && !(route === '' && location.hash === '#/')) return; // utilizatorul a plecat între timp
  draw(app, !cached);
}

/** Desenează lista din datele aflate în memorie (state). */
function draw(app, animate) {
  const alerts = state.alerts;
  const status = state.status;
  const today = todayRO();
  const limit = state.config.settings.monthly_search_limit || 250;

  const budget = estimateBudget(alerts, today);
  const ratio = budget.perMonth / limit;
  const level = ratio > 1 ? 'bad' : ratio > 0.8 ? 'warn' : '';
  const left = status?.searches_left_after ?? status?.searches_left_before;

  // Alertele active primele (cele sub prag în vârf), apoi programate, oprite, expirate
  const order = { active: 0, scheduled: 1, paused: 2, expired: 3 };
  const rows = alerts.map((a) => ({ a, st: alertStatus(a, today), sum: summarize(a, state.results[a.id], today) }));
  rows.sort((x, y) => order[x.st.key] - order[y.st.key]
    || (y.sum.under - x.sum.under)
    || (x.a.name || '').localeCompare(y.a.name || ''));
  const activeCount = rows.filter((r) => r.st.key === 'active').length;
  const underCount = rows.filter((r) => r.st.key === 'active' && r.sum.under).length;
  const scheduled = rows.filter((r) => r.st.key === 'scheduled');
  const nextStart = scheduled.map((r) => r.a.monitor_start).sort()[0];
  const headline = [
    `${activeCount} ${activeCount === 1 ? 'active alert' : 'active alerts'}`,
    scheduled.length ? `${scheduled.length} scheduled (from ${shortDate(nextStart)})` : '',
    underCount ? `<b>${underCount} under target</b>` : '',
  ].filter(Boolean).join(' · ');
  const usage = status?.this_month_usage;

  const onboarding = onboardingCard({ status, alerts });
  app.innerHTML = `
    <div class="page-head sky sky-${skyPhase()}">
      <div class="sky-orb" aria-hidden="true"></div>
      <div class="sky-greeting">${greeting()}</div>
      <h1>My flights</h1>
      <p>${headline}</p>
    </div>

    ${onboarding}
    ${statusBanner(status)}
    ${!hasWriteAccess() && !onboarding ? `<a class="banner info" href="#/setari">${icon('key', 18)}<div>Add your GitHub token in <b>Settings</b> to create and save alerts from the app.</div></a>` : ''}

    <div class="section-label"><span>Search budget</span><span class="muted" style="text-transform:none;letter-spacing:0">${status ? `ran ${dateTime(status.last_run)}` : ''}</span></div>
    <div class="card" style="padding:0">
      <div class="summary">
        <div><b>${budget.perDay}</b><span>searches today</span></div>
        <div><b class="${level === 'bad' ? 'bad-text' : ''}">~${budget.perMonth}</b><span>30-day estimate</span></div>
        <div><b id="home-credits">${left ?? '—'}</b><span>credits left${status?.credits_checked_at ? ` (${shortDate(status.credits_checked_at.slice(0, 10))})` : ''}</span></div>
      </div>
      <div class="budget-foot">
        <div class="meter ${level}"><div style="width:${Math.min(100, ratio * 100)}%"></div></div>
        <div class="small ${level === 'bad' ? 'bad-text' : 'muted'}">${level === 'bad'
          ? `The estimate for the next 30 days exceeds the ${limit}/month limit. Narrow down or pause some alerts.`
          : `Estimate for the next 30 days: ${Math.round(ratio * 100)}% of the ${limit}/month limit (not searches already made).`}</div>
        ${usage !== undefined && usage !== null ? `<div class="small muted" style="margin-top:2px">Actually used this month (SerpApi): <b>${usage}</b></div>` : ''}
      </div>
    </div>

    <div class="section-label"><span>Alerts</span>${rows.length ? `<a href="#/alerta/nou" class="nowrap">+ New alert</a>` : ''}</div>
    ${rows.length ? `<div class="alert-list">${rows.map(({ a, st, sum }) => alertCard(a, st, sum, today)).join('')}</div>` : `
      <div class="card empty">
        <div class="empty-ico">${icon('plane', 30)}</div>
        <h2>No alerts yet</h2>
        <p>Create an alert and we will tell you when the price drops under your budget.</p>
        <a class="btn primary" href="#/alerta/nou">${icon('plus', 18)} Create your first alert</a>
      </div>`}

    ${localWeatherSlot()}
  `;
  bindRefresh(app);
  bindOnboarding(app);
  mountLocalWeather(app);
  if (animate) countUp(app);
  loadThumbs(app);
  if (hasWriteAccess()) {
    enableSwipe(app);
    bindSwipeActions(app);
  }
}

/** Butoanele dezvăluite prin glisare: oprește/pornește și șterge. */
function bindSwipeActions(app) {
  app.querySelectorAll('[data-swipe-act]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault();
    const alert = state.alerts.find((a) => a.id === b.dataset.id);
    if (!alert) return;
    b.disabled = true;
    try {
      if (b.dataset.swipeAct === 'toggle') {
        const doc = await saveAlert({ ...alert, active: alert.active === false, updated_at: new Date().toISOString() });
        state.alerts = doc.alerts;
        toast(alert.active === false ? 'Alert resumed' : 'Alert paused');
      } else {
        if (!confirm(`Delete the alert “${alert.name}”?`)) {
          b.disabled = false;
          return;
        }
        const doc = await deleteAlert(alert.id, alert.name);
        state.alerts = doc.alerts;
        toast('Alert deleted');
      }
      renderList(app);
    } catch (err) {
      toast(err.message, 6000);
      b.disabled = false;
    }
  }));
}

function bindRefresh(app) {
  const btn = document.getElementById('nav-refresh');
  if (btn) btn.onclick = () => renderList(app);
}

function statusBanner(status) {
  if (!status) {
    return `<div class="banner info">${icon('info', 18)}<div>The search has not run yet. It starts automatically after you save an alert.</div></div>`;
  }
  const out = [];
  if (status.skipped_budget) {
    out.push(`<div class="banner bad">${icon('warning', 18)}<div><b>Searches were skipped</b> — not enough SerpApi credits.</div></div>`);
  } else if (status.errors?.length) {
    out.push(`<div class="banner warn">${icon('warning', 18)}<div><b>${status.errors.length} failed searches</b> in the last run.
      <ul>${status.errors.slice(0, 3).map((e) => `<li>${h(e.combination)}: ${h(e.message)}</li>`).join('')}</ul></div></div>`);
  }
  const warnings = [...(status.warnings || []), ...(status.notification_errors || [])];
  if (warnings.length) {
    out.push(`<div class="banner warn">${icon('bell', 18)}<div><ul style="padding-left:14px;margin:0">${warnings.slice(0, 3).map((w) => `<li>${h(w)}</li>`).join('')}</ul></div></div>`);
  }
  return out.join('');
}

/** 'OTP · BBU · CLJ' -> 'OTP +2' (ca să încapă pe un rând). */
function depCodes(codes = []) {
  return codes.length > 2 ? `${codes[0]} +${codes.length - 1}` : codes.join(' · ');
}

/** Salutul după ora din România. */
function greeting() {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', hour12: false }).format(new Date()));
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  if (hour >= 18 && hour < 23) return 'Good evening';
  return 'Good night';
}

/** Miniaturile cu destinația (poze de pe Wikipedia), încărcate după ce lista e afișată. */
function loadThumbs(app) {
  app.querySelectorAll('[data-thumb]').forEach(async (el) => {
    const alert = state.alerts.find((a) => a.id === el.dataset.thumb);
    if (!alert) return;
    const full = state.config.destinations.find((d) => d.id === alert.destination?.id);
    const place = await locateDestination(alert.destination);
    const photo = await cityPhoto([place?.name, ...nameCandidates(full?.name || alert.destination?.name)]);
    if (!photo || !el.isConnected) return;
    const url = await loadImage(photo.thumb, photo.original);
    if (!url || !el.isConnected) return;
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add('has-photo');
  });
}

function alertCard(rawAlert, st, rawSum, today) {
  // prețurile se afișează în moneda aleasă (EUR/RON)
  const disp = forDisplay(rawAlert, state.results[rawAlert.id], state.history[rawAlert.id]);
  const alert = disp.alert;
  const sum = disp.converted ? summarize(alert, disp.results, today) : rawSum;
  const cur = disp.currency;
  const results = state.results[alert.id];
  const live = st.key === 'active' || st.key === 'scheduled';
  const keys = sum.combos.map(comboKey);
  const series = overallMinSeries(disp.history, keys, cur).slice(-14);

  // Variația față de ziua precedentă
  let delta = '';
  if (series.length >= 2 && !sum.stale) {
    const diff = series[series.length - 1].price - series[series.length - 2].price;
    if (diff !== 0) {
      delta = `<span class="delta ${diff < 0 ? 'down' : 'up'}">${icon(diff < 0 ? 'down' : 'up')}${money(Math.abs(diff))}</span>`;
    }
  }

  const v = live && !sum.stale ? verdict({ series, best: sum.best, maxPrice: Number(alert.max_price) || 0, currency: cur }) : null;
  const vt = vtName(alert.id);

  let priceHtml;
  if (!live) {
    priceHtml = sum.lowest !== null ? `<div class="amount muted">${money(sum.lowest)}<small>${cur}</small></div>` : '';
  } else if (sum.stale) {
    priceHtml = '<span class="small muted">waiting for<br>search</span>';
  } else if (sum.lowest === null) {
    priceHtml = `<span class="small muted">${results ? 'no flights' : 'soon'}</span>`;
  } else {
    priceHtml = `<div class="amount ${sum.under ? 'good-text' : ''}" style="view-transition-name:${vt}-price"><span data-count="${sum.lowest}">${money(sum.lowest)}</span><small>${cur}</small></div>
      ${delta}`;
  }

  const dates = (alert.departures || []).map((d) => shortDate(d.date));
  const dateText = dates.length > 3 ? `${dates.slice(0, 3).join(', ')} +${dates.length - 3}` : dates.join(', ');

  const flag = destFlag(alert.destination);
  const actions = hasWriteAccess() ? `
      <div class="swipe-actions">
        <button type="button" data-swipe-act="toggle" data-id="${h(alert.id)}">${icon(alert.active === false ? 'play' : 'pause', 20)}<span>${alert.active === false ? 'Resume' : 'Pause'}</span></button>
        <button type="button" data-swipe-act="delete" data-id="${h(alert.id)}" class="danger">${icon('trash', 20)}<span>Delete</span></button>
      </div>` : '';
  return `
    <div class="swipe-wrap">${actions}
    <a class="card alert-card swipe-card ${sum.under && st.key === 'active' ? 'is-under' : ''}" href="#/alerta/${encodeURIComponent(alert.id)}" style="view-transition-name:${vt}">
      <div class="alert-head">
        <span class="thumb" data-thumb="${h(alert.id)}" aria-hidden="true">${flag || '✈️'}</span>
        <div style="min-width:0">
        <div class="alert-name"><span class="dot ${st.key === 'active' ? 'on' : st.key === 'scheduled' ? 'info' : ''}" title="${st.label}"></span><span>${h(alert.name || alert.id)}</span></div>
        <div class="alert-route"><span class="codes">${h(depCodes(alert.departure_airports))}</span>${icon('chevron', 14)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${flag ? `<span class="flag">${flag}</span> ` : ''}${h(alert.destination?.name || '')}</span></div>
        </div>
      </div>
      <div class="alert-price">${priceHtml}</div>
      <div class="alert-meta">
        ${st.key !== 'active' ? `<span class="badge ${st.key === 'scheduled' ? 'info' : ''}">${st.label}${st.key === 'scheduled' ? ` · from ${shortDate(alert.monitor_start)}` : ''}</span>` : ''}
        ${v ? `<span class="badge ${VERDICT_STYLE[v.kind].cls}">${icon(VERDICT_STYLE[v.kind].icon)}${v.title}</span>` : ''}
        <span>${icon('calendar')}${h(dateText)}${isOneWay(alert) ? ' · one way' : ''}</span>
        ${searchesPerDay(alert) > 1 ? `<span>${icon('clock')}${searchesPerDay(alert)}×/day</span>` : ''}
        <span>${icon('wallet')}target ${money(alert.max_price, cur)}</span>
        ${live && series.length >= 2 ? `<span style="margin-left:auto">${sparkline(series, { threshold: Number(alert.max_price) || null })}</span>` : ''}
      </div>
      ${scheduleLine(alert, results)}
    </a>
    </div>`;
}
