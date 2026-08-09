import { useEffect, useState } from 'react';
import { currentRoute, routeHref } from './routing.ts';

// Ersetzt die vorlaeufige TopNav. Volle Seitenladung beim Wechsel, kein
// Router — fuer vier feste Ziele reicht das.
const TABS = [
  { href: '/', label: 'Dashboard' },
  { href: '/erfassen', label: 'Erfassen' },
  { href: '/auswertung', label: 'Auswertung' },
  { href: '/einstellungen', label: 'Einstellungen' },
];

// Ab wie viel kleinerem Visual Viewport (gegenueber dem Layout-Viewport)
// eine virtuelle Tastatur angenommen wird, statt kleinerer Browser-UI-
// Anpassungen (Adressleiste ein-/ausblenden etc.) — eine Tastatur nimmt
// deutlich mehr als 150px ein.
const KEYBOARD_HEIGHT_THRESHOLD = 150;

// position:fixed haengt auf iOS bei offener Tastatur am Layout-Viewport,
// nicht am sichtbaren (Visual-)Viewport — die Leiste "schwebt" dadurch
// mitten im Bild statt am unteren Rand zu bleiben. Statt die Position per
// VisualViewport-Offset staendig nachzuziehen (fehleranfaellig bei Scroll/
// Rotation), wird die Leiste waehrend offener Tastatur einfach ausgeblendet
// — der Nutzer tippt ohnehin gerade in ein Feld, nicht auf einen Tab.
function useKeyboardOpen(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return; // kein VisualViewport-Support: Leiste bleibt immer sichtbar

    function update() {
      setKeyboardOpen(window.innerHeight - viewport!.height > KEYBOARD_HEIGHT_THRESHOLD);
    }

    update();
    viewport.addEventListener('resize', update);
    return () => viewport.removeEventListener('resize', update);
  }, []);

  return keyboardOpen;
}

export function BottomTabBar() {
  const path = typeof window !== 'undefined' ? currentRoute() : '';
  const keyboardOpen = useKeyboardOpen();

  if (keyboardOpen) return null;

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
