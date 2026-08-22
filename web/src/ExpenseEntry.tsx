import type { Database } from 'sql.js';
import { useEffect, useRef, useState } from 'react';
import { Amount, Button, Chip, Input, Panel } from './components';
import { BottomTabBar } from './BottomTabBar';
import { CategoryPicker, type Category } from './CategoryPicker';
import { TransactionRow, type Transaction } from './TransactionRow';
import { getCategories } from './data/categories.ts';
import { getAccounts, type Account } from './data/accounts.ts';
import {
  createTransaction,
  deleteTransaction as deleteTransactionRecord,
  getMonthSummary,
  getTransactions,
} from './data/transactions.ts';
import { getReadyDb, persist } from './data/sqlite.ts';

interface MonthSummary {
  income_cents: number;
  expense_cents: number;
  balance_cents: number;
}

interface Toast {
  transactionId: number;
  amountCents: number;
  categoryName: string;
}

type EntryKind = 'expense' | 'income' | 'transfer';

const KIND_LABELS: Record<EntryKind, string> = {
  expense: 'Ausgabe',
  income: 'Einnahme',
  transfer: 'Transfer',
};
const KIND_OPTIONS: EntryKind[] = ['expense', 'income', 'transfer'];

// Welche Art eine Oberkategorie ist, anhand ihres Namens — "Einnahmen" und
// "Transfer" sind je genau eine Oberkategorie, alles andere ist eine Ausgabe.
function topCategoryKind(name: string): EntryKind {
  if (name === 'Einnahmen') return 'income';
  if (name === 'Transfer') return 'transfer';
  return 'expense';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const AMOUNT_PATTERN = /^\d*[.,]?\d*$/;
const TOAST_DURATION_MS = 3000;

const MONTH_NAMES = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

// Der Monatsueberblick zeigt den laufenden Monat. Ohne Zeitbezug waere
// "Ausgaben 84,20 €" mehrdeutig (siehe CLAUDE.md, Dashboard).
function currentMonthLabel(): string {
  const now = new Date();
  return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

export function ExpenseEntry() {
  const [db, setDb] = useState<Database | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [openRowId, setOpenRowId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState<number | null>(null);
  const [kind, setKind] = useState<EntryKind>('expense');
  const [topCategoryId, setTopCategoryId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [isExceptional, setIsExceptional] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // db separat von den Bildschirmdaten: erst wenn sql.js geladen und
  // migriert ist, gibt es ueberhaupt etwas zu lesen. Ohne .catch() bliebe
  // db bei einem Fehler (z. B. WASM-Laden fehlgeschlagen) stumm null —
  // der Screen saehe dann aus wie leer geladen, ohne jeden Hinweis warum.
  useEffect(() => {
    getReadyDb()
      .then(setDb)
      .catch((err: unknown) => setDbError(err instanceof Error ? err.message : 'Datenbank konnte nicht geladen werden.'));
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  function refreshDerivedData(database: Database) {
    setSummary(getMonthSummary(database));
    setRecentTransactions(getTransactions(database, 10));
  }

  useEffect(() => {
    if (!db) return;
    setCategories(getCategories(db));
    const accountsData = getAccounts(db);
    setAccounts(accountsData);
    setAccountId(accountsData[0]?.id ?? null);
    refreshDerivedData(db);
    amountRef.current?.focus();
  }, [db]);

  const needsAccountField = accounts.length > 1;
  const parsedAmount = Number.parseFloat(amount.replace(',', '.'));
  const amountValid = amount !== '' && !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const canConfirm = amountValid && selectedCategoryId !== null;

  // Nur Ober- und Unterkategorien der gewaehlten Art — ersetzt das
  // gemischte Gitter mit allen zehn Oberkategorien.
  const categoriesForKind = categories.filter((c) => {
    if (c.parent_id === null) return topCategoryKind(c.name) === kind;
    const parent = categories.find((p) => p.id === c.parent_id);
    return parent !== undefined && topCategoryKind(parent.name) === kind;
  });

  function resetForm() {
    setAmount('');
    setDate(today());
    setNote('');
    setAccountId(accounts[0]?.id ?? null);
    setKind('expense');
    setIsExceptional(false);
    setTopCategoryId(null);
    setSelectedCategoryId(null);
    setDetailsOpen(false);
  }

  function showToast(next: Toast) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(next);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }

  async function undoToast() {
    if (!toast || !db) return;
    const { transactionId } = toast;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
    try {
      deleteTransactionRecord(db, transactionId);
      await persist();
      refreshDerivedData(db);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rückgängig fehlgeschlagen.');
    }
  }

  async function deleteTransaction(id: number) {
    if (!db) return;
    setOpenRowId(null);
    if (toast?.transactionId === id) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast(null);
    }
    try {
      deleteTransactionRecord(db, id);
      await persist();
      refreshDerivedData(db);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  }

  async function confirmSave() {
    if (!db) return;
    if (!amountValid) {
      setError('Erst einen Betrag eingeben.');
      amountRef.current?.focus();
      return;
    }
    if (selectedCategoryId === null) {
      setError('Kategorie waehlen.');
      return;
    }
    if (needsAccountField && accountId === null) {
      setError('Konto waehlen.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = createTransaction(db, {
        amount_cents: Math.round(parsedAmount * 100),
        category_id: selectedCategoryId,
        date,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(isExceptional ? { is_exceptional: true } : {}),
        ...(needsAccountField && accountId !== null ? { account_id: accountId } : {}),
      });
      await persist();

      const categoryName = categories.find((c) => c.id === selectedCategoryId)?.name ?? '';

      resetForm();
      refreshDerivedData(db);
      showToast({ transactionId: created.id, amountCents: created.amount_cents, categoryName });
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(10);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
      amountRef.current?.focus();
    }
  }

  function selectKind(next: EntryKind) {
    setKind(next);
    setTopCategoryId(null);
    setSelectedCategoryId(null);
  }

  function selectTopCategory(id: number) {
    // Nochmal antippen geht zurueck zu den Oberkategorien. Wechsel auf eine
    // andere Oberkategorie verwirft eine schon gewaehlte Unterkategorie, die
    // nicht dazugehoert — sonst bestaetigt man versehentlich die alte Wahl.
    setTopCategoryId((current) => (current === id ? null : id));
    setSelectedCategoryId((current) => {
      if (current === null) return null;
      const parentOfCurrent = categories.find((c) => c.id === current)?.parent_id;
      return parentOfCurrent === id ? current : null;
    });
  }

  function selectSubCategory(id: number) {
    setSelectedCategoryId(id);
  }

  const previewCents = canConfirm ? Math.round(parsedAmount * 100) * (kind === 'income' ? 1 : -1) : 0;

  return (
    <div className="flex min-h-svh flex-col gap-6 p-4" style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}>
      {dbError && <p className="text-sm text-negative">{dbError}</p>}

      {summary && (
        <Panel title={currentMonthLabel()} className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="hud-label">Einnahmen</span>
            <Amount cents={summary.income_cents} size="sm" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="hud-label">Ausgaben</span>
            <Amount cents={summary.expense_cents} size="sm" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="hud-label">Saldo</span>
            <Amount cents={summary.balance_cents} size="sm" />
          </div>
        </Panel>
      )}

      {/* Kein Panel um das Betragsfeld: es bringt seinen eigenen Rahmen mit,
          ein zweiter darum waere der verschachtelte Rahmen, den der
          Design-Abschnitt auf einer Handyspalte ausschliesst. */}
      <div className="flex flex-col gap-2">
        <Input
          ref={amountRef}
          fieldSize="lg"
          type="text"
          inputMode="decimal"
          autoFocus
          placeholder="0,00"
          value={amount}
          onChange={(e) => {
            if (AMOUNT_PATTERN.test(e.target.value)) setAmount(e.target.value);
          }}
        />
        {error && <p className="text-center text-sm text-negative">{error}</p>}
      </div>

      <div className="flex gap-2">
        {KIND_OPTIONS.map((k) => (
          <Chip key={k} selected={kind === k} disabled={saving} onClick={() => selectKind(k)}>
            {KIND_LABELS[k]}
          </Chip>
        ))}
      </div>

      <CategoryPicker
        categories={categoriesForKind}
        topCategoryId={topCategoryId}
        selectedSubId={selectedCategoryId}
        onSelectTop={selectTopCategory}
        onSelectSub={selectSubCategory}
        disabled={saving}
      />

      <Button variant="primary" className="w-full" disabled={!canConfirm || saving} onClick={confirmSave}>
        {canConfirm ? <Amount cents={previewCents} size="md" /> : 'Bestätigen'}
      </Button>

      {recentTransactions.length > 0 && (
        <Panel title="Letzte Buchungen">
          {recentTransactions.map((tx, i) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              separated={i > 0}
              isOpen={tx.id === openRowId}
              onOpen={() => setOpenRowId(tx.id)}
              onClose={() => setOpenRowId((current) => (current === tx.id ? null : current))}
              onDelete={() => deleteTransaction(tx.id)}
            />
          ))}
        </Panel>
      )}

      <Button variant="secondary" className="self-start" onClick={() => setDetailsOpen((open) => !open)}>
        Details
      </Button>

      {detailsOpen && (
        <div className="flex flex-col gap-4">
          <Input label="Datum" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label="Notiz" type="text" value={note} onChange={(e) => setNote(e.target.value)} />

          {/* Zaehlt im Monat mit, spaeter aber nicht im Durchschnitt. */}
          <div className="flex flex-col gap-1.5">
            <span className="hud-label">Einmalig</span>
            <Chip selected={isExceptional} className="self-start" onClick={() => setIsExceptional((v) => !v)}>
              Außergewöhnlich
            </Chip>
          </div>

          {needsAccountField && (
            <div className="flex flex-col gap-1.5">
              <span className="hud-label">Konto</span>
              <div className="flex flex-wrap gap-2">
                {accounts.map((acc) => (
                  <Chip key={acc.id} selected={acc.id === accountId} onClick={() => setAccountId(acc.id)}>
                    {acc.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {toast && (
        <div
          className="fixed inset-x-4 z-10"
          style={{ bottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}
        >
          <Panel className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="hud-label">Gespeichert: {toast.categoryName}</span>
              <Amount cents={toast.amountCents} size="sm" />
            </div>
            <Button variant="secondary" onClick={undoToast}>
              Rückgängig
            </Button>
          </Panel>
        </div>
      )}

      <BottomTabBar />
    </div>
  );
}
