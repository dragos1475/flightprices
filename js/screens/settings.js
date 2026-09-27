// Ecranul 4: setări – token GitHub, notificări push, chei VAPID, linkuri utile.

import {
  getBranch, getRepo, getToken, githubLinks, hasWriteAccess, saveVapidPublicKey, setBranch, setRepo, setToken, testAccess,
} from '../data.js';
import { cachedRate, displayCurrency, refreshRate, setDisplayCurrency } from '../currency.js';
import { icon } from '../icons.js';
import { localWeatherHidden, setLocalWeatherHidden } from '../local-weather.js';

import {
  currentSubscription, generateVapidKeys, localTestNotification, pushSupport, subscribe, unsubscribe,
} from '../push.js';
import { ensureConfig, state } from '../state.js';
import { setNav, toggle } from '../ui.js';
import { copyText, h, toast } from '../util.js';

export async function renderSettings(app) {
  setNav({ title: 'Setări', large: true });
  const cfg = await ensureConfig();
  const vapidKey = cfg.settings.vapid_public_key || '';
  const vapidOk = vapidKey && !vapidKey.startsWith('PUNE_AICI');
  const support = pushSupport();
  const links = githubLinks();
  let sub = null;
  try {
    sub = await currentSubscription();
  } catch { /* fără service worker */ }

  const connected = hasWriteAccess();

  app.innerHTML = `
    <div class="page-head"><h1>Setări</h1><p>Conectarea la GitHub și notificările de pe acest telefon.</p></div>

    <div class="section-label"><span>GitHub</span>${connected ? '<span class="badge good" style="text-transform:none;letter-spacing:0">Conectat</span>' : ''}</div>
    <div class="group">
      <div class="row-stack">
        <label class="label" for="s-repo">Repository (proprietar/nume)</label>
        <input type="text" id="s-repo" placeholder="ion-popescu/zboruri" value="${h(getRepo())}" autocapitalize="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="row-stack">
        <label class="label" for="s-token">Token fine-grained</label>
        <input type="password" id="s-token" placeholder="github_pat_…" value="${h(getToken())}" autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>
      <div class="row-stack">
        <label class="label" for="s-branch">Ramura (branch)</label>
        <input type="text" id="s-branch" value="${h(getBranch())}" autocapitalize="off" spellcheck="false">
      </div>
      <div class="row-stack">
        <div class="btn-row" style="margin-top:0">
          <button class="btn primary" id="s-save">Salvează și testează</button>
          ${getToken() ? `<button class="btn danger" id="s-forget" style="flex:0 0 auto">${icon('trash', 16)}</button>` : ''}
        </div>
        <div id="s-result" class="small" style="margin-top:8px"></div>
      </div>
    </div>
    <p class="section-note">Tokenul are acces doar la acest repository (Contents: Read and write) și rămâne numai pe acest
      telefon. Pune-i o dată de expirare și revocă-l dacă pierzi telefonul. Pașii exacți sunt în README.</p>

    <div class="section-label"><span>Notificări pe acest telefon</span></div>
    ${support.ios && !support.standalone ? `<div class="banner warn">${icon('info', 18)}<div>Pe iPhone, notificările merg doar din aplicația instalată:
      în Safari apasă <b>Share → Adaugă pe ecranul principal</b>, apoi deschide-o de acolo (iOS 16.4+).</div></div>` : ''}
    ${!vapidOk ? `<div class="banner warn">${icon('key', 18)}<div>Lipsește cheia publică VAPID. Generează cheile mai jos, apoi revino aici.</div></div>` : ''}
    <div class="group">
      <div class="row">
        <span class="row-icon ${support.permission === 'granted' ? 'good' : ''}">${icon('bell', 16)}</span>
        <span class="row-main"><span class="row-title">Permisiune</span></span>
        <span class="row-value">${h(permissionText(support.permission))}</span>
      </div>
      <div class="row">
        <span class="row-icon ${sub ? 'good' : ''}">${icon('link', 16)}</span>
        <span class="row-main"><span class="row-title">Abonament push</span></span>
        <span class="row-value">${sub ? 'activ' : 'inexistent'}</span>
      </div>
      <div class="row-stack">
        <div class="btn-row" style="margin-top:0">
          <button class="btn primary" id="n-enable" ${vapidOk ? '' : 'disabled'}>${sub ? 'Arată abonamentul' : 'Activează notificările'}</button>
          <button class="btn" id="n-test" ${support.permission === 'granted' ? '' : 'disabled'}>Test local</button>
        </div>
      </div>
      <div class="row-stack" id="n-sub" ${sub ? '' : 'hidden'}>
        <p class="small muted">Copiază textul în secretul GitHub <code>PUSH_SUBSCRIPTION</code>. Dacă reinstalezi aplicația sau schimbi
          telefonul, abonamentul se schimbă și trebuie copiat din nou.</p>
        <textarea id="n-json" readonly rows="5">${sub ? h(JSON.stringify(sub.toJSON())) : ''}</textarea>
        <div class="btn-row">
          <button class="btn tonal" id="n-copy">${icon('copy', 16)} Copiază</button>
          ${links.secrets ? `<a class="btn" href="${links.secrets}" target="_blank" rel="noopener">Secrets ${icon('external', 14)}</a>` : ''}
          <button class="btn danger" id="n-off" style="flex:0 0 auto" aria-label="Dezactivează">${icon('trash', 16)}</button>
        </div>
      </div>
    </div>
    <p class="section-note">Test complet de la GitHub până pe telefon: Actions → „Căutare zboruri” → Run workflow → bifează „test notificări”.</p>

    <div class="section-label"><span>Afișare</span></div>
    <div class="group">
      <div class="row-stack">
        <span class="label">Moneda în care văd prețurile</span>
        <div class="seg full" role="group" aria-label="Moneda afișată">
          ${[['', 'Ca în alertă'], ['EUR', 'EUR'], ['RON', 'RON']].map(([v, l]) => `
            <button type="button" data-pref-cur="${v}" aria-pressed="${displayCurrency() === v}">${l}</button>`).join('')}
        </div>
        <p class="hint">Conversia folosește cursul BCE (actualizat zilnic). Pragurile și notificările rămân în moneda alertei.</p>
      </div>
      ${toggle('s-localweather', !localWeatherHidden(), 'Vremea la tine pe pagina principală', 'Folosește locația telefonului, rotunjită la ~1 km')}
    </div>
    <p class="section-note">Pentru poze, hartă, vreme și curs, aplicația folosește servicii gratuite: Wikipedia, Open-Meteo,
      frankfurter.dev (BCE), jsDelivr și BigDataCloud. Primesc doar numele orașului, moneda sau (pentru „Vremea la tine”)
      locația rotunjită la ~1 km.</p>

    <div class="section-label"><span>Căutare rapidă</span></div>
    <div class="group">
      <div class="row">
        <span class="row-icon">${icon('key', 16)}</span>
        <span class="row-main"><span class="row-title">Parola de căutare</span>
          <span class="row-sub">Se setează în GitHub Secrets ca <code>SEARCH_PASSWORD</code>. Nu se salvează în aplicație.</span></span>
      </div>
      ${rememberedPassword() ? `<button type="button" class="row" id="pw-forget">
        <span class="row-icon warn">${icon('close', 16)}</span>
        <span class="row-main"><span class="row-title">Uită parola memorată</span><span class="row-sub">Ținută minte până la închiderea aplicației</span></span>
      </button>` : ''}
    </div>
    <p class="section-note">Folosește o parolă lungă (12+ caractere), diferită de alte parole. Dacă parola e greșită, căutarea e refuzată fără să consume credite.</p>

    <div class="section-label"><span>Chei VAPID</span></div>
    <div class="group">
      <div class="row">
        <span class="row-icon ${vapidOk ? 'good' : 'warn'}">${icon('key', 16)}</span>
        <span class="row-main"><span class="row-title">Cheia publică</span>
          <span class="row-sub" style="word-break:break-all">${vapidOk ? h(`${vapidKey.slice(0, 18)}…${vapidKey.slice(-8)}`) : 'nesetată'}</span></span>
      </div>
      <button type="button" class="row" id="v-toggle">
        <span class="row-icon">${icon('refresh', 16)}</span>
        <span class="row-main"><span class="row-title">Generează chei noi</span><span class="row-sub">O singură dată, la instalare</span></span>
        <span class="chev">${icon('chevron', 18)}</span>
      </button>
      <div class="row-stack" id="v-panel" hidden>
        <div class="banner warn" style="margin-top:0">${icon('warning', 16)}<div>Cheile noi le înlocuiesc pe cele vechi: după schimbare reactivezi notificările și copiezi din nou abonamentul.</div></div>
        <button class="btn primary block" id="v-gen">Generează</button>
        <div id="v-out" hidden>
          <label class="label" for="v-pub" style="margin-top:14px">VAPID_PUBLIC_KEY (publică)</label>
          <textarea id="v-pub" readonly rows="3"></textarea>
          <div class="btn-row"><button class="btn tonal sm" data-copy="v-pub">${icon('copy', 14)} Copiază</button>
            ${connected ? '<button class="btn sm" id="v-save">Salvează în settings.json</button>' : ''}</div>
          <label class="label" for="v-priv" style="margin-top:14px">VAPID_PRIVATE_KEY (secretă, doar în GitHub Secrets)</label>
          <textarea id="v-priv" readonly rows="2"></textarea>
          <div class="btn-row"><button class="btn tonal sm" data-copy="v-priv">${icon('copy', 14)} Copiază</button></div>
          <p class="hint">Cheia privată nu este salvată nicăieri. Copiaz-o acum în GitHub Secrets.</p>
        </div>
      </div>
    </div>

    ${links.repo ? `
    <div class="section-label"><span>Linkuri utile</span></div>
    <div class="group">
      ${linkRow(links.actions, 'refresh', 'Rulează căutarea manual', 'GitHub Actions')}
      ${linkRow(links.editAlerts, 'edit', 'Editează alertele pe GitHub', 'data/alerts.json')}
      ${linkRow(links.secrets, 'key', 'GitHub Secrets', 'chei și abonament')}
      ${linkRow(links.repo, 'link', 'Repository', h(getRepo()))}
    </div>` : ''}
    <p class="section-note" style="text-align:center;margin-top:24px">Monitor Zboruri · date de la Google Flights prin SerpApi</p>
  `;

  // ---- GitHub ----
  const out = app.querySelector('#s-result');
  app.querySelector('#s-save').onclick = async () => {
    setRepo(app.querySelector('#s-repo').value);
    setToken(app.querySelector('#s-token').value);
    setBranch(app.querySelector('#s-branch').value || 'main');
    if (!getToken()) {
      out.innerHTML = '<span class="muted">Fără token: poți vedea alertele, dar nu le poți salva din aplicație.</span>';
      return;
    }
    out.innerHTML = '<span class="muted">Se verifică…</span>';
    try {
      const r = await testAccess();
      state.config = null; // reîncărcăm configurările prin API
      state.alerts = null;
      if (r.canPush === false) {
        out.innerHTML = `<span class="bad-text">Tokenul poate citi ${h(r.name)}, dar NU poate scrie. Adaugă „Contents: Read and write”.</span>`;
      } else {
        toast(`Conectat la ${r.name}`);
        renderSettings(app);
      }
    } catch (e) {
      out.innerHTML = `<span class="bad-text">${h(e.message)}</span>`;
    }
  };
  app.querySelector('#s-forget')?.addEventListener('click', () => {
    if (!confirm('Ștergi tokenul de pe acest dispozitiv?')) return;
    setToken('');
    toast('Tokenul a fost șters de pe acest dispozitiv');
    renderSettings(app);
  });

  // ---- Notificări ----
  app.querySelector('#n-enable').onclick = async () => {
    try {
      const json = await subscribe(vapidKey);
      app.querySelector('#n-json').value = JSON.stringify(json);
      app.querySelector('#n-sub').hidden = false;
      toast('Notificări activate. Copiază abonamentul în Secrets.', 5000);
    } catch (e) {
      toast(e.message, 7000);
    }
  };
  app.querySelector('#n-test').onclick = async () => {
    try {
      await localTestNotification();
    } catch (e) {
      toast(e.message, 5000);
    }
  };
  app.querySelector('#n-copy')?.addEventListener('click', async () => {
    toast((await copyText(app.querySelector('#n-json').value)) ? 'Abonament copiat' : 'Selectează și copiază manual');
  });
  app.querySelector('#n-off')?.addEventListener('click', async () => {
    if (!confirm('Dezactivezi notificările pe acest telefon?')) return;
    await unsubscribe();
    toast('Notificările au fost dezactivate');
    renderSettings(app);
  });

  app.querySelector('#s-localweather')?.addEventListener('change', (e) => {
    setLocalWeatherHidden(!e.target.checked);
    toast(e.target.checked ? 'Vremea apare pe pagina principală' : 'Vremea a fost ascunsă');
  });

  app.querySelectorAll('[data-pref-cur]').forEach((b) => b.addEventListener('click', async () => {
    const cur = b.dataset.prefCur;
    if (cur && !cachedRate() && !(await refreshRate())) {
      toast('Nu am putut obține cursul EUR/RON. Încearcă din nou când ai internet.');
      return;
    }
    setDisplayCurrency(cur);
    app.querySelectorAll('[data-pref-cur]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    toast(cur ? `Prețurile se afișează în ${cur}` : 'Prețurile se afișează în moneda fiecărei alerte');
  }));

  app.querySelector('#pw-forget')?.addEventListener('click', () => {
    try { sessionStorage.removeItem('zboruri.search_password'); } catch { /* indisponibil */ }
    toast('Parola a fost uitată');
    renderSettings(app);
  });

  // ---- VAPID ----
  app.querySelector('#v-toggle').onclick = () => {
    const p = app.querySelector('#v-panel');
    p.hidden = !p.hidden;
  };
  app.querySelector('#v-gen').onclick = async () => {
    try {
      const keys = await generateVapidKeys();
      app.querySelector('#v-pub').value = keys.publicKey;
      app.querySelector('#v-priv').value = keys.privateKey;
      app.querySelector('#v-out').hidden = false;
    } catch (e) {
      toast(`Nu am putut genera cheile: ${e.message}`, 6000);
    }
  };
  app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    toast((await copyText(app.querySelector(`#${b.dataset.copy}`).value)) ? 'Copiat' : 'Selectează și copiază manual');
  }));
  app.querySelector('#v-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const key = app.querySelector('#v-pub').value;
      await saveVapidPublicKey(key);
      state.config.settings.vapid_public_key = key;
      toast('Cheia publică a fost salvată. Nu uita cheia privată în Secrets!', 6000);
    } catch (err) {
      toast(err.message, 6000);
      btn.disabled = false;
    }
  });
}

function linkRow(href, ico, title, sub) {
  return `<a class="row" href="${href}" target="_blank" rel="noopener">
    <span class="row-icon">${icon(ico, 16)}</span>
    <span class="row-main"><span class="row-title">${title}</span><span class="row-sub">${sub}</span></span>
    <span class="chev">${icon('external', 16)}</span></a>`;
}

function permissionText(p) {
  return { granted: 'permise', denied: 'blocate', default: 'neîntrebat' }[p] || p;
}

function rememberedPassword() {
  try {
    return Boolean(sessionStorage.getItem('zboruri.search_password'));
  } catch {
    return false;
  }
}
