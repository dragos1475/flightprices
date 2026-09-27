// Ghidul de pornire: o listă de pași cu bife, afișată pe ecranul principal până e totul configurat.

import { githubLinks, hasWriteAccess } from './data.js';
import { icon } from './icons.js';
import { isStandalone, pushSupport } from './push.js';
import { h, store } from './util.js';

const HIDE_KEY = 'zboruri.onboarding.hidden';

/** Pașii și dacă sunt gata. status = data/status.json; alerts = lista alertelor. */
function steps({ status, alerts }) {
  const links = githubLinks();
  const robotOk = Boolean(status && (status.searches_left_before !== null && status.searches_left_before !== undefined
    || status.searches_used > 0));
  return [
    {
      done: isStandalone(),
      title: 'Install the app',
      text: 'iPhone: Safari → Share → “Add to Home Screen”. Android: Chrome → ⋮ → “Install app”.',
    },
    { done: hasWriteAccess(), title: 'Connect GitHub', text: 'The token lets the app save your alerts.', href: '#/setari' },
    {
      done: pushSupport().permission === 'granted',
      title: 'Enable notifications',
      text: 'Then copy the subscription into the PUSH_SUBSCRIPTION secret.',
      href: '#/setari',
    },
    {
      done: robotOk,
      title: 'Check the search robot',
      text: 'Add the SERPAPI_KEY secret; the check mark appears here after the first search.',
      href: links.actions,
      external: true,
    },
    { done: alerts.length > 0, title: 'Create your first alert', text: 'Pick the route, the dates and your maximum price.', href: '#/alerta/nou' },
  ];
}

export function onboardingCard(ctx) {
  const list = steps(ctx);
  const doneCount = list.filter((s) => s.done).length;
  if (doneCount === list.length || store.get(HIDE_KEY) === '1') return '';
  return `
    <div class="card onboarding" id="onboarding">
      <div class="onb-head">
        <div><b>Getting started</b><span class="muted small"> · ${doneCount} of ${list.length}</span></div>
        <button type="button" class="linklike small" id="onb-hide">Hide</button>
      </div>
      <div class="meter" style="margin:8px 0 6px"><div style="width:${(doneCount / list.length) * 100}%"></div></div>
      ${list.map((s) => {
        const inner = `
          <span class="onb-check ${s.done ? 'done' : ''}">${s.done ? icon('check', 14) : ''}</span>
          <span class="row-main"><span class="row-title">${h(s.title)}</span>${s.done ? '' : `<span class="row-sub">${h(s.text)}</span>`}</span>
          ${!s.done && s.href ? `<span class="chev">${icon(s.external ? 'external' : 'chevron', 16)}</span>` : ''}`;
        return !s.done && s.href
          ? `<a class="onb-step" href="${h(s.href)}" ${s.external ? 'target="_blank" rel="noopener"' : ''}>${inner}</a>`
          : `<div class="onb-step ${s.done ? 'is-done' : ''}">${inner}</div>`;
      }).join('')}
    </div>`;
}

export function bindOnboarding(root) {
  root.querySelector('#onb-hide')?.addEventListener('click', () => {
    store.set(HIDE_KEY, '1');
    root.querySelector('#onboarding')?.remove();
  });
}
