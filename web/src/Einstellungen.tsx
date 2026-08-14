import type { Database } from 'sql.js';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Amount, Button, Input, Panel } from './components';
import { BottomTabBar } from './BottomTabBar';
import { CamtImportSection } from './CamtImportSection';
import { buildExportArchive, prepareImportPreview, type ImportPreview } from './data/backup.ts';
import type { GithubSettings } from './data/githubBackup.ts';
import { maybeRunGithubBackup } from './data/githubBackupScheduler.ts';
import {
  clearImportUndoSnapshot,
  loadGithubBackupError,
  loadGithubSettings,
  loadImportUndoSnapshot,
  loadLastGithubBackupSuccessAt,
  persistDb,
  saveGithubSettings,
  saveImportUndoSnapshot,
  saveLastManualExportAt,
} from './data/indexeddb.ts';
import { migrationFiles } from './data/migrationFiles.ts';
import { getReadyDb, openDatabaseFromBytes } from './data/sqlite.ts';
import { routeHref } from './routing.ts';
import { shareOrDownload } from './shareOrDownload.ts';

type ImportState = 'idle' | 'checking' | 'preview' | 'importing';

interface PendingImport {
  filename: string;
  result: ImportPreview;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function formatGermanDateTime(iso: string): string {
  const date = new Date(iso);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy}, ${hh}:${min} Uhr`;
}

function isStale(iso: string | null): boolean {
  return !iso || Date.now() - new Date(iso).getTime() > SEVEN_DAYS_MS;
}

export function Einstellungen() {
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [importState, setImportState] = useState<ImportState>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [hasUndo, setHasUndo] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  useEffect(() => {
    getReadyDb()
      .then(setDb)
      .catch((err: unknown) => setDbError(err instanceof Error ? err.message : 'Datenbank konnte nicht geladen werden.'));
    loadImportUndoSnapshot().then((snapshot) => setHasUndo(snapshot !== null));
  }, []);

  async function handleExport() {
    if (!db) return;
    setExporting(true);
    setExportError(null);
    try {
      const { bytes, filename } = buildExportArchive(db);
      // sql.js/fflate typisieren Uint8Array generisch ueber ArrayBufferLike
      // (schliesst SharedArrayBuffer ein), Blob() verlangt ein konkretes
      // ArrayBuffer — .slice() kopiert in einen frischen Puffer (wie in
      // indexeddb.ts).
      const blob = new Blob([bytes.slice()], { type: 'application/zip' });
      await shareOrDownload(blob, filename);
      await saveLastManualExportAt(new Date().toISOString());
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Nutzer hat den Teilen-Dialog abgebrochen — kein Fehler.
      } else {
        setExportError(err instanceof Error ? err.message : 'Export fehlgeschlagen.');
      }
    } finally {
      setExporting(false);
    }
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // dieselbe Datei erneut waehlbar machen
    if (!file) return;

    setImportState('checking');
    setImportError(null);
    setPending(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await prepareImportPreview(file.name, bytes, migrationFiles, openDatabaseFromBytes);
      setPending({ filename: file.name, result });
      setImportState('preview');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden.');
      setImportState('idle');
    }
  }

  function cancelImport() {
    setPending(null);
    setImportState('idle');
  }

  async function confirmImport() {
    if (!pending || !db) return;
    setImportState('importing');
    setImportError(null);
    try {
      // Vor dem Ueberschreiben den aktuellen Zustand sichern — ermoeglicht
      // "Rueckgaengig" (CLAUDE.md, Abschnitt "Wiederherstellen").
      await saveImportUndoSnapshot(db.export());
      await persistDb(pending.result.db.export());
      window.location.reload();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import fehlgeschlagen.');
      setImportState('preview');
    }
  }

  async function handleUndo() {
    setUndoing(true);
    setUndoError(null);
    try {
      const snapshot = await loadImportUndoSnapshot();
      if (!snapshot) {
        setHasUndo(false);
        return;
      }
      await persistDb(snapshot);
      await clearImportUndoSnapshot();
      window.location.reload();
    } catch (err) {
      setUndoError(err instanceof Error ? err.message : 'Rückgängig fehlgeschlagen.');
      setUndoing(false);
    }
  }

  return (
    <div
      className="mx-auto flex min-h-svh max-w-2xl flex-col gap-10 p-4"
      style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <h1 className="hud-page-title">Einstellungen</h1>
      {dbError && <p className="text-sm text-negative">{dbError}</p>}

      <section className="flex flex-col gap-4">
        <h2 className="hud-title">// Stammdaten</h2>
        <Panel className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-dim">Konten, wiederkehrende Posten, Sparziel</p>
          <a href={routeHref('/stammdaten')} className="hud-label text-accent underline">
            Öffnen
          </a>
        </Panel>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="hud-title">// Sicherung</h2>

        <Panel className="flex flex-col gap-3">
          <p className="text-sm text-text-dim">
            Erzeugt eine ZIP-Datei mit der vollständigen Datenbank, allen Buchungen als CSV und einer LIESMICH.txt.
          </p>
          {exportError && <p className="text-sm text-negative">{exportError}</p>}
          <Button variant="primary" className="self-start" disabled={!db || exporting} onClick={handleExport}>
            {exporting ? 'Wird erzeugt…' : 'Sicherung exportieren'}
          </Button>
        </Panel>

        <Panel className="flex flex-col gap-3">
          <p className="text-sm text-text-dim">
            Sicherung wiederherstellen — akzeptiert die ZIP-Datei oder eine einzelne .sqlite-Datei.
          </p>
          {importError && <p className="text-sm text-negative">{importError}</p>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.sqlite,.db"
            className="hidden"
            onChange={handleFileSelected}
          />
          <Button
            variant="secondary"
            className="self-start"
            disabled={!db || importState === 'checking'}
            onClick={() => fileInputRef.current?.click()}
          >
            {importState === 'checking' ? 'Wird geprüft…' : 'Datei wählen'}
          </Button>
        </Panel>

        {pending && (
          <Panel lit title="Vorschau" status={pending.filename} className="flex flex-col gap-3">
            {pending.result.schemaCheck.status === 'older' && (
              <p className="text-xs text-text-dim">
                Ältere Sicherung — fehlende Migrationen wurden automatisch nachgezogen.
              </p>
            )}

            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="hud-label">Zeitraum</dt>
                <dd>
                  {pending.result.overview.dateRange.from ?? '–'} bis {pending.result.overview.dateRange.to ?? '–'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="hud-label">Buchungen</dt>
                <dd>{pending.result.overview.transactionCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="hud-label">Einnahmen</dt>
                <Amount cents={pending.result.overview.incomeCents} size="sm" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="hud-label">Ausgaben</dt>
                <Amount cents={pending.result.overview.expenseCents} size="sm" />
              </div>
            </dl>

            <p className="text-xs text-negative">
              Der aktuelle Datenbestand wird dabei ersetzt — vorher automatisch gesichert, danach rückgängig machbar.
            </p>

            <div className="flex gap-2">
              <Button variant="primary" disabled={importState === 'importing'} onClick={confirmImport}>
                {importState === 'importing' ? 'Wird übernommen…' : 'Übernehmen'}
              </Button>
              <Button variant="secondary" disabled={importState === 'importing'} onClick={cancelImport}>
                Abbrechen
              </Button>
            </div>
          </Panel>
        )}

        {hasUndo && (
          <Panel className="flex flex-col gap-3">
            <p className="text-sm text-text-dim">Der letzte Import lässt sich rückgängig machen.</p>
            {undoError && <p className="text-sm text-negative">{undoError}</p>}
            <Button variant="danger" className="self-start" disabled={undoing} onClick={handleUndo}>
              {undoing ? 'Wird rückgängig gemacht…' : 'Letzten Import rückgängig machen'}
            </Button>
          </Panel>
        )}
      </section>

      <CamtImportSection db={db} onImported={() => undefined} />

      <GithubBackupSection db={db} />

      <BottomTabBar />
    </div>
  );
}

interface GithubStatus {
  lastSuccessAt: string | null;
  lastError: string | null;
}

function GithubBackupSection({ db }: { db: Database | null }) {
  const [token, setToken] = useState('');
  const [owner, setOwner] = useState('');
  const [repo, setRepo] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Safari fuellt Formularfelder (v. a. type="password") bei Autofill
  // teils nur ueber die native value-Property, ohne ein input/change-
  // Event auszuloesen — der token/owner/repo-State bliebe dann leer, obwohl
  // die Felder sichtbar ausgefuellt sind, und "Speichern" wuerde faelschlich
  // "werden benoetigt" melden. Die Refs lesen beim Speichern den echten
  // DOM-Wert, unabhaengig davon, ob ein Event gefeuert hat.
  const tokenRef = useRef<HTMLInputElement>(null);
  const ownerRef = useRef<HTMLInputElement>(null);
  const repoRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([loadGithubSettings(), loadLastGithubBackupSuccessAt(), loadGithubBackupError()]).then(
      ([settings, lastSuccessAt, lastError]) => {
        if (settings) {
          setToken(settings.token);
          setOwner(settings.owner);
          setRepo(settings.repo);
        }
        setStatus({ lastSuccessAt: lastSuccessAt ?? null, lastError: lastError ?? null });
        setLoaded(true);
      },
    );
  }, []);

  async function refreshStatus() {
    const [lastSuccessAt, lastError] = await Promise.all([loadLastGithubBackupSuccessAt(), loadGithubBackupError()]);
    setStatus({ lastSuccessAt: lastSuccessAt ?? null, lastError: lastError ?? null });
  }

  async function handleSave() {
    if (!db) return;
    const trimmed: GithubSettings = {
      token: (tokenRef.current?.value ?? token).trim(),
      owner: (ownerRef.current?.value ?? owner).trim(),
      repo: (repoRef.current?.value ?? repo).trim(),
    };
    // State mit dem tatsaechlichen DOM-Wert angleichen — sonst wuerde ein
    // spaeterer Re-Render (formError/saving/status) die kontrollierten
    // Felder auf den alten (leeren) State zurueckfallen lassen und ein per
    // Autofill sichtbar ausgefuelltes Feld optisch wieder leeren.
    setToken(trimmed.token);
    setOwner(trimmed.owner);
    setRepo(trimmed.repo);
    if (!trimmed.token || !trimmed.owner || !trimmed.repo) {
      setFormError('Token, Besitzer und Repository-Name werden benötigt.');
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      await saveGithubSettings(trimmed);
      // Sofort testen statt bis zu 15 Minuten auf die naechste Aenderung zu
      // warten — gibt unmittelbares Feedback, ob Token/Repo funktionieren.
      await maybeRunGithubBackup(db, { force: true });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      await refreshStatus();
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="hud-title">// GitHub-Backup</h2>
      <Panel className="flex flex-col gap-3">
        <p className="text-sm text-text-dim">
          Automatische Sicherung nach jeder Änderung (frühestens alle 15 Minuten) in ein privates GitHub-Repository.
          Fine-grained Personal Access Token mit Schreibrechten auf genau dieses Repository.
        </p>

        <Input
          ref={tokenRef}
          label="Token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <Input ref={ownerRef} label="Repository-Besitzer" value={owner} onChange={(e) => setOwner(e.target.value)} />
        <Input ref={repoRef} label="Repository-Name" value={repo} onChange={(e) => setRepo(e.target.value)} />

        {formError && <p className="text-sm text-negative">{formError}</p>}

        <Button variant="primary" className="self-start" disabled={!db || saving} onClick={handleSave}>
          {saving ? 'Wird gespeichert…' : 'Speichern'}
        </Button>

        {loaded && status && (
          <p className={`hud-label ${isStale(status.lastSuccessAt) ? 'text-negative' : ''}`}>
            {status.lastSuccessAt ? `Letzte Sicherung: ${formatGermanDateTime(status.lastSuccessAt)}` : 'Noch keine Sicherung übertragen.'}
          </p>
        )}
        {status?.lastError && <p className="text-sm text-negative">Letzter Fehler: {status.lastError}</p>}
      </Panel>
    </section>
  );
}
