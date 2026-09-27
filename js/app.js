// Punctul de pornire al aplicației: navigarea între ecrane.
//
// Ecrane (adresa după #):
//   #/                     lista alertelor
//   #/alerta/nou           formular alertă nouă
//   #/alerta/<id>          detaliul unei alerte
//   #/alerta/<id>/editeaza formular de editare
//   #/cautare              căutări rapide (istoric)
//   #/cautare/noua         formular căutare rapidă (opțional /<id> = repetă o căutare)
//   #/cautare/<id>         rezultatul unei căutări rapide
//   #/setari               setări

import { registerServiceWorker } from './push.js';
import { refreshRate } from './currency.js';
import { disablePullToRefresh } from './gestures.js';
import { haptic, reducedMotion } from './motion.js';
import { setTabbarVisible } from './ui.js';
import { h } from './util.js';
import { renderList } from './screens/list.js';
import { renderForm } from './screens/form.js';
import { renderDetail } from './screens/detail.js';
import { renderSettings } from './screens/settings.js';
import { renderSearchList, renderSearchResult } from './screens/searches.js';

const app = document.getElementById('app');

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const parts = hash.split('/').filter(Boolean).map(decodeURIComponent);

  if (parts[0] === 'cautare' && parts[1] === 'noua') {
    return { tab: 'search', show: () => renderForm(app, null, { mode: 'search', fromSearch: parts[2] }) };
  }
  if (parts[0] === 'cautare' && parts[1]) return { tab: 'search', show: () => renderSearchResult(app, parts[1]) };
  if (parts[0] === 'cautare') return { tab: 'search', show: () => renderSearchList(app) };
  if (parts[0] === 'alerta' && parts[1] === 'nou') return { tab: 'list', show: () => renderForm(app, null) };
  if (parts[0] === 'alerta' && parts[1] && parts[2] === 'editeaza') return { tab: 'list', show: () => renderForm(app, parts[1]) };
  if (parts[0] === 'alerta' && parts[1]) return { tab: 'list', show: () => renderDetail(app, parts[1]) };
  if (parts[0] === 'setari') return { tab: 'settings', show: () => renderSettings(app) };
  return { tab: 'list', show: () => renderList(app) };
}

/** Tranziție fluidă între ecrane (unde browserul o suportă): cardul din listă „devine” ecranul de detaliu. */
function render() {
  if (!document.startViewTransition || reducedMotion()) return renderScreen();
  let screen = null;
  // Browserul fotografiază ecranul vechi, apoi apelează funcția de mai jos care desenează ecranul nou.
  // Așteptăm maxim 350 ms să fie gata (altfel tranziția pornește cu scheletul de încărcare).
  const transition = document.startViewTransition(() => {
    screen = renderScreen();
    return Promise.race([screen, new Promise((r) => { setTimeout(r, 350); })]);
  });
  return transition.updateCallbackDone.then(() => screen).catch(() => screen);
}

async function renderScreen() {
  const r = route();
  disablePullToRefresh();
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === r.tab));
  // curățăm elementele lăsate de ecranul anterior (bara „Salvează”, ferestre deschise)
  document.getElementById('savebar')?.remove();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  setTabbarVisible(true);
  window.scrollTo(0, 0);
  navbar.classList.remove('scrolled');
  // reluăm animația de intrare a ecranului
  app.style.animation = 'none';
  void app.offsetWidth;
  app.style.animation = '';
  try {
    await r.show();
  } catch (e) {
    console.error(e);
    setTabbarVisible(true);
    app.innerHTML = `<div class="banner bad"><div><b>A apărut o eroare.</b><br>${h(e.message)}</div></div>
      <a href="#/" class="btn block">Înapoi la alerte</a>`;
  }
}

window.addEventListener('hashchange', render);

// Ecranul de pornire: rămâne minim ~1 s (animația avionului), apoi dispare lin
const splashShownAt = performance.now();
function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.classList.contains('hide')) return;
  const wait = Math.max(0, (reducedMotion() ? 300 : 1250) - (performance.now() - splashShownAt));
  setTimeout(() => {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 450);
  }, wait);
}
setTimeout(hideSplash, 4000); // siguranță: nu rămâne blocat dacă datele întârzie

// Vibrație scurtă (Android) la butoanele de tip comutator, segment, +/- și tab-uri
document.addEventListener('click', (e) => {
  if (e.target.closest('.seg button, .chip, .stepper button, .tabbar a, .heat-cell')) haptic(6);
});
document.addEventListener('change', (e) => {
  if (e.target.matches('.switch')) haptic(8);
});

refreshRate(); // cursul EUR/RON pentru afișare (o dată pe zi, în fundal)
// bara de sus capătă umbră și titlu când pagina e derulată
const navbar = document.querySelector('.navbar');
const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 36);
window.addEventListener('scroll', onScroll, { passive: true });
Promise.resolve(render()).finally(hideSplash);

// Actualizare automată: aplicația instalată rămâne deschisă în memorie și ar rula codul vechi.
// Când revii în ea, verificăm dacă s-a publicat o versiune nouă (sw.js diferit); dacă da, service
// worker-ul nou preia controlul și reîncărcăm pagina. Nu întrerupem un formular deschis.
const isForm = () => /^#\/(alerta\/nou|alerta\/[^/]+\/editeaza|cautare\/noua)/.test(location.hash);
let reloadWaiting = false;
function reloadForUpdate() {
  if (isForm()) {
    reloadWaiting = true; // după ce ieși din formular
    return;
  }
  location.reload();
}
registerServiceWorker().then((reg) => {
  if (!reg) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) reloadForUpdate(); // (nu la prima instalare)
  });
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 60 * 1000) return;
    lastCheck = Date.now();
    reg.update().catch(() => { /* fără internet */ });
  });
});
window.addEventListener('hashchange', () => {
  if (reloadWaiting && !isForm()) location.reload();
});
