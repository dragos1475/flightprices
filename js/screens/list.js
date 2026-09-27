// Ecranul 1: lista alertelor, cu starea fiecăreia, cel mai mic preț curent și evoluția lui.

import { alertStatus, comboKey, estimateBudget, isOneWay } from '../budget.js';
import { deleteAlert, hasWriteAccess, saveAlert } from '../data.js';
import { destFlag } from '../flags.js';
import { enablePullToRefresh, enableSwipe } from '../gestures.js';
import { icon } from '../icons.js';
import { VERDICT_STYLE, verdict } from '../insights.js';
import { countUp } from '../motion.js';
import { bindOnboarding, onboardingCard } from '../onboarding.js';
import {
  ensureAlerts, ensureConfig, loadHistory, loadResults, loadStatus, state, summarize,
} from '../state.js';
import { overallMinSeries, setNav, skeleton, sparkline, vtName } from '../ui.js';
import { dateTime, h, money, shortDate, toast, todayRO } from '../util.js';

export async function renderList(app) {
  setNav({
    title: 'Zborurile mele',
    large: true,
    actions: [
      { icon: 'refresh', label: 'Reîncarcă', id: 'nav-refresh' },
      { icon: 'plus', label: 'Alertă nouă', href: '#/alerta/nou' },
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

  const onboarding = onboardingCard({ status, alerts });
  app.innerHTML = `
    <div class="page-head">
      <h1>Zborurile mele</h1>
      <p>${activeCount} ${activeCount === 1 ? 'alertă activă' : 'alerte active'}${underCount ? ` · <span class="good-text">${underCount} sub prag</span>` : ''}</p>
    </div>

    ${onboarding}
    ${statusBanner(status)}
    ${!hasWriteAccess() && !onboarding ? `<a class="banner info" href="#/setari">${icon('key', 18)}<div>Adaugă tokenul GitHub în <b>Setări</b> ca să poți crea și salva alerte din aplicație.</div></a>` : ''}

    <div class="section-label"><span>Buget căutări</span><span class="muted" style="text-transform:none;letter-spacing:0">${status ? `rulat ${dateTime(status.last_run)}` : ''}</span></div>
    <div class="card" style="padding:0">
      <div class="summary">
        <div><b>${budget.perDay}</b><span>căutări / zi</span></div>
        <div><b class="${level === 'bad' ? 'bad-text' : ''}">~${budget.perMonth}</b><span>în 30 de zile</span></div>
        <div><b>${left ?? '—'}</b><span>credite rămase</span></div>
      </div>
      <div class="budget-foot">
        <div class="meter ${level}"><div style="width:${Math.min(100, ratio * 100)}%"></div></div>
        <div class="small ${level === 'bad' ? 'bad-text' : 'muted'}">${level === 'bad'
          ? `Depășești limita de ${limit}/lună. Restrânge sau oprește unele alerte.`
          : `${Math.round(ratio * 100)}% din limita de ${limit} căutări pe lună`}</div>
      </div>
    </div>

    <div class="section-label"><span>Alerte</span>${rows.length ? `<a href="#/alerta/nou" class="nowrap">+ Alertă nouă</a>` : ''}</div>
    ${rows.length ? `<div class="alert-list">${rows.map(({ a, st, sum }) => alertCard(a, st, sum, today)).join('')}</div>` : `
      <div class="card empty">
        <div class="empty-ico">${icon('plane', 30)}</div>
        <h2>Nicio alertă încă</h2>
        <p>Creează o alertă și îți spunem când prețul scade sub bugetul tău.</p>
        <a class="btn primary" href="#/alerta/nou">${icon('plus', 18)} Creează prima alertă</a>
      </div>`}
  `;
  bindRefresh(app);
  bindOnboarding(app);
  if (animate) countUp(app);
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
        toast(alert.active === false ? 'Alerta a fost pornită' : 'Alerta a fost oprită');
      } else {
        if (!confirm(`Ștergi alerta „${alert.name}”?`)) {
          b.disabled = false;
          return;
        }
        const doc = await deleteAlert(alert.id, alert.name);
        state.alerts = doc.alerts;
        toast('Alerta a fost ștearsă');
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
    return `<div class="banner info">${icon('info', 18)}<div>Căutarea nu a rulat încă. Pornește automat după ce salvezi o alertă.</div></div>`;
  }
  const out = [];
  if (status.skipped_budget) {
    out.push(`<div class="banner bad">${icon('warning', 18)}<div><b>Căutările au fost sărite</b> — credite SerpApi insuficiente.</div></div>`);
  } else if (status.errors?.length) {
    out.push(`<div class="banner warn">${icon('warning', 18)}<div><b>${status.errors.length} căutări eșuate</b> la ultima rulare.
      <ul>${status.errors.slice(0, 3).map((e) => `<li>${h(e.combination)}: ${h(e.message)}</li>`).join('')}</ul></div></div>`);
  }
  const warnings = [...(status.warnings || []), ...(status.notification_errors || [])];
  if (warnings.length) {
    out.push(`<div class="banner warn">${icon('bell', 18)}<div><ul style="padding-left:14px;margin:0">${warnings.slice(0, 3).map((w) => `<li>${h(w)}</li>`).join('')}</ul></div></div>`);
  }
  return out.join('');
}

function alertCard(alert, st, sum, today) {
  const cur = alert.currency || 'EUR';
  const results = state.results[alert.id];
  const live = st.key === 'active' || st.key === 'scheduled';
  const keys = sum.combos.map(comboKey);
  const series = overallMinSeries(state.history[alert.id], keys, cur).slice(-14);

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
    priceHtml = '<span class="small muted">aștept<br>căutarea</span>';
  } else if (sum.lowest === null) {
    priceHtml = `<span class="small muted">${results ? 'fără zboruri' : 'în curând'}</span>`;
  } else {
    priceHtml = `<div class="amount ${sum.under ? 'good-text' : ''}" style="view-transition-name:${vt}-price"><span data-count="${sum.lowest}">${money(sum.lowest)}</span><small>${cur}</small></div>
      ${delta}`;
  }

  const dates = (alert.departures || []).map((d) => shortDate(d.date));
  const dateText = dates.length > 3 ? `${dates.slice(0, 3).join(', ')} +${dates.length - 3}` : dates.join(', ');

  const flag = destFlag(alert.destination);
  const actions = hasWriteAccess() ? `
      <div class="swipe-actions">
        <button type="button" data-swipe-act="toggle" data-id="${h(alert.id)}">${icon(alert.active === false ? 'play' : 'pause', 20)}<span>${alert.active === false ? 'Pornește' : 'Oprește'}</span></button>
        <button type="button" data-swipe-act="delete" data-id="${h(alert.id)}" class="danger">${icon('trash', 20)}<span>Șterge</span></button>
      </div>` : '';
  return `
    <div class="swipe-wrap">${actions}
    <a class="card alert-card swipe-card ${sum.under && st.key === 'active' ? 'is-under' : ''}" href="#/alerta/${encodeURIComponent(alert.id)}" style="view-transition-name:${vt}">
      <div style="min-width:0">
        <div class="alert-name"><span class="dot ${st.key === 'active' ? 'on' : st.key === 'scheduled' ? 'info' : ''}" title="${st.label}"></span><span>${h(alert.name || alert.id)}</span></div>
        <div class="alert-route"><span class="codes">${h((alert.departure_airports || []).join(' · '))}</span>${icon('chevron', 14)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${flag ? `<span class="flag">${flag}</span> ` : ''}${h(alert.destination?.name || '')}</span></div>
      </div>
      <div class="alert-price">${priceHtml}</div>
      <div class="alert-meta">
        ${st.key !== 'active' ? `<span class="badge">${st.label}</span>` : ''}
        ${v ? `<span class="badge ${VERDICT_STYLE[v.kind].cls}">${icon(VERDICT_STYLE[v.kind].icon)}${v.title}</span>` : ''}
        <span>${icon('calendar')}${h(dateText)}${isOneWay(alert) ? ' · doar dus' : ''}</span>
        <span>${icon('wallet')}prag ${money(alert.max_price, cur)}</span>
        ${live && series.length >= 2 ? `<span style="margin-left:auto">${sparkline(series, { threshold: Number(alert.max_price) || null })}</span>` : ''}
      </div>
    </a>
    </div>`;
}
