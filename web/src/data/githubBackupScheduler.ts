import type { Database } from 'sql.js';
import { runGithubBackup } from './githubBackup.ts';
import {
  isGithubBackupDirty,
  loadGithubSettings,
  loadLastGithubBackupAttemptAt,
  markGithubBackupDirty,
  saveGithubBackupError,
  saveLastGithubBackupAttemptAt,
  saveLastGithubBackupSuccessAt,
} from './indexeddb.ts';

// Getrennt von githubBackup.ts (reine Upload-Logik, ohne IndexedDB/DOM-Bezug
// und deshalb unter "node --test" pruefbar): diese Datei haengt an
// IndexedDB und wird — wie sqlite.ts — bewusst nie von Tests importiert,
// sondern nur ueber den echten Browser verifiziert.

const MIN_INTERVAL_MS = 15 * 60 * 1000;

export interface MaybeRunOptions {
  /** Ignoriert die 15-Minuten-Drossel — fuer den Soforttest beim Speichern der Einstellungen und den 'online'-Trigger. */
  force?: boolean;
  fetchImpl?: typeof fetch;
}

// Orchestriert CLAUDE.md: "Nach jeder Aenderung, fruehestens aber alle 15
// Minuten" — persist() (sqlite.ts) ruft das nach jedem Schreibvorgang auf.
// Wirft absichtlich nie: ein fehlgeschlagener Hintergrund-Upload darf eine
// ganz normale Schreiboperation nicht stoeren. Der Fehler wird stattdessen
// persistiert (saveGithubBackupError) und in den Einstellungen sichtbar
// gemacht — "ein stiller Fehlschlag ist schlimmer als kein Backup".
export async function maybeRunGithubBackup(db: Database, options: MaybeRunOptions = {}): Promise<void> {
  try {
    // Jede Aenderung macht den Stand ungesichert, unabhaengig davon, ob
    // GitHub schon konfiguriert ist — sobald es konfiguriert wird, greift
    // die naechste Gelegenheit sofort, ohne auf eine weitere Aenderung zu warten.
    await markGithubBackupDirty(true);

    const settings = await loadGithubSettings();
    if (!settings) return;

    if (!(await isGithubBackupDirty())) return;

    if (!options.force) {
      const lastAttempt = await loadLastGithubBackupAttemptAt();
      if (lastAttempt && Date.now() - new Date(lastAttempt).getTime() < MIN_INTERVAL_MS) return;
    }

    await saveLastGithubBackupAttemptAt(new Date().toISOString());

    try {
      await runGithubBackup(db, settings, options.fetchImpl);
      await markGithubBackupDirty(false);
      await saveLastGithubBackupSuccessAt(new Date().toISOString());
      await saveGithubBackupError(null);
    } catch (err) {
      // dirty bleibt true: die naechste Aenderung oder der naechste
      // 'online'-Trigger holt den Upload nach (CLAUDE.md, Abschnitt "Offline").
      await saveGithubBackupError(err instanceof Error ? err.message : 'Sicherung fehlgeschlagen.');
    }
  } catch {
    // IndexedDB-Fehler o.ae. duerfen den Aufrufer (persist()) nicht stoeren.
  }
}
