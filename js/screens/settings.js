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
  setNav({ title: 'Settings', large: true });
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
    <div class="page-head"><h1>Settings</h1><p>GitHub connection and notifications on this phone.</p></div>

    <div class="section-label"><span>GitHub</span>${connected ? '<span class="badge good" style="text-transform:none;letter-spacing:0">Connected</span>' : ''}</div>
    <div class="group">
      <div class="row-stack">
        <label class="label" for="s-repo">Repository (owner/name)</label>
        <input type="text" id="s-repo" placeholder="your-name/flightprices" value="${h(getRepo())}" autocapitalize="off" autocorrect="off" spellcheck="false">
      </div>
      <div class="row-stack">
        <label class="label" for="s-token">Fine-grained token</label>
        <input type="password" id="s-token" placeholder="github_pat_…" value="${h(getToken())}" autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>
      <div class="row-stack">
        <label class="label" for="s-branch">Branch</label>
        <input type="text" id="s-branch" value="${h(getBranch())}" autocapitalize="off" spellcheck="false">
      </div>
      <div class="row-stack">
        <div class="btn-row" style="margin-top:0">
          <button class="btn primary" id="s-save">Save and test</button>
          ${getToken() ? `<button class="btn danger" id="s-forget" style="flex:0 0 auto">${icon('trash', 16)}</button>` : ''}
        </div>
        <div id="s-result" class="small" style="margin-top:8px"></div>
      </div>
    </div>
    <p class="section-note">The token only has access to this repository (Contents: Read and write) and stays only on this
      phone. Give it an expiry date and revoke it if you lose the phone. The exact steps are in the README.</p>

    <div class="section-label"><span>Notifications on this phone</span></div>
    ${support.ios && !support.standalone ? `<div class="banner warn">${icon('info', 18)}<div>On iPhone, notifications only work from the installed app:
      in Safari tap <b>Share → Add to Home Screen</b>, then open it from there (iOS 16.4+).</div></div>` : ''}
    ${!vapidOk ? `<div class="banner warn">${icon('key', 18)}<div>The VAPID public key is missing. Generate the keys below, then come back here.</div></div>` : ''}
    <div class="group">
      <div class="row">
        <span class="row-icon ${support.permission === 'granted' ? 'good' : ''}">${icon('bell', 16)}</span>
        <span class="row-main"><span class="row-title">Permission</span></span>
        <span class="row-value">${h(permissionText(support.permission))}</span>
      </div>
      <div class="row">
        <span class="row-icon ${sub ? 'good' : ''}">${icon('link', 16)}</span>
        <span class="row-main"><span class="row-title">Push subscription</span></span>
        <span class="row-value">${sub ? 'active' : 'none'}</span>
      </div>
      <div class="row-stack">
        <div class="btn-row" style="margin-top:0">
          <button class="btn primary" id="n-enable" ${vapidOk ? '' : 'disabled'}>${sub ? 'Show subscription' : 'Enable notifications'}</button>
          <button class="btn" id="n-test" ${support.permission === 'granted' ? '' : 'disabled'}>Local test</button>
        </div>
      </div>
      <div class="row-stack" id="n-sub" ${sub ? '' : 'hidden'}>
        <p class="small muted">Copy the text into the GitHub secret <code>PUSH_SUBSCRIPTION</code>. If you reinstall the app or change
          phones, the subscription changes and must be copied again.</p>
        <textarea id="n-json" readonly rows="5">${sub ? h(JSON.stringify(sub.toJSON())) : ''}</textarea>
        <div class="btn-row">
          <button class="btn tonal" id="n-copy">${icon('copy', 16)} Copy</button>
          ${links.secrets ? `<a class="btn" href="${links.secrets}" target="_blank" rel="noopener">Secrets ${icon('external', 14)}</a>` : ''}
          <button class="btn danger" id="n-off" style="flex:0 0 auto" aria-label="Disable">${icon('trash', 16)}</button>
        </div>
      </div>
    </div>
    <p class="section-note">Full test from GitHub to the phone: Actions → “Flight search” → Run workflow → tick “test notificari”.</p>

    <div class="section-label"><span>Display</span></div>
    <div class="group">
      <div class="row-stack">
        <span class="label">Currency for prices</span>
        <div class="seg full" role="group" aria-label="Display currency">
          ${[['', 'As in alert'], ['EUR', 'EUR'], ['RON', 'RON']].map(([v, l]) => `
            <button type="button" data-pref-cur="${v}" aria-pressed="${displayCurrency() === v}">${l}</button>`).join('')}
        </div>
        <p class="hint">Conversion uses the ECB rate (updated daily). Targets and notifications stay in the alert currency.</p>
      </div>
      ${toggle('s-localweather', !localWeatherHidden(), 'Local weather on the home page', 'Uses the phone location, rounded to ~1 km')}
    </div>
    <p class="section-note">For photos, maps, weather and exchange rates the app uses free services: Wikipedia, Open-Meteo,
      frankfurter.dev (ECB), jsDelivr and BigDataCloud. They only receive the city name, the currency or (for local weather)
      your location rounded to ~1 km.</p>

    <div class="section-label"><span>Quick search</span></div>
    <div class="group">
      <div class="row">
        <span class="row-icon">${icon('key', 16)}</span>
        <span class="row-main"><span class="row-title">Search password</span>
          <span class="row-sub">Set in GitHub Secrets as <code>SEARCH_PASSWORD</code>. Never stored in the app.</span></span>
      </div>
      ${rememberedPassword() ? `<button type="button" class="row" id="pw-forget">
        <span class="row-icon warn">${icon('close', 16)}</span>
        <span class="row-main"><span class="row-title">Forget remembered password</span><span class="row-sub">Kept until the app is closed</span></span>
      </button>` : ''}
    </div>
    <p class="section-note">Use a long password (12+ characters), different from your other passwords. If the password is wrong, the search is rejected without using credits.</p>

    <div class="section-label"><span>VAPID keys</span></div>
    <div class="group">
      <div class="row">
        <span class="row-icon ${vapidOk ? 'good' : 'warn'}">${icon('key', 16)}</span>
        <span class="row-main"><span class="row-title">Public key</span>
          <span class="row-sub" style="word-break:break-all">${vapidOk ? h(`${vapidKey.slice(0, 18)}…${vapidKey.slice(-8)}`) : 'not set'}</span></span>
      </div>
      <button type="button" class="row" id="v-toggle">
        <span class="row-icon">${icon('refresh', 16)}</span>
        <span class="row-main"><span class="row-title">Generate new keys</span><span class="row-sub">Only once, at setup</span></span>
        <span class="chev">${icon('chevron', 18)}</span>
      </button>
      <div class="row-stack" id="v-panel" hidden>
        <div class="banner warn" style="margin-top:0">${icon('warning', 16)}<div>New keys replace the old ones: after the change, re-enable notifications and copy the subscription again.</div></div>
        <button class="btn primary block" id="v-gen">Generate</button>
        <div id="v-out" hidden>
          <label class="label" for="v-pub" style="margin-top:14px">VAPID_PUBLIC_KEY (public)</label>
          <textarea id="v-pub" readonly rows="3"></textarea>
          <div class="btn-row"><button class="btn tonal sm" data-copy="v-pub">${icon('copy', 14)} Copy</button>
            ${connected ? '<button class="btn sm" id="v-save">Save to settings.json</button>' : ''}</div>
          <label class="label" for="v-priv" style="margin-top:14px">VAPID_PRIVATE_KEY (secret, only in GitHub Secrets)</label>
          <textarea id="v-priv" readonly rows="2"></textarea>
          <div class="btn-row"><button class="btn tonal sm" data-copy="v-priv">${icon('copy', 14)} Copy</button></div>
          <p class="hint">The private key is not saved anywhere. Copy it into GitHub Secrets now.</p>
        </div>
      </div>
    </div>

    ${links.repo ? `
    <div class="section-label"><span>Useful links</span></div>
    <div class="group">
      ${linkRow(links.actions, 'refresh', 'Run the search manually', 'GitHub Actions')}
      ${linkRow(links.editAlerts, 'edit', 'Edit alerts on GitHub', 'data/alerts.json')}
      ${linkRow(links.secrets, 'key', 'GitHub Secrets', 'keys and subscription')}
      ${linkRow(links.repo, 'link', 'Repository', h(getRepo()))}
    </div>` : ''}
    <p class="section-note" style="text-align:center;margin-top:24px">Flight Prices · data from Google Flights via SerpApi</p>
  `;

  // ---- GitHub ----
  const out = app.querySelector('#s-result');
  app.querySelector('#s-save').onclick = async () => {
    setRepo(app.querySelector('#s-repo').value);
    setToken(app.querySelector('#s-token').value);
    setBranch(app.querySelector('#s-branch').value || 'main');
    if (!getToken()) {
      out.innerHTML = '<span class="muted">No token: you can view alerts, but you cannot save them from the app.</span>';
      return;
    }
    out.innerHTML = '<span class="muted">Checking…</span>';
    try {
      const r = await testAccess();
      state.config = null; // reîncărcăm configurările prin API
      state.alerts = null;
      if (r.canPush === false) {
        out.innerHTML = `<span class="bad-text">The token can read ${h(r.name)} but can NOT write. Add “Contents: Read and write”.</span>`;
      } else {
        toast(`Connected to ${r.name}`);
        renderSettings(app);
      }
    } catch (e) {
      out.innerHTML = `<span class="bad-text">${h(e.message)}</span>`;
    }
  };
  app.querySelector('#s-forget')?.addEventListener('click', () => {
    if (!confirm('Remove the token from this device?')) return;
    setToken('');
    toast('The token was removed from this device');
    renderSettings(app);
  });

  // ---- Notificări ----
  app.querySelector('#n-enable').onclick = async () => {
    try {
      const json = await subscribe(vapidKey);
      app.querySelector('#n-json').value = JSON.stringify(json);
      app.querySelector('#n-sub').hidden = false;
      toast('Notifications enabled. Copy the subscription into Secrets.', 5000);
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
    toast((await copyText(app.querySelector('#n-json').value)) ? 'Subscription copied' : 'Select and copy manually');
  });
  app.querySelector('#n-off')?.addEventListener('click', async () => {
    if (!confirm('Disable notifications on this phone?')) return;
    await unsubscribe();
    toast('Notifications disabled');
    renderSettings(app);
  });

  app.querySelector('#s-localweather')?.addEventListener('change', (e) => {
    setLocalWeatherHidden(!e.target.checked);
    toast(e.target.checked ? 'Weather shows on the home page' : 'Weather hidden');
  });

  app.querySelectorAll('[data-pref-cur]').forEach((b) => b.addEventListener('click', async () => {
    const cur = b.dataset.prefCur;
    if (cur && !cachedRate() && !(await refreshRate())) {
      toast('Could not get the EUR/RON rate. Try again when you are online.');
      return;
    }
    setDisplayCurrency(cur);
    app.querySelectorAll('[data-pref-cur]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    toast(cur ? `Prices are shown in ${cur}` : 'Prices are shown in each alert currency');
  }));

  app.querySelector('#pw-forget')?.addEventListener('click', () => {
    try { sessionStorage.removeItem('zboruri.search_password'); } catch { /* indisponibil */ }
    toast('Password forgotten');
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
      toast(`Could not generate the keys: ${e.message}`, 6000);
    }
  };
  app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    toast((await copyText(app.querySelector(`#${b.dataset.copy}`).value)) ? 'Copied' : 'Select and copy manually');
  }));
  app.querySelector('#v-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const key = app.querySelector('#v-pub').value;
      await saveVapidPublicKey(key);
      state.config.settings.vapid_public_key = key;
      toast('Public key saved. Do not forget the private key in Secrets!', 6000);
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
  return { granted: 'allowed', denied: 'blocked', default: 'not asked' }[p] || p;
}

function rememberedPassword() {
  try {
    return Boolean(sessionStorage.getItem('zboruri.search_password'));
  } catch {
    return false;
  }
}
