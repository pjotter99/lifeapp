import type { Database } from 'sql.js';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Amount, Button, Chip, Panel } from './components';
import { getAccountByIban, getAccounts, ibanLast4, updateAccount, type Account } from './data/accounts.ts';
import { parseCamt052, type CamtParseResult, type XmlDocument } from './data/camt.ts';
import { buildCamtPreview, commitCamtImport, type CamtPreview } from './data/camtImport.ts';
import { persist } from './data/sqlite.ts';
import { routeHref } from './routing.ts';

type State = 'idle' | 'reading' | 'preview' | 'importing';

interface Pending {
  filename: string;
  parsed: CamtParseResult;
  preview: CamtPreview;
  accountId: number;
  /** Volle IBAN aus der Datei, zu der noch kein Konto hinterlegt ist.
   *  Nur waehrend der Vorschau im Speicher — gespeichert werden spaeter
   *  ausschliesslich die letzten vier Stellen. */
  unknownIban: string | null;
}

function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

// Im Browser der native DOMParser; in den Tests wird stattdessen xmldom
// uebergeben (siehe camt.ts).
function parseXml(xml: string): XmlDocument {
  return new DOMParser().parseFromString(xml, 'application/xml') as unknown as XmlDocument;
}

export function CamtImportSection({ db, onImported }: { db: Database | null; onImported: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [merge, setMerge] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<{ inserted: number; merged: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (db) setAccounts(getAccounts(db));
  }, [db]);

  function reset() {
    setPending(null);
    setMerge(new Set());
    setState('idle');
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // dieselbe Datei erneut waehlbar machen
    if (!file || !db) return;

    setState('reading');
    setError(null);
    setDone(null);
    try {
      const parsed = parseCamt052(await file.text(), parseXml);

      const matched = parsed.iban ? getAccountByIban(db, parsed.iban) : null;
      const accountId = matched?.id ?? accounts[0]?.id;
      if (accountId === undefined) {
        throw new Error('Kein aktives Konto vorhanden.');
      }

      const preview = buildCamtPreview(db, parsed, accountId);
      setPending({
        filename: file.name,
        parsed,
        preview,
        accountId,
        unknownIban: parsed.iban && !matched ? parsed.iban : null,
      });
      // Standard: erkannte Fixkosten zusammenfuehren. Der Nutzer kippt
      // einzelne Treffer um, statt jeden bestaetigen zu muessen.
      setMerge(new Set(preview.recurringMatches.map((m) => m.entryIndex)));
      setState('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Datei konnte nicht gelesen werden.');
      setState('idle');
    }
  }

  // Konto wechseln heisst neu abgleichen: die Kandidaten haengen am Konto.
  function selectAccount(accountId: number) {
    if (!db || !pending) return;
    const preview = buildCamtPreview(db, pending.parsed, accountId);
    setPending({ ...pending, accountId, preview });
    setMerge(new Set(preview.recurringMatches.map((m) => m.entryIndex)));
  }

  function toggleMerge(entryIndex: number) {
    setMerge((current) => {
      const next = new Set(current);
      if (next.has(entryIndex)) next.delete(entryIndex);
      else next.add(entryIndex);
      return next;
    });
  }

  async function rememberIban() {
    if (!db || !pending?.unknownIban) return;
    try {
      updateAccount(db, pending.accountId, { iban: pending.unknownIban });
      await persist();
      setAccounts(getAccounts(db));
      setPending({ ...pending, unknownIban: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'IBAN konnte nicht gespeichert werden.');
    }
  }

  async function confirmImport() {
    if (!db || !pending) return;
    setState('importing');
    setError(null);
    try {
      const result = commitCamtImport(db, pending.preview, pending.accountId, merge);
      await persist();
      setDone(result);
      reset();
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen.');
      setState('preview');
    }
  }

  const preview = pending?.preview;
  const nothingToDo = preview !== undefined && preview.entries.length === 0;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="hud-title">// Kontoauszug (CAMT.052)</h2>

      <Panel className="flex flex-col gap-3">
        <p className="text-sm text-text-dim">
          XML-Datei aus dem Online-Banking einlesen. Buchungen kommen ohne Kategorie herein und werden danach
          nachkategorisiert.
        </p>
        {error && <p className="text-sm text-negative">{error}</p>}
        {done && (
          <p className="text-sm text-text-dim">
            {done.inserted} neu angelegt, {done.merged} mit Fixkosten zusammengeführt.{' '}
            <a href={routeHref('/nachkategorisieren')} className="text-accent underline">
              Jetzt kategorisieren
            </a>
          </p>
        )}
        <input ref={fileInputRef} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={handleFile} />
        <Button
          variant="secondary"
          className="self-start"
          disabled={!db || state === 'reading'}
          onClick={() => fileInputRef.current?.click()}
        >
          {state === 'reading' ? 'Wird gelesen…' : 'Datei wählen'}
        </Button>
      </Panel>

      {pending && preview && (
        <Panel lit title="Vorschau" status={pending.filename} className="flex flex-col gap-4">
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="hud-label">Buchungen</dt>
              <dd>{preview.entries.length}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="hud-label">Zeitraum</dt>
              <dd>
                {preview.dateFrom ? formatShortDate(preview.dateFrom) : '–'} bis{' '}
                {preview.dateTo ? formatShortDate(preview.dateTo) : '–'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="hud-label">Einnahmen</dt>
              <Amount cents={preview.incomeCents} size="sm" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="hud-label">Ausgaben</dt>
              <Amount cents={preview.expenseCents} size="sm" />
            </div>
            {preview.autoCategorized > 0 && (
              <div className="flex items-center justify-between gap-3">
                <dt className="hud-label">Per Regel zugeordnet</dt>
                <dd>{preview.autoCategorized}</dd>
              </div>
            )}
            {preview.alreadyPresent > 0 && (
              <div className="flex items-center justify-between gap-3">
                <dt className="hud-label">Schon vorhanden</dt>
                <dd className="text-text-dim">{preview.alreadyPresent}</dd>
              </div>
            )}
            {preview.skippedPending > 0 && (
              <div className="flex items-center justify-between gap-3">
                <dt className="hud-label">Vorgemerkt, übersprungen</dt>
                <dd className="text-text-dim">{preview.skippedPending}</dd>
              </div>
            )}
          </dl>

          {preview.skippedPending > 0 && (
            <p className="text-xs text-text-dim">
              Vorgemerkte Buchungen sind noch nicht endgültig — sie kommen mit dem nächsten Auszug.
            </p>
          )}

          {accounts.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="hud-label">Konto</span>
              <div className="flex flex-wrap gap-2">
                {accounts.map((acc) => (
                  <Chip key={acc.id} selected={acc.id === pending.accountId} onClick={() => selectAccount(acc.id)}>
                    {acc.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {pending.unknownIban && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <p className="text-sm text-text-dim">
                Zum Konto mit den Endziffern{' '}
                <span className="tabular-amount">{ibanLast4(pending.unknownIban)}</span> ist nichts hinterlegt. Merken,
                damit künftige Auszüge automatisch zugeordnet werden? Gespeichert werden nur diese vier Stellen.
              </p>
              <Button variant="secondary" className="self-start" onClick={rememberIban}>
                Endziffern diesem Konto zuordnen
              </Button>
            </div>
          )}

          {preview.recurringMatches.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <p className="text-sm text-text-dim">
                {preview.recurringMatches.length} Buchung
                {preview.recurringMatches.length === 1 ? ' sieht' : 'en sehen'} aus wie bereits erfasste Fixkosten.
                Zusammenführen ersetzt die geplante Buchung durch die echte, statt eine zweite anzulegen.
              </p>
              {preview.recurringMatches.map((match) => {
                const entry = preview.entries[match.entryIndex]!;
                const selected = merge.has(match.entryIndex);
                return (
                  <div key={match.entryIndex} className="flex flex-col gap-2 border-l-2 border-l-warn py-2 pl-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="hud-label">Fixkosten · {match.existing.recurring_name}</span>
                      <span className="hud-label">{formatShortDate(match.existing.date)}</span>
                      <Amount cents={match.existing.amount_cents} size="sm" />
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex-1 truncate text-sm">{entry.payee ?? entry.note ?? 'Auszug'}</span>
                      <span className="hud-label">{formatShortDate(entry.date)}</span>
                      <Amount cents={entry.amount_cents} size="sm" />
                    </div>
                    <Chip selected={selected} className="self-start" onClick={() => toggleMerge(match.entryIndex)}>
                      {selected ? 'Zusammenführen' : 'Getrennt anlegen'}
                    </Chip>
                  </div>
                );
              })}
            </div>
          )}

          {nothingToDo && <p className="text-sm text-text-dim">Alle Buchungen dieser Datei sind bereits erfasst.</p>}

          <div className="flex gap-2">
            <Button variant="primary" disabled={state === 'importing' || nothingToDo} onClick={confirmImport}>
              {state === 'importing' ? 'Wird übernommen…' : 'Übernehmen'}
            </Button>
            <Button variant="secondary" disabled={state === 'importing'} onClick={reset}>
              Abbrechen
            </Button>
          </div>
        </Panel>
      )}
    </section>
  );
}
