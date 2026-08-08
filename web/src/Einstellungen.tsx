import type { Database } from 'sql.js';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Amount, Button, Card } from './components';
import { BottomTabBar } from './BottomTabBar';
import { buildExportArchive, prepareImportPreview, type ImportPreview } from './data/backup.ts';
import { clearImportUndoSnapshot, loadImportUndoSnapshot, persistDb, saveImportUndoSnapshot } from './data/indexeddb.ts';
import { migrationFiles } from './data/migrationFiles.ts';
import { getReadyDb, openDatabaseFromBytes } from './data/sqlite.ts';

type ImportState = 'idle' | 'checking' | 'preview' | 'importing';

interface PendingImport {
  filename: string;
  result: ImportPreview;
}

// Web-Share-API mit Datei-Anhang, wenn verfuegbar (iOS: "In Dateien
// sichern" landet damit auf iCloud Drive) — sonst normaler Download
// (Desktop). CLAUDE.md, Abschnitt "Manuell: Datei teilen".
async function shareOrDownload(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file] });
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function Einstellungen() {
  const [db, setDb] = useState<Database | null>(null);

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
    getReadyDb().then(setDb);
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
      <h1 className="text-2xl font-semibold">Einstellungen</h1>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Stammdaten</h2>
        <Card className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-dim">Konten, wiederkehrende Posten, Sparziel</p>
          <a href="/stammdaten" className="text-sm font-medium text-accent underline">
            Öffnen
          </a>
        </Card>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Sicherung</h2>

        <Card className="flex flex-col gap-3">
          <p className="text-sm text-text-dim">
            Erzeugt eine ZIP-Datei mit der vollständigen Datenbank, allen Buchungen als CSV und einer LIESMICH.txt.
          </p>
          {exportError && <p className="text-sm text-negative">{exportError}</p>}
          <Button variant="primary" className="self-start" disabled={!db || exporting} onClick={handleExport}>
            {exporting ? 'Wird erzeugt…' : 'Sicherung exportieren'}
          </Button>
        </Card>

        <Card className="flex flex-col gap-3">
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
        </Card>

        {pending && (
          <Card className="flex flex-col gap-3">
            <p className="text-sm font-medium">Vorschau: {pending.filename}</p>

            {pending.result.schemaCheck.status === 'older' && (
              <p className="text-xs text-text-dim">
                Ältere Sicherung — fehlende Migrationen wurden automatisch nachgezogen.
              </p>
            )}

            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-text-dim">Zeitraum</dt>
                <dd>
                  {pending.result.overview.dateRange.from ?? '–'} bis {pending.result.overview.dateRange.to ?? '–'}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-text-dim">Buchungen</dt>
                <dd>{pending.result.overview.transactionCount}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-dim">Einnahmen</dt>
                <Amount cents={pending.result.overview.incomeCents} size="sm" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-text-dim">Ausgaben</dt>
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
          </Card>
        )}

        {hasUndo && (
          <Card className="flex flex-col gap-3">
            <p className="text-sm text-text-dim">Der letzte Import lässt sich rückgängig machen.</p>
            {undoError && <p className="text-sm text-negative">{undoError}</p>}
            <Button variant="danger" className="self-start" disabled={undoing} onClick={handleUndo}>
              {undoing ? 'Wird rückgängig gemacht…' : 'Letzten Import rückgängig machen'}
            </Button>
          </Card>
        )}
      </section>

      <BottomTabBar />
    </div>
  );
}
