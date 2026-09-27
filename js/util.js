// Funcții ajutătoare folosite în toată aplicația.

/** Protejează textul înainte de a-l pune în HTML (evită probleme cu < > & "). */
export function h(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Data de azi în România, ca text 'AAAA-LL-ZZ'. */
export function todayRO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date());
}

/** Adună zile la o dată 'AAAA-LL-ZZ' și întoarce tot 'AAAA-LL-ZZ'. */
export function addDays(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** '2026-11-12' -> '12.11' */
export function shortDate(iso) {
  if (!iso || iso.length < 10) return iso || '';
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

const WEEKDAYS = ['dum', 'lun', 'mar', 'mie', 'joi', 'vin', 'sâm'];
/** '2026-11-12' -> 'joi 12.11' */
export function dayDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  return `${WEEKDAYS[d.getUTCDay()]} ${shortDate(iso)}`;
}

/** '2026-11-12' -> '12.11.2026' */
export function longDate(iso) {
  if (!iso || iso.length < 10) return iso || '';
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}

/** Data și ora (ex. '2026-09-27T08:17:02+03:00') -> '27.09.2026, 08:17' */
export function dateTime(isoDateTime) {
  if (!isoDateTime) return '—';
  const d = new Date(isoDateTime);
  if (isNaN(d)) return isoDateTime;
  return new Intl.DateTimeFormat('ro-RO', {
    timeZone: 'Europe/Bucharest', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

/** '2026-11-12 06:10' -> '06:10' */
export function hour(t) {
  return t && t.length >= 16 ? t.slice(11, 16) : t || '';
}

/** 155 (minute) -> '2h 35m' */
export function duration(min) {
  if (!min && min !== 0) return '';
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

/** 1234.5 -> '1.235' (format românesc, fără zecimale) */
export function money(value, currency) {
  if (value === null || value === undefined) return '—';
  const n = new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(value);
  return currency ? `${n} ${currency}` : n;
}

/** Elimină diacriticele și face litere mici (pentru căutare). */
export function fold(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Transformă un nume în identificator sigur pentru fișiere: 'Roma în noiembrie' -> 'roma-in-noiembrie' */
export function slugify(text) {
  return fold(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'alerta';
}

let toastTimer;
/** Mesaj scurt, afișat câteva secunde jos pe ecran. */
export function toast(message, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Copiază text în clipboard (cu variantă de rezervă pentru browsere vechi). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Citire/scriere sigură în localStorage (poate lipsi în modul privat). */
export const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value === null || value === undefined || value === '') localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};
