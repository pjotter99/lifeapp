import type { Database } from 'sql.js';
import { useEffect, useState } from 'react';
import { Amount, Button, Input, Panel } from './components';
import { BottomTabBar } from './BottomTabBar';
import { CategoryPicker, type Category } from './CategoryPicker';
import { getCategories } from './data/categories.ts';
import { getReadyDb, persist } from './data/sqlite.ts';
import {
  categorizeTransaction,
  getUncategorized,
  splitTransaction,
  type SplitPart,
  type UncategorizedTransaction,
} from './data/uncategorized.ts';

const AMOUNT_PATTERN = /^\d*[.,]?\d*$/;

function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function centsToInput(cents: number): string {
  return (Math.abs(cents) / 100).toFixed(2).replace('.', ',');
}

function inputToCents(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function Nachkategorisieren() {
  const [db, setDb] = useState<Database | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<UncategorizedTransaction[]>([]);

  useEffect(() => {
    getReadyDb()
      .then(setDb)
      .catch((err: unknown) => setDbError(err instanceof Error ? err.message : 'Datenbank konnte nicht geladen werden.'));
  }, []);

  useEffect(() => {
    if (!db) return;
    setCategories(getCategories(db));
    setItems(getUncategorized(db));
  }, [db]);

  function reload() {
    if (db) setItems(getUncategorized(db));
  }

  return (
    <div
      className="mx-auto flex min-h-svh max-w-2xl flex-col gap-6 p-4"
      style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <h1 className="hud-page-title">Nachkategorisieren</h1>
      {dbError && <p className="text-sm text-negative">{dbError}</p>}

      {db && items.length === 0 && (
        <Panel>
          <p className="text-sm text-text-dim">Alle Buchungen sind kategorisiert.</p>
        </Panel>
      )}

      {items.length > 0 && (
        <p className="hud-label">
          {items.length} offen — älteste zuerst
        </p>
      )}

      {items.map((item) => (
        <UncategorizedItem key={item.id} db={db} item={item} categories={categories} onDone={reload} />
      ))}

      <BottomTabBar />
    </div>
  );
}

function UncategorizedItem({
  db,
  item,
  categories,
  onDone,
}: {
  db: Database | null;
  item: UncategorizedTransaction;
  categories: Category[];
  onDone: () => void;
}) {
  const [payee, setPayee] = useState(item.payee ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [topCategoryId, setTopCategoryId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!db) return;
    if (categoryId === null) {
      setError('Kategorie wählen.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      categorizeTransaction(db, item.id, { category_id: categoryId, payee, note });
      await persist();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
      setSaving(false);
    }
  }

  return (
    <Panel
      title={formatShortDate(item.date)}
      status={item.source === 'camt' ? 'Kontoauszug' : item.source}
      className="flex flex-col gap-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex-1 truncate text-sm">{item.payee ?? item.note ?? 'Ohne Bezeichnung'}</span>
        <Amount cents={item.amount_cents} size="md" />
      </div>

      {item.note && item.payee && <p className="hud-label">{item.note}</p>}

      {splitting ? (
        <SplitForm
          db={db}
          item={item}
          categories={categories}
          onCancel={() => setSplitting(false)}
          onDone={onDone}
        />
      ) : (
        <>
          <Input label="Empfänger" value={payee} onChange={(e) => setPayee(e.target.value)} />
          <Input label="Notiz" value={note} onChange={(e) => setNote(e.target.value)} />

          <div className="flex flex-col gap-1.5">
            <span className="hud-label">Kategorie</span>
            <CategoryPicker
              categories={categories}
              topCategoryId={topCategoryId}
              selectedSubId={categoryId}
              onSelectTop={(id) => setTopCategoryId((current) => (current === id ? null : id))}
              onSelectSub={setCategoryId}
              disabled={saving}
            />
          </div>

          {error && <p className="text-sm text-negative">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={saving || !db} onClick={save}>
              Speichern
            </Button>
            <Button variant="secondary" disabled={saving} onClick={() => setSplitting(true)}>
              Aufteilen
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

interface DraftPart {
  amount: string;
  topCategoryId: number | null;
  categoryId: number | null;
  note: string;
}

function emptyPart(): DraftPart {
  return { amount: '', topCategoryId: null, categoryId: null, note: '' };
}

function SplitForm({
  db,
  item,
  categories,
  onCancel,
  onDone,
}: {
  db: Database | null;
  item: UncategorizedTransaction;
  categories: Category[];
  onCancel: () => void;
  onDone: () => void;
}) {
  // Erster Teil mit dem vollen Betrag vorbelegt: so muss man nur den
  // abzuspaltenden Betrag eintragen und beim ersten korrigieren.
  const [parts, setParts] = useState<DraftPart[]>(() => [
    { ...emptyPart(), amount: centsToInput(item.amount_cents) },
    emptyPart(),
  ]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const sign = Math.sign(item.amount_cents);
  const partCents = parts.map((p) => {
    const cents = inputToCents(p.amount);
    return cents === null ? null : cents * sign;
  });
  const sum = partCents.reduce<number>((total, c) => total + (c ?? 0), 0);
  const remaining = item.amount_cents - sum;
  const complete = partCents.every((c) => c !== null && c !== 0) && remaining === 0;

  function update(index: number, patch: Partial<DraftPart>) {
    setParts((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  async function save() {
    if (!db) return;
    const payload: SplitPart[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      const cents = partCents[i];
      const categoryId = parts[i]!.categoryId;
      if (cents === null || cents === 0) {
        setError(`Teil ${i + 1}: Betrag fehlt.`);
        return;
      }
      if (categoryId === null) {
        setError(`Teil ${i + 1}: Kategorie fehlt.`);
        return;
      }
      payload.push({ amount_cents: cents, category_id: categoryId, note: parts[i]!.note });
    }

    setSaving(true);
    setError(null);
    try {
      splitTransaction(db, item.id, payload);
      await persist();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aufteilen fehlgeschlagen.');
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {parts.map((part, index) => (
        <div key={index} className="flex flex-col gap-3 border-l-2 border-l-accent-dim py-2 pl-3">
          <span className="hud-label">Teil {index + 1}</span>
          <Input
            label="Betrag"
            fieldWidth="auto"
            inputMode="decimal"
            value={part.amount}
            onChange={(e) => {
              if (AMOUNT_PATTERN.test(e.target.value)) update(index, { amount: e.target.value });
            }}
          />
          <Input label="Notiz" value={part.note} onChange={(e) => update(index, { note: e.target.value })} />
          <CategoryPicker
            categories={categories}
            topCategoryId={part.topCategoryId}
            selectedSubId={part.categoryId}
            onSelectTop={(id) => update(index, { topCategoryId: part.topCategoryId === id ? null : id })}
            onSelectSub={(id) => update(index, { categoryId: id })}
            disabled={saving}
          />
        </div>
      ))}

      <Button variant="secondary" className="self-start" disabled={saving} onClick={() => setParts((c) => [...c, emptyPart()])}>
        Teil hinzufügen
      </Button>

      {/* Die Restsumme ist die eigentliche Bedienhilfe: sie zeigt laufend, wie
          weit man noch vom Originalbetrag entfernt ist. */}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <span className="hud-label">{remaining === 0 ? 'Geht auf' : 'Rest'}</span>
        <Amount cents={remaining} size="sm" />
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={saving || !complete || !db} onClick={save}>
          Aufteilen speichern
        </Button>
        <Button variant="secondary" disabled={saving} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}
