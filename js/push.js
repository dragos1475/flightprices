// Service worker, notificări push și generarea cheilor VAPID.

/** Înregistrează service worker-ul (necesar pentru instalare și notificări). */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('sw.js', { scope: './' });
  } catch (e) {
    console.warn('Service worker neînregistrat:', e);
    return null;
  }
}

/** Rulează aplicația ca aplicație instalată (de pe ecranul principal)? */
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Ce suportă acest browser. */
export function pushSupport() {
  return {
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
    permission: 'Notification' in window ? Notification.permission : 'indisponibil',
    standalone: isStandalone(),
    ios: isIOS(),
  };
}

function base64UrlToBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64Url(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Service worker-ul activ; dacă nu pornește în câteva secunde, întoarce null (nu blocăm ecranul). */
async function readyRegistration(ms = 3000) {
  if (!('serviceWorker' in navigator)) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => { setTimeout(() => resolve(null), ms); }),
  ]);
}

/** Abonamentul curent (sau null). */
export async function currentSubscription() {
  const reg = await readyRegistration(1500);
  return reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
}

/**
 * Cere permisiunea și creează abonamentul push.
 * Întoarce abonamentul ca obiect JSON (de copiat în secretul PUSH_SUBSCRIPTION).
 */
export async function subscribe(vapidPublicKey) {
  if (!vapidPublicKey || vapidPublicKey.startsWith('PUNE_AICI')) {
    throw new Error('Lipsește cheia publică VAPID din config/settings.json. Generează cheile mai jos, în secțiunea „Chei VAPID”.');
  }
  const support = pushSupport();
  if (!support.serviceWorker || !support.pushManager) {
    if (support.ios && !support.standalone) {
      throw new Error('Pe iPhone, notificările merg doar după ce adaugi aplicația pe ecranul principal (Share → „Adaugă pe ecranul principal”) și o deschizi de acolo.');
    }
    throw new Error('Acest browser nu suportă notificări push.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Nu ai permis notificările. Le poți activa din setările telefonului/browserului.');

  const reg = await readyRegistration();
  if (!reg) throw new Error('Aplicația nu a putut porni serviciul de notificări. Reîncarcă pagina și încearcă din nou.');
  const key = base64UrlToBytes(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  // Dacă abonamentul existent a fost făcut cu altă cheie, îl refacem
  if (sub && sub.options && sub.options.applicationServerKey) {
    const existing = new Uint8Array(sub.options.applicationServerKey);
    if (existing.length !== key.length || existing.some((b, i) => b !== key[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  return sub.toJSON();
}

export async function unsubscribe() {
  const sub = await currentSubscription();
  if (sub) await sub.unsubscribe();
}

/** Afișează o notificare locală (verifică doar că telefonul poate afișa notificări). */
export async function localTestNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    throw new Error('Activează mai întâi notificările.');
  }
  const reg = await readyRegistration();
  if (!reg) throw new Error('Serviciul de notificări nu este pornit. Reîncarcă pagina.');
  await reg.showNotification('🧪 Test local', {
    body: 'Telefonul poate afișa notificări. Pentru testul complet, rulează workflow-ul cu „test notificări”.',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    data: { url: './' },
  });
}

/**
 * Generează o pereche de chei VAPID direct în browser (Web Crypto).
 * Cheia privată rămâne doar pe acest ecran: o copiezi în GitHub Secrets.
 */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const x = base64UrlToBytes(jwk.x);
  const y = base64UrlToBytes(jwk.y);
  const pub = new Uint8Array(65);
  pub[0] = 4; // format "necomprimat": 0x04 || X || Y
  pub.set(x, 1);
  pub.set(y, 33);
  return { publicKey: bytesToBase64Url(pub), privateKey: jwk.d };
}
