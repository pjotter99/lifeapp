import { useEffect, useRef, useState } from 'react';
import { Amount, Button, Card, Chip, Input } from './components';
import { CategoryPicker, type Category } from './CategoryPicker';
import { TopNav } from './TopNav';
import { TransactionRow, type Transaction } from './TransactionRow';

interface Account {
  id: number;
  name: string;
  type: string;
  active: number;
}

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

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function isIncomeCategory(categories: Category[], categoryId: number | null): boolean {
  if (categoryId === null) return false;
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return false;
  if (cat.parent_id === null) return cat.name === 'Einnahmen';
  return categories.find((c) => c.id === cat.parent_id)?.name === 'Einnahmen';
}

const AMOUNT_PATTERN = /^\d*[.,]?\d*$/;
const TOAST_DURATION_MS = 3000;

export function ExpenseEntry() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [frequentCategories, setFrequentCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [openRowId, setOpenRowId] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [topCategoryId, setTopCategoryId] = useState<number | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function loadFrequentCategories() {
    fetch('/api/categories/frequent')
      .then((r) => r.json())
      .then(setFrequentCategories);
  }

  function loadSummary() {
    fetch('/api/summary/month')
      .then((r) => r.json())
      .then(setSummary);
  }

  function loadRecentTransactions() {
    fetch('/api/transactions?limit=10')
      .then((r) => r.json())
      .then(setRecentTransactions);
  }

  function refreshDerivedData() {
    loadFrequentCategories();
    loadSummary();
    loadRecentTransactions();
  }

  useEffect(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then(setCategories);
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((data: Account[]) => {
        setAccounts(data);
        setAccountId(data[0]?.id ?? null);
      });
    refreshDerivedData();
    amountRef.current?.focus();

    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const needsAccountField = accounts.length > 1;
  const parsedAmount = Number.parseFloat(amount.replace(',', '.'));
  const amountValid = amount !== '' && !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const canConfirm = amountValid && selectedCategoryId !== null;

  function resetForm() {
    setAmount('');
    setDate(today());
    setAccountId(accounts[0]?.id ?? null);
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
    if (!toast) return;
    const { transactionId } = toast;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
    await fetch(`/api/transactions/${transactionId}`, { method: 'DELETE' });
    refreshDerivedData();
  }

  async function deleteTransaction(id: number) {
    setOpenRowId(null);
    if (toast?.transactionId === id) {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast(null);
    }
    await fetch(`/api/transactions/${id}`, { method: 'DELETE' });
    refreshDerivedData();
  }

  async function confirmSave() {
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
      const body: Record<string, unknown> = {
        amount_cents: Math.round(parsedAmount * 100),
        category_id: selectedCategoryId,
        date,
      };
      if (needsAccountField && accountId !== null) {
        body.account_id = accountId;
      }

      const res = await fetch('/api/transactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Speichern fehlgeschlagen.');
      }

      const created: { id: number; amount_cents: number } = await res.json();
      const categoryName = categories.find((c) => c.id === selectedCategoryId)?.name ?? '';

      resetForm();
      refreshDerivedData();
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

  function selectFromFrequent(id: number) {
    // Gleich behandeln wie eine manuelle Ober-/Unterkategorie-Auswahl —
    // das Kategoriegitter klappt mit auf, konsistenter Flow statt Sonderfall.
    setSelectedCategoryId(id);
    setTopCategoryId(frequentCategories.find((c) => c.id === id)?.parent_id ?? null);
  }

  const previewIsIncome = isIncomeCategory(categories, selectedCategoryId);
  const previewCents = canConfirm ? Math.round(parsedAmount * 100) * (previewIsIncome ? 1 : -1) : 0;

  return (
    <div className="flex min-h-svh flex-col gap-6 p-4">
      <TopNav />

      {summary && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-dim">Einnahmen</span>
            <Amount cents={summary.income_cents} size="sm" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-dim">Ausgaben</span>
            <Amount cents={summary.expense_cents} size="sm" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-text-dim">Saldo</span>
            <Amount cents={summary.balance_cents} size="sm" />
          </div>
        </div>
      )}

      <Card>
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
        {error && <p className="mt-2 text-center text-sm text-negative">{error}</p>}
      </Card>

      {frequentCategories.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-text-dim">Häufig</span>
          <div className="flex flex-wrap gap-2">
            {frequentCategories.map((cat) => (
              <Chip
                key={cat.id}
                selected={cat.id === selectedCategoryId}
                disabled={saving}
                onClick={() => selectFromFrequent(cat.id)}
              >
                {cat.name}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <CategoryPicker
        categories={categories}
        topCategoryId={topCategoryId}
        selectedSubId={selectedCategoryId}
        onSelectTop={selectTopCategory}
        onSelectSub={selectSubCategory}
        disabled={saving}
      />

      <Button variant="secondary" className="w-full" disabled={!canConfirm || saving} onClick={confirmSave}>
        {canConfirm ? <Amount cents={previewCents} size="md" /> : 'Bestätigen'}
      </Button>

      {recentTransactions.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-text-dim">Letzte Buchungen</span>
          <div className="flex flex-col gap-2">
            {recentTransactions.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                isOpen={tx.id === openRowId}
                onOpen={() => setOpenRowId(tx.id)}
                onClose={() => setOpenRowId((current) => (current === tx.id ? null : current))}
                onDelete={() => deleteTransaction(tx.id)}
              />
            ))}
          </div>
        </div>
      )}

      <Button variant="secondary" className="self-start" onClick={() => setDetailsOpen((open) => !open)}>
        Details
      </Button>

      {detailsOpen && (
        <div className="flex flex-col gap-4">
          <Input label="Datum" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

          {needsAccountField && (
            <div className="flex flex-col gap-1.5 text-sm text-text-dim">
              Konto
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
        <div className="fixed inset-x-4 z-10" style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <Card className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-text-dim">Gespeichert: {toast.categoryName}</span>
              <Amount cents={toast.amountCents} size="sm" />
            </div>
            <Button variant="secondary" onClick={undoToast}>
              Rückgängig
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}
