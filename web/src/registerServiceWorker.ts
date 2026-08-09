// Registriert public/sw.js und erkennt neue Versionen. Nur in Produktion:
// im Dev-Server wuerde ein Service Worker Vites unbundelte ESM-Module samt
// HMR durcheinanderbringen.
export function registerServiceWorker(onUpdateAvailable: () => void): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  function register() {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
      // Schon ein wartender Service Worker vorhanden (z. B. Tab war offen,
      // waehrend ein neues Deploy passierte) — Hinweis sofort zeigen.
      if (registration.waiting) onUpdateAvailable();

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // "installed" + bereits ein aktiver Controller = ein echtes
          // Update, nicht die allererste Installation (dort gibt es noch
          // keinen Controller — sonst wuerde der Hinweis faelschlich schon
          // beim ersten Besuch erscheinen).
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateAvailable();
          }
        });
      });
    });
  }

  // React mountet erst nach dem "load"-Event — wer erst dann darauf wartet,
  // verpasst es fuer immer (Events feuern nur einmal). document.readyState
  // deckt den Fall ab, dass das Laden bereits abgeschlossen ist.
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register);
  }

  // Erst wenn der neue Service Worker durch skip-waiting() die Kontrolle
  // uebernimmt (siehe activateWaitingServiceWorker), tatsaechlich neu laden.
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

// Vom "Neu laden"-Knopf im UpdateBanner aufgerufen — der Nutzer hat dem
// Aktualisieren aktiv zugestimmt.
export function activateWaitingServiceWorker(): void {
  navigator.serviceWorker.getRegistration().then((registration) => {
    registration?.waiting?.postMessage('skip-waiting');
  });
}
