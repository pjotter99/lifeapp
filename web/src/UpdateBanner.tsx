import { useEffect, useState } from 'react';
import { Button, Card } from './components';
import { activateWaitingServiceWorker, registerServiceWorker } from './registerServiceWorker.ts';

// Dezenter Hinweis statt ungefragtem Aktualisieren (Umbau Punkt 5) — ein
// automatischer Reload wuerde ein halb ausgefuelltes Formular verwerfen.
// Einmal in main.tsx eingehaengt, unabhaengig vom aktuellen Screen sichtbar.
export function UpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    registerServiceWorker(() => setUpdateAvailable(true));
  }, []);

  if (!updateAvailable) return null;

  return (
    <div className="fixed inset-x-4 top-4 z-30">
      <Card className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-dim">Neue Version verfügbar.</p>
        <Button variant="secondary" onClick={activateWaitingServiceWorker}>
          Neu laden
        </Button>
      </Card>
    </div>
  );
}
