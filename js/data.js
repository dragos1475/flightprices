// Citirea datelor (fișiere JSON din repository) și salvarea alertelor prin GitHub API.
//
// - Fără token: datele se citesc din GitHub Pages (pot întârzia câteva minute după o rulare).
// - Cu token: datele se citesc direct prin GitHub API (mereu la zi) și alertele pot fi salvate.

import { store } from './util.js';

const API = 'https://api.github.com';
const KEY_TOKEN = 'zboruri.github_token';
const KEY_REPO = 'zboruri.github_repo';
const KEY_BRANCH = 'zboruri.github_branch';

// ---------------------------------------------------------------------------
// Setări GitHub (păstrate doar pe acest dispozitiv)
// ---------------------------------------------------------------------------

/** Deduce 'proprietar/repository' din adresa GitHub Pages (ex. ion.github.io/zboruri/). */
function guessRepo() {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return '';
  const owner = host.replace('.github.io', '');
  const first = location.pathname.split('/').filter(Boolean)[0];
  return first ? `${owner}/${first}` : `${owner}/${host}`;
}

export function getRepo() {
  return store.get(KEY_REPO) || guessRepo();
}
export function setRepo(value) {
  store.set(KEY_REPO, (value || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, ''));
}
export function getBranch() {
  return store.get(KEY_BRANCH) || 'main';
}
export function setBranch(value) {
  store.set(KEY_BRANCH, (value || '').trim());
}
export function getToken() {
  return store.get(KEY_TOKEN) || '';
}
export function setToken(value) {
  store.set(KEY_TOKEN, (value || '').trim());
}
export function hasWriteAccess() {
  return Boolean(getToken() && getRepo());
}

// ---------------------------------------------------------------------------
// Base64 cu diacritice (btoa/atob lucrează doar cu Latin-1)
// ---------------------------------------------------------------------------
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Apeluri GitHub API
// ---------------------------------------------------------------------------
async function gh(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${getToken()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).message || '';
    } catch { /* fără detalii */ }
    const err = new Error(explainGithubError(res.status, detail));
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function explainGithubError(status, detail) {
  switch (status) {
    case 401: return 'Tokenul GitHub este greșit sau a expirat (401).';
    case 403: return `Tokenul nu are permisiunea necesară (403). Verifică „Contents: Read and write”. ${detail}`;
    case 404: return 'Repository-ul sau fișierul nu a fost găsit (404). Verifică numele repository-ului și accesul tokenului.';
    case 409: return 'Fișierul a fost modificat între timp (409). Încearcă din nou.';
    case 422: return `GitHub a refuzat modificarea (422). ${detail}`;
    default: return `Eroare GitHub ${status}. ${detail}`;
  }
}

/** Citește un fișier din repository prin API. Întoarce {text, sha} sau null dacă nu există. */
async function readFileApi(path) {
  try {
    const data = await gh(`/repos/${getRepo()}/contents/${path}?ref=${encodeURIComponent(getBranch())}`);
    if (data.content !== undefined && data.encoding === 'base64' && data.content) {
      return { text: fromBase64(data.content), sha: data.sha };
    }
    // fișiere peste 1 MB: conținutul vine separat
    const raw = await fetch(data.download_url, { cache: 'no-store' });
    return { text: await raw.text(), sha: data.sha };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

/** Scrie (creează sau înlocuiește) un fișier în repository = un commit. */
async function writeFileApi(path, text, sha, message) {
  return gh(`/repos/${getRepo()}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: toBase64(text), sha: sha || undefined, branch: getBranch() }),
  });
}

/** Verifică dacă tokenul funcționează și are drept de scriere. */
export async function testAccess() {
  const repo = await gh(`/repos/${getRepo()}`);
  const canPush = repo.permissions ? repo.permissions.push : null;
  return { name: repo.full_name, canPush, defaultBranch: repo.default_branch };
}

// ---------------------------------------------------------------------------
// Citirea fișierelor JSON (config/ și data/)
// ---------------------------------------------------------------------------

/**
 * Citește un fișier JSON al aplicației. Întoarce null dacă nu există.
 * Cu token: prin API (mereu la zi). Fără token: din site (GitHub Pages).
 */
export async function loadJSON(path) {
  if (hasWriteAccess()) {
    try {
      const file = await readFileApi(path);
      return file ? JSON.parse(file.text) : null;
    } catch (e) {
      console.warn('Citire prin API eșuată, încerc din site:', path, e.message);
    }
  }
  const res = await fetch(`${path}?v=${Date.now()}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Nu pot citi ${path} (${res.status})`);
  return res.json();
}

/**
 * Modifică un fișier JSON din repository în siguranță:
 * citește versiunea cea mai nouă, aplică `change(doc)`, apoi salvează.
 * Dacă altcineva (ex. robotul de căutare) a modificat fișierul între timp, reîncearcă.
 */
export async function updateJSONFile(path, change, message, emptyDoc) {
  if (!hasWriteAccess()) throw new Error('Adaugă tokenul GitHub în Setări ca să poți salva.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const file = await readFileApi(path);
    const doc = file ? JSON.parse(file.text) : structuredClone(emptyDoc);
    const result = change(doc);
    try {
      await writeFileApi(path, JSON.stringify(doc, null, 2) + '\n', file?.sha, message);
      return result === undefined ? doc : result;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
    }
  }
  throw new Error('Nu am reușit să salvez după 3 încercări. Încearcă din nou.');
}

/** Adaugă sau înlocuiește o alertă în data/alerts.json. */
export function saveAlert(alert) {
  return updateJSONFile('data/alerts.json', (doc) => {
    doc.alerts = doc.alerts || [];
    const i = doc.alerts.findIndex((a) => a.id === alert.id);
    if (i >= 0) doc.alerts[i] = alert;
    else doc.alerts.push(alert);
  }, `Alertă salvată: ${alert.name}`, { alerts: [] });
}

/** Șterge o alertă din data/alerts.json. */
export function deleteAlert(id, name) {
  return updateJSONFile('data/alerts.json', (doc) => {
    doc.alerts = (doc.alerts || []).filter((a) => a.id !== id);
  }, `Alertă ștearsă: ${name || id}`, { alerts: [] });
}

/** Adaugă o destinație în config/destinations_custom.json. */
export function saveCustomDestination(dest) {
  return updateJSONFile('config/destinations_custom.json', (doc) => {
    doc.destinations = (doc.destinations || []).filter((d) => d.id !== dest.id);
    doc.destinations.push(dest);
  }, `Destinație adăugată: ${dest.name}`, { destinations: [] });
}

/** Salvează cheia publică VAPID în config/settings.json. */
export function saveVapidPublicKey(key) {
  return updateJSONFile('config/settings.json', (doc) => {
    doc.vapid_public_key = key;
  }, 'Cheie publică VAPID actualizată', {});
}

// ---------------------------------------------------------------------------
// Căutări rapide (one-time)
// ---------------------------------------------------------------------------

/** Lista fișierelor dintr-un folder al repository-ului (doar cu token). */
export async function listDir(path) {
  try {
    return await gh(`/repos/${getRepo()}/contents/${path}?ref=${encodeURIComponent(getBranch())}`);
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

/** Creează un fișier nou (un commit). */
export async function createFile(path, text, message) {
  return writeFileApi(path, text, null, message);
}

/** Șterge un fișier (un commit). */
export async function deleteFile(path, message) {
  const data = await gh(`/repos/${getRepo()}/contents/${path}?ref=${encodeURIComponent(getBranch())}`);
  return gh(`/repos/${getRepo()}/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha: data.sha, branch: getBranch() }),
  });
}

/**
 * Semnătura unei căutări rapide: HMAC-SHA256(cheie, text), unde
 * cheie = PBKDF2-SHA256(parola, "zboruri:<id>", 200000 iterații).
 * Parola NU pleacă de pe telefon; scriptul din GitHub verifică semnătura cu secretul SEARCH_PASSWORD.
 * (Aceeași formulă este în scraper/one_time.py.)
 */
export async function signSearch(id, text, password) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(`zboruri:${id}`), iterations: 200000 }, base, 256);
  const key = await crypto.subtle.importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Linkuri utile către GitHub. */
export function githubLinks() {
  const repo = getRepo();
  const branch = getBranch();
  if (!repo) return {};
  return {
    repo: `https://github.com/${repo}`,
    editAlerts: `https://github.com/${repo}/edit/${branch}/data/alerts.json`,
    actions: `https://github.com/${repo}/actions/workflows/cautare-zboruri.yml`,
    secrets: `https://github.com/${repo}/settings/secrets/actions`,
  };
}
