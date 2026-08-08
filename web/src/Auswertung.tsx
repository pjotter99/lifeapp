import { BottomTabBar } from './BottomTabBar';

// Platzhalter, damit der Tab nicht ins Leere fuehrt — die eigentliche
// Kategorie-Ansicht (siehe CLAUDE.md) ist noch nicht gebaut.
export function Auswertung() {
  return (
    <div
      className="flex min-h-svh flex-col gap-4 p-4"
      style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <h1 className="text-2xl font-semibold">Auswertung</h1>
      <p className="text-sm text-text-dim">Noch nicht gebaut.</p>
      <BottomTabBar />
    </div>
  );
}
