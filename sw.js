// Service worker: permite instalarea aplicației, funcționarea offline (ultimele date văzute)
// și primirea notificărilor push chiar dacă aplicația este închisă.

const CACHE = 'zboruri-v22';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/util.js',
  'js/budget.js',
  'js/data.js',
  'js/push.js',
  'js/chart.js',
  'js/icons.js',
  'js/ui.js',
  'js/results-view.js',
  'js/flags.js',
  'js/insights.js',
  'js/heatmap.js',
  'js/motion.js',
  'js/gestures.js',
  'js/onboarding.js',
  'js/geo.js',
  'js/media.js',
  'js/weather.js',
  'js/currency.js',
  'js/currency-ui.js',
  'js/map.js',
  'js/trip.js',
  'js/local-weather.js',
  'js/credits.js',
  'js/password.js',
  'js/price-check.js',
  'js/state.js',
  'js/screens/list.js',
  'js/screens/form.js',
  'js/screens/detail.js',
  'js/screens/settings.js',
  'js/screens/searches.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Mai întâi internetul (ca să vezi mereu ultima versiune), iar fără internet: copia salvată.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: 'no-cache' }) // verifică mereu dacă există o versiune nouă
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          // fișierele de date au ?v=... în adresă; le salvăm fără, ca să le găsim offline
          const key = url.pathname.includes('/data/') || url.pathname.includes('/config/') ? url.origin + url.pathname : req;
          caches.open(CACHE).then((c) => c.put(key, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => {
        if (r) return r;
        // pagina principală doar pentru navigare; fișierele lipsă rămân erori (nu HTML în loc de JSON)
        if (req.mode === 'navigate') return caches.match('index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      })),
  );
});

// O notificare trimisă de scriptul Python (Web Push)
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Flight Prices', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Flight Prices', {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      data: { url: data.url || './', app_url: data.app_url || './' },
      actions: data.app_url ? [{ action: 'app', title: 'Open app' }] : [],
    }),
  );
});

// Atingerea notificării: deschide Google Flights (sau aplicația, pentru butonul „Deschide aplicația”)
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const target = event.action === 'app' ? d.app_url : d.url || d.app_url || './';
  event.waitUntil(self.clients.openWindow(new URL(target, self.registration.scope).href));
});
