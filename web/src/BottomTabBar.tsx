import { currentRoute, routeHref } from './routing.ts';

// Ersetzt die vorlaeufige TopNav. Volle Seitenladung beim Wechsel, kein
// Router — fuer vier feste Ziele reicht das.
const TABS = [
  { href: '/', label: 'Dashboard' },
  { href: '/erfassen', label: 'Erfassen' },
  { href: '/auswertung', label: 'Auswertung' },
  { href: '/einstellungen', label: 'Einstellungen' },
];

export function BottomTabBar() {
  const path = typeof window !== 'undefined' ? currentRoute() : '';

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface"
      style={{ height: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map((tab) => {
        const active = path === tab.href;
        return (
          <a
            key={tab.href}
            href={routeHref(tab.href)}
            className={`flex flex-1 flex-col items-center justify-center text-xs ${active ? 'font-semibold text-accent' : 'text-text-dim'}`}
          >
            {tab.label}
          </a>
        );
      })}
    </nav>
  );
}
