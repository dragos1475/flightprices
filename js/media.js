// Poze cu destinația, de pe Wikipedia (imaginea principală a articolului despre oraș).
// Gratuit, fără cheie. Licența imaginilor cere menționarea sursei: afișăm „Foto: Wikipedia”.

import { store } from './util.js';

const CACHE_PREFIX = 'zboruri.photo2.'; // „2” = după trecerea la lățimile acceptate de Wikimedia
const BAD_IMAGE = /(flag|drapel|coat[_ ]of[_ ]arms|stema|blason|wappen|seal|logo|map|harta|hartă|locator|location|position|\.svg)/i;

/**
 * Versiune micșorată a unei imagini Wikimedia (lățime în pixeli).
 * Wikimedia acceptă doar anumite lățimi (ex. 250, 330, 500, 960, 1280), altfel răspunde cu eroare.
 */
function resized(source, width, originalWidth) {
  const clean = source.split('?')[0];
  const m = clean.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/([0-9a-f])\/([0-9a-f]{2})\/(.+)$/);
  if (!m || !originalWidth || originalWidth <= width) return clean;
  return `${m[1]}/thumb/${m[2]}/${m[3]}/${m[4]}/${width}px-${m[4]}`;
}

async function summary(lang, title) {
  const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!res.ok) return null;
  const d = await res.json();
  if (d.type !== 'standard') return null; // ex. pagină de dezambiguizare
  const img = d.originalimage;
  if (!img || BAD_IMAGE.test(img.source) || img.width < 700 || img.width / img.height < 1.15) return null;
  return {
    hero: resized(img.source, 1280, img.width),
    thumb: resized(img.source, 250, img.width),
    original: img.source.split('?')[0],
    page: d.content_urls?.desktop?.page || '',
    title: d.title,
  };
}

/** Încarcă o imagine; dacă varianta micșorată nu merge, încearcă originalul. Întoarce URL-ul care a mers. */
export function loadImage(url, fallback) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => {
      if (!fallback || fallback === url) return resolve(null);
      const second = new Image();
      second.onload = () => resolve(fallback);
      second.onerror = () => resolve(null);
      second.src = fallback;
    };
    img.src = url;
  });
}

/**
 * Poza unui oraș: întâi Wikipedia în română, apoi în engleză.
 * Întoarce {hero, thumb, original, page, title} sau null (atunci aplicația folosește un fundal colorat).
 */
export async function cityPhoto(names) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  if (!list.length) return null;
  const key = CACHE_PREFIX + list.join('|');
  const cached = store.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch { /* ignorăm */ }
  }
  for (const lang of ['ro', 'en']) {
    for (const title of list) {
      try {
        const found = await summary(lang, title);
        if (found) {
          store.set(key, JSON.stringify(found));
          return found;
        }
      } catch {
        return null; // fără internet: nu salvăm nimic, încercăm data viitoare
      }
    }
  }
  store.set(key, 'null'); // nicio poză potrivită: nu mai întrebăm
  return null;
}
