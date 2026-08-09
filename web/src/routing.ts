// Vite ersetzt import.meta.env.BASE_URL beim Build mit dem --base-Wert
// (z. B. "/lifeapp/" auf GitHub Pages, "/" lokal und im Dev-Server) — immer
// mit abschliessendem Slash. Damit bleiben Routen-Vergleiche und interne
// Links unabhaengig vom Deployment-Unterverzeichnis, statt root-relative
// Pfade wie "/erfassen" hart gegen window.location.pathname zu vergleichen
// (das wuerde unter einem Basispfad nie treffen).
const BASE = import.meta.env.BASE_URL;

// window.location.pathname minus Basispfad, z. B. "/erfassen" statt
// "/lifeapp/erfassen". Von main.tsx (Routenweiche) und BottomTabBar.tsx
// (aktiver Tab) genutzt.
export function currentRoute(): string {
  const { pathname } = window.location;
  if (!pathname.startsWith(BASE)) return pathname;
  return '/' + pathname.slice(BASE.length);
}

// Root-relative Route (z. B. "/erfassen") zu einem echten href machen, das
// den Deployment-Unterpfad beruecksichtigt.
export function routeHref(route: string): string {
  return BASE.replace(/\/$/, '') + route;
}
