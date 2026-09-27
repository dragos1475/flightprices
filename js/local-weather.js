// „Vremea la tine”: locația telefonului (cu permisiune) + prognoza Open-Meteo, afișată pe pagina principală.
//
// Confidențialitate: coordonatele se rotunjesc la ~1 km înainte să fie trimise.
// Merg doar la Open-Meteo (vremea, calitatea aerului) și BigDataCloud (numele localității).
// Nu se salvează nicăieri în afara telefonului.

import { icon } from './icons.js';
import { reducedMotion } from './motion.js';
import { h, store } from './util.js';

const KEY_ENABLED = 'zboruri.localweather.enabled'; // '1' după ce utilizatorul a acceptat
const KEY_HIDDEN = 'zboruri.localweather.hidden';
const KEY_CACHE = 'zboruri.localweather.cache';
const CACHE_MINUTES = 20;

let memory = null; // ultimele date, ca să redesenăm instant la revenirea pe pagină

// ---------------------------------------------------------------------------
// Date
// ---------------------------------------------------------------------------

/** Codurile de vreme WMO -> tip (pentru animație) + descriere în română. */
function describe(code, isDay) {
  if (code === 0) return { kind: isDay ? 'clear' : 'night', text: isDay ? 'Senin' : 'Cer senin' };
  if (code === 1) return { kind: isDay ? 'clear' : 'night', text: 'Predominant senin' };
  if (code === 2) return { kind: isDay ? 'partly' : 'night-cloud', text: 'Parțial noros' };
  if (code === 3) return { kind: 'cloudy', text: 'Înnorat' };
  if (code <= 48) return { kind: 'fog', text: 'Ceață' };
  if (code <= 57) return { kind: 'drizzle', text: 'Burniță' };
  if (code <= 67) return { kind: 'rain', text: code >= 65 ? 'Ploaie puternică' : 'Ploaie' };
  if (code <= 77) return { kind: 'snow', text: 'Ninsoare' };
  if (code <= 82) return { kind: 'rain', text: 'Averse de ploaie' };
  if (code <= 86) return { kind: 'snow', text: 'Averse de ninsoare' };
  return { kind: 'storm', text: 'Furtună' };
}

const EMOJI = {
  clear: '☀️', night: '🌙', partly: '⛅', 'night-cloud': '☁️', cloudy: '☁️', fog: '🌫️',
  drizzle: '🌦️', rain: '🌧️', snow: '🌨️', storm: '⛈️',
};

function uvLabel(uv) {
  if (uv < 3) return { text: 'scăzut', cls: 'good' };
  if (uv < 6) return { text: 'moderat', cls: '' };
  if (uv < 8) return { text: 'ridicat', cls: 'warn' };
  if (uv < 11) return { text: 'foarte ridicat', cls: 'bad' };
  return { text: 'extrem', cls: 'bad' };
}

function aqiLabel(aqi) {
  if (aqi <= 20) return { text: 'bun', cls: 'good' };
  if (aqi <= 40) return { text: 'acceptabil', cls: 'good' };
  if (aqi <= 60) return { text: 'moderat', cls: '' };
  if (aqi <= 80) return { text: 'slab', cls: 'warn' };
  return { text: 'foarte slab', cls: 'bad' };
}

const WIND_DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SV', 'V', 'NV'];

/** Poziția telefonului (cere permisiunea prima dată). Întoarce {lat, lon} rotunjite la ~1 km. */
function position() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Telefonul nu oferă locația.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
      (e) => reject(new Error(e.code === 1
        ? 'Nu ai permis accesul la locație. Îl poți activa din setările telefonului (Safari/Chrome → Locație).'
        : 'Nu am putut afla locația. Încearcă din nou.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 30 * 60 * 1000 },
    );
  });
}

async function fetchWeather({ lat, lon }) {
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,uv_index'
    + '&hourly=temperature_2m,weather_code,precipitation_probability,is_day'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,wind_speed_10m_max'
    + '&forecast_days=7&forecast_hours=25&timezone=auto';
  const [forecast, air, place] = await Promise.all([
    fetch(forecastUrl).then((r) => r.json()),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm2_5&timezone=auto`)
      .then((r) => r.json()).catch(() => null),
    fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ro`)
      .then((r) => r.json()).catch(() => null),
  ]);
  if (!forecast?.current) throw new Error('Serviciul de vreme nu a răspuns.');
  return {
    at: Date.now(),
    coords: { lat, lon },
    place: place?.city || place?.locality || place?.principalSubdivision || 'Locația ta',
    region: place?.city && place?.principalSubdivision !== place?.city ? place?.principalSubdivision : place?.countryName,
    forecast,
    air: air?.current || null,
  };
}

function cached() {
  try {
    const c = JSON.parse(store.get(KEY_CACHE) || 'null');
    return c && Date.now() - c.at < CACHE_MINUTES * 60 * 1000 ? c : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Afișare
// ---------------------------------------------------------------------------

/** Iconiță animată (SVG) pentru vremea de acum. */
function art(kind) {
  const cloud = (x, y, s, cls = '') => `<g class="wx-cloud ${cls}" transform="translate(${x} ${y}) scale(${s})">
    <path d="M18 30h26a10 10 0 0 0 0-20 14 14 0 0 0-27-2A11 11 0 0 0 18 30z"/></g>`;
  const drops = (n, cls) => Array.from({ length: n }, (_, i) => `<line class="${cls}" x1="${22 + i * 10}" y1="52" x2="${19 + i * 10}" y2="60" style="animation-delay:${(i * 0.23).toFixed(2)}s"/>`).join('');
  const flakes = (n) => Array.from({ length: n }, (_, i) => `<text class="wx-flake" x="${20 + i * 11}" y="58" style="animation-delay:${(i * 0.4).toFixed(1)}s">❄</text>`).join('');
  const sun = (x, y, r) => `<g class="wx-sun" transform="translate(${x} ${y})">
    <g class="wx-rays">${Array.from({ length: 8 }, (_, i) => `<line x1="0" y1="${-r - 5}" x2="0" y2="${-r - 11}" transform="rotate(${i * 45})"/>`).join('')}</g>
    <circle r="${r}"/></g>`;
  const moon = `<g class="wx-moon"><path d="M46 14a18 18 0 1 0 14 29 15 15 0 1 1-14-29z"/></g>
    <circle class="wx-star" cx="18" cy="16" r="1.4"/><circle class="wx-star" cx="26" cy="8" r="1" style="animation-delay:.6s"/>
    <circle class="wx-star" cx="12" cy="30" r="1" style="animation-delay:1.2s"/>`;
  const scenes = {
    clear: sun(36, 34, 13),
    night: moon,
    partly: `${sun(26, 24, 10)}${cloud(14, 20, 1)}`,
    'night-cloud': `${moon}${cloud(14, 24, .9)}`,
    cloudy: `${cloud(4, 10, .8, 'back')}${cloud(14, 20, 1)}`,
    fog: `${cloud(10, 6, .9)}<g class="wx-fog"><line x1="10" y1="46" x2="62" y2="46"/><line x1="16" y1="54" x2="56" y2="54"/><line x1="10" y1="62" x2="50" y2="62"/></g>`,
    drizzle: `${cloud(10, 10, 1)}${drops(3, 'wx-drop small')}`,
    rain: `${cloud(10, 10, 1)}${drops(4, 'wx-drop')}`,
    snow: `${cloud(10, 10, 1)}${flakes(4)}`,
    storm: `${cloud(10, 8, 1)}<path class="wx-bolt" d="M36 40l-7 12h6l-4 12 11-15h-6l4-9z"/>${drops(2, 'wx-drop')}`,
  };
  return `<svg class="wx-art ${reducedMotion() ? 'still' : ''}" viewBox="0 0 72 72" aria-hidden="true">${scenes[kind] || scenes.cloudy}</svg>`;
}

const hh = (iso) => iso.slice(11, 16);
const DAYS = ['Dum', 'Lun', 'Mar', 'Mie', 'Joi', 'Vin', 'Sâm'];
const dayName = (iso, i) => (i === 0 ? 'Azi' : i === 1 ? 'Mâine' : DAYS[new Date(`${iso}T12:00:00`).getDay()]);

/** Sfatul zilei, din prognoza pe următoarele ore și ziua de azi. */
function advice(f) {
  const hours = f.hourly.time.map((t, i) => ({ t, p: f.hourly.precipitation_probability[i] ?? 0 })).slice(0, 12);
  const rain = hours.find((x) => x.p >= 50);
  const tips = [];
  if (rain) tips.push(`☂️ Ia umbrela: ploaie probabilă pe la ${hh(rain.t)} (${rain.p}%).`);
  if ((f.daily.uv_index_max[0] ?? 0) >= 6) tips.push('🧴 UV ridicat azi: folosește protecție solară.');
  if (f.current.apparent_temperature <= 0) tips.push('🧣 Se simte sub zero grade: îmbracă-te gros.');
  if ((f.daily.wind_speed_10m_max[0] ?? 0) >= 45) tips.push('💨 Vânt puternic azi.');
  if (!tips.length) tips.push(f.current.is_day ? '😎 Vreme bună de ieșit afară.' : '🌙 O seară liniștită.');
  return tips[0];
}

function render(box, data) {
  const f = data.forecast;
  const c = f.current;
  const now = describe(c.weather_code, c.is_day);
  const uv = uvLabel(c.uv_index ?? 0);
  const aqi = data.air?.european_aqi;
  const aqiInfo = aqi !== undefined && aqi !== null ? aqiLabel(aqi) : null;
  const wind = WIND_DIRS[Math.round((c.wind_direction_10m % 360) / 45) % 8];
  const nextRain = Math.max(...f.hourly.precipitation_probability.slice(0, 6).map((p) => p ?? 0));
  const d = f.daily;
  const lo = Math.min(...d.temperature_2m_min);
  const hi = Math.max(...d.temperature_2m_max);
  const span = hi - lo || 1;

  box.innerHTML = `
    <div class="lw lw-${now.kind}">
      <div class="lw-now">
        ${art(now.kind)}
        <div class="lw-main">
          <div class="lw-place">${icon('pin', 14)} ${h(data.place)}${data.region ? `<small>${h(data.region)}</small>` : ''}</div>
          <div class="lw-temp"><span data-count="${Math.round(c.temperature_2m)}">${Math.round(c.temperature_2m)}</span>°</div>
          <div class="lw-desc">${now.text} · se simte ca ${Math.round(c.apparent_temperature)}°</div>
          <div class="lw-range">max ${Math.round(d.temperature_2m_max[0])}° · min ${Math.round(d.temperature_2m_min[0])}°</div>
        </div>
      </div>
      <div class="lw-tip">${h(advice(f))}</div>
      <div class="lw-stats">
        <div><span>💧 Umiditate</span><b>${c.relative_humidity_2m}%</b></div>
        <div><span>💨 Vânt</span><b><i class="lw-arrow" style="transform:rotate(${c.wind_direction_10m + 180}deg)">↑</i> ${Math.round(c.wind_speed_10m)} km/h ${wind}</b></div>
        <div><span>☀️ UV</span><b class="${uv.cls}-text">${Math.round(c.uv_index ?? 0)} · ${uv.text}</b></div>
        ${aqiInfo ? `<div><span>🌿 Aer</span><b class="${aqiInfo.cls}-text">${aqi} · ${aqiInfo.text}</b></div>` : ''}
        <div><span>🌧️ Ploaie (6h)</span><b>${nextRain}%</b></div>
        ${Date.now() > new Date(d.sunset[0]).getTime() && d.sunrise[1]
          ? `<div><span>🌅 Răsărit mâine</span><b>${hh(d.sunrise[1])}</b></div>`
          : `<div><span>🌅 Răsărit / 🌇 apus</span><b>${hh(d.sunrise[0])} / ${hh(d.sunset[0])}</b></div>`}
      </div>
      <div class="lw-hours">${f.hourly.time.slice(0, 25).map((t, i) => {
        // prima celulă („Acum”) folosește valorile curente, ca să se potrivească cu cardul mare
        const w = i === 0 ? now : describe(f.hourly.weather_code[i], f.hourly.is_day[i]);
        const temp = i === 0 ? c.temperature_2m : f.hourly.temperature_2m[i];
        const p = f.hourly.precipitation_probability[i] ?? 0;
        return `<div class="${i === 0 ? 'now' : ''}"><span>${i === 0 ? 'Acum' : hh(t)}</span><i>${EMOJI[w.kind]}</i>
          <b>${Math.round(temp)}°</b><small class="${p >= 50 ? 'rain' : ''}">${p ? `${p}%` : '&nbsp;'}</small></div>`;
      }).join('')}</div>
      <details class="lw-days">
        <summary>Prognoza pe 7 zile ${icon('chevronDown', 14)}</summary>
        ${d.time.map((t, i) => {
          const w = describe(d.weather_code[i], 1);
          const left = ((d.temperature_2m_min[i] - lo) / span) * 100;
          const width = Math.max(6, ((d.temperature_2m_max[i] - d.temperature_2m_min[i]) / span) * 100);
          return `<div class="lw-day">
            <span class="lw-dname">${dayName(t, i)}</span>
            <span class="lw-dicon">${EMOJI[w.kind]}${(d.precipitation_probability_max[i] ?? 0) >= 30 ? `<small>${d.precipitation_probability_max[i]}%</small>` : ''}</span>
            <span class="lw-dmin">${Math.round(d.temperature_2m_min[i])}°</span>
            <span class="lw-bar"><i style="left:${left}%;width:${width}%"></i></span>
            <span class="lw-dmax">${Math.round(d.temperature_2m_max[i])}°</span>
          </div>`;
        }).join('')}
      </details>
      <div class="lw-foot">Actualizat ${new Date(data.at).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })} · Open-Meteo
        <button type="button" class="linklike small" data-lw-refresh>Actualizează</button></div>
    </div>`;
  box.querySelector('[data-lw-refresh]')?.addEventListener('click', () => load(box, true));
}

function renderAsk(box, message = '') {
  box.innerHTML = `
    <div class="lw-ask">
      <div class="lw-ask-art">${art('partly')}</div>
      <div class="row-main">
        <b>Vremea la tine</b>
        <span class="row-sub">${message ? h(message) : 'Temperatura, ploaia, vântul, UV-ul și prognoza pe 7 zile, pentru locul în care ești.'}</span>
        <div class="btn-row" style="margin-top:10px">
          <button type="button" class="btn primary sm" data-lw-enable>${icon('pin', 14)} Arată vremea la mine</button>
          <button type="button" class="btn sm" data-lw-hide>Nu acum</button>
        </div>
        <span class="lw-privacy">Locația se rotunjește la ~1 km și nu se salvează pe GitHub.</span>
      </div>
    </div>`;
  box.querySelector('[data-lw-enable]').addEventListener('click', () => {
    store.set(KEY_ENABLED, '1');
    load(box, true);
  });
  box.querySelector('[data-lw-hide]').addEventListener('click', () => {
    store.set(KEY_HIDDEN, '1');
    box.remove();
  });
}

async function load(box, force = false) {
  const hit = !force && (memory || cached());
  if (hit) {
    render(box, hit);
    return;
  }
  if (!box.querySelector('.lw')) {
    box.innerHTML = '<div class="lw lw-loading"><div class="sk" style="height:110px;border-radius:18px"></div></div>';
  }
  try {
    const coords = await position();
    const data = await fetchWeather(coords);
    memory = data;
    store.set(KEY_CACHE, JSON.stringify(data));
    if (box.isConnected) render(box, data);
  } catch (e) {
    if (box.isConnected) renderAsk(box, e.message);
  }
}

/** Cardul de pe pagina principală. Returnează HTML-ul containerului; conținutul se încarcă cu mountLocalWeather. */
export function localWeatherSlot() {
  if (store.get(KEY_HIDDEN) === '1') return '';
  return '<div class="section-label"><span>Vremea la tine</span></div><div class="card lw-card" id="local-weather"></div>';
}

export async function mountLocalWeather(root) {
  const box = root.querySelector('#local-weather');
  if (!box) return;
  const hit = memory || cached();
  if (hit) {
    render(box, hit);
    return;
  }
  // Nu cerem locația automat: doar dacă utilizatorul a acceptat înainte (sau permisiunea e deja dată)
  let granted = store.get(KEY_ENABLED) === '1';
  try {
    const perm = await navigator.permissions?.query({ name: 'geolocation' });
    if (perm?.state === 'granted') granted = true;
    if (perm?.state === 'denied') granted = false;
  } catch { /* browserul nu suportă verificarea */ }
  if (granted) load(box);
  else renderAsk(box);
}

/** Pentru Setări: ascunde / reafișează cardul. */
export function localWeatherHidden() {
  return store.get(KEY_HIDDEN) === '1';
}
export function setLocalWeatherHidden(hidden) {
  store.set(KEY_HIDDEN, hidden ? '1' : '');
}
