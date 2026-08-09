// Service Worker fuer Offline-Start (Umbau Punkt 5). Bewusst ohne Workbox/
// vite-plugin-pwa: eine Vorab-Liste der zu cachenden Dateien muesste die von
// Vite gehashten Bundle-Namen kennen, das bräuchte einen zusätzlichen
// Build-Schritt. Cache-on-fetch kommt ohne das aus — jede same-origin-
// Anfrage wird beim ersten (Online-)Laden automatisch mitgecacht, App-Shell
// und die sql.js-WASM-Datei eingeschlossen, weil beide beim normalen
// Start ohnehin angefragt werden.
//
// CACHE_VERSION von Hand hochzaehlen loescht beim naechsten Deploy alte
// Cache-Eintraege (siehe "activate"). Nicht bei jedem Inhalts-Deploy noetig:
// Vites Datei-Hashes sorgen schon dafuer, dass nie eine veraltete JS/CSS-
// Datei unter einer neuen index.html landet. Nur bei einer Aenderung an
// dieser Datei selbst hochzaehlen.
const CACHE_VERSION = 'lifeapp-shell-v1';

self.addEventListener('install', () => {
  // Bewusst kein skipWaiting() hier — der neue Service Worker soll erst
  // aktiv werden, wenn der Nutzer im Hinweis (UpdateBanner.tsx) auf
  // "Neu laden" tippt, sonst geht ein halb ausgefuelltes Formular verloren.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // GitHub-API u. ae. nie abfangen

  if (request.mode === 'navigate') {
    // Netzwerk zuerst: online soll immer die aktuelle index.html (mit den
    // aktuellen Bundle-Verweisen) ankommen, nicht eine gecachte alte.
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch {
          // Offline und diese genaue Route war nie im Cache (z. B. Direkt-
          // aufruf von /erfassen nach einem Reload) — die App-Shell unter
          // dem Registrierungs-Scope uebernimmt, main.tsx routet anhand
          // von window.location.pathname weiter.
          const cached = await cache.match(request);
          return cached ?? (await cache.match(self.registration.scope)) ?? Response.error();
        }
      }),
    );
    return;
  }

  // Alles andere (JS/CSS/WASM/Fonts/Icons): Cache zuerst. Vite-Bundles
  // tragen einen Inhalts-Hash im Dateinamen, ein Treffer ist deshalb immer
  // inhaltlich korrekt — kein erneuter Netzwerk-Roundtrip noetig.
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (err) {
        if (cached) return cached;
        throw err;
      }
    }),
  );
});
