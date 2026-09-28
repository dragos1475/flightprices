// „Trezește” GitHub când deschizi aplicația și o căutare programată a întârziat.
// GitHub își sare uneori rulările programate (când e aglomerat). Dacă deschizi aplicația după ora aleasă
// și căutarea încă nu s-a făcut, scriem data/wake.json: modificarea pornește imediat workflow-ul (ca la „Save”).
//
// Protecții (ca să nu se caute de două ori și să nu pornească la fiecare deschidere):
//   - pornește DOAR dacă o alertă are căutarea întârziată (regula e aceeași ca în scraper/main.py);
//   - cel mult o dată la 20 de minute (ținut minte pe telefon și în data/wake.json, pentru mai multe dispozitive);
//   - robotul caută doar ce e încă de căutat: dacă între timp a venit și rularea programată, a doua nu mai caută nimic.

import { isActive, isOverdue, hourRO } from './budget.js';
import { hasWriteAccess, loadJSON, updateJSONFile } from './data.js';
import { ensureAlerts, loadResults, state } from './state.js';
import { store, toast, todayRO } from './util.js';

const WAIT_MS = 20 * 60 * 1000;
const LOCAL_KEY = 'zboruri.last_wake';
let running = false;

/** Alertele active a căror căutare programată a întârziat (azi, ora României). */
export function overdueAlerts(alerts = state.alerts || []) {
  const day = todayRO();
  const hour = hourRO();
  return alerts.filter((a) => isActive(a, day) && isOverdue(a, state.results[a.id], day, hour));
}

/** Verifică și, dacă e cazul, pornește căutarea pe GitHub. */
export async function wakeIfOverdue() {
  if (running || !hasWriteAccess()) return;
  const last = Number(store.get(LOCAL_KEY) || 0);
  if (Date.now() - last < WAIT_MS) return;
  running = true;
  try {
    const alerts = await ensureAlerts(true);
    await Promise.all(alerts.filter((a) => isActive(a, todayRO())).map((a) => loadResults(a.id)));
    const late = overdueAlerts(alerts);
    if (!late.length) return;
    // alt dispozitiv (sau alt tab) a trezit deja GitHub de curând?
    const wake = await loadJSON('data/wake.json').catch(() => null);
    if (wake?.requested_at && Date.now() - Date.parse(wake.requested_at) < WAIT_MS) {
      store.set(LOCAL_KEY, String(Date.parse(wake.requested_at)));
      return;
    }
    const names = late.map((a) => a.name || a.id);
    await updateJSONFile('data/wake.json', (doc) => {
      doc.requested_at = new Date().toISOString();
      doc.reason = `Scheduled search late: ${names.join(', ')}`;
    }, `Wake up: ${names.join(', ')}`, {});
    store.set(LOCAL_KEY, String(Date.now()));
    toast(`GitHub was late — the scheduled search is starting now (${names.join(', ')}).`, 5000);
  } catch (e) {
    console.warn('Nu am putut trezi GitHub:', e.message);
  } finally {
    running = false;
  }
}
