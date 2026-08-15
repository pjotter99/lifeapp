import { useEffect, useState } from 'react';
import { Panel } from './components';
import { summarizeViolations, type IntegrityViolation } from './data/integrity.ts';
import { getIntegrityViolations, getReadyDb } from './data/sqlite.ts';

/**
 * Meldet kaputte Fremdschluessel-Verweise, die der Selbsttest beim Start
 * gefunden hat. Sichtbar statt still: solche Zeilen blockieren nichts, aber
 * sie verfaelschen jede Auswertung — eine Buchung mit einer Kategorie-ID, die
 * es nicht gibt, taucht in keiner Kategorie auf und zaehlt trotzdem im
 * Kontostand mit.
 *
 * Wie UpdateBanner einmal in main.tsx eingehaengt, damit die Meldung auf
 * jedem Screen erscheint und nicht nur dort, wo zufaellig hingesehen wird.
 */
export function IntegrityBanner() {
  const [violations, setViolations] = useState<IntegrityViolation[]>([]);

  useEffect(() => {
    // Der Test laeuft in getReadyDb; hier nur das Ergebnis abholen, sobald
    // die Datenbank bereit ist. Faellt die DB aus, melden die Screens das
    // ohnehin selbst — dann hier still bleiben.
    getReadyDb()
      .then(() => setViolations(getIntegrityViolations()))
      .catch(() => {});
  }, []);

  if (violations.length === 0) return null;

  return (
    <div className="fixed inset-x-4 top-4 z-30">
      <Panel lit title="Datenprüfung" className="flex flex-col gap-2">
        <p className="text-sm text-text">
          {violations.length} {violations.length === 1 ? 'Verweis zeigt' : 'Verweise zeigen'} ins Leere (
          {summarizeViolations(violations)}).
        </p>
        <p className="hud-label text-negative">
          Betroffene Buchungen fehlen in der Auswertung, zählen aber im Kontostand mit.
        </p>
      </Panel>
    </div>
  );
}
