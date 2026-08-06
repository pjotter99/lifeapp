import { useEffect, useRef, useState } from 'react';

interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  archived: number;
}

interface Account {
  id: number;
  name: string;
  type: string;
  active: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const AMOUNT_PATTERN = /^\d*[.,]?\d*$/;

export function ExpenseEntry() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

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
    amountRef.current?.focus();
  }, []);

  const topCategories = categories.filter((c) => c.parent_id === null);
  const needsAccountField = accounts.length > 1;

  function resetForm() {
    setAmount('');
    setDate(today());
    setAccountId(accounts[0]?.id ?? null);
    setDetailsOpen(false);
  }

  async function selectCategory(categoryId: number) {
    const parsed = Number.parseFloat(amount.replace(',', '.'));
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      setError('Erst einen Betrag eingeben.');
      amountRef.current?.focus();
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
        amount_cents: Math.round(parsed * 100),
        category_id: categoryId,
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

      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
      amountRef.current?.focus();
    }
  }

  return (
    <div className="flex min-h-svh flex-col gap-6 bg-white p-4 text-gray-900">
      <div>
        <input
          ref={amountRef}
          type="text"
          inputMode="decimal"
          autoFocus
          placeholder="0,00"
          value={amount}
          onChange={(e) => {
            if (AMOUNT_PATTERN.test(e.target.value)) setAmount(e.target.value);
          }}
          className="w-full border-b-2 border-gray-300 py-4 text-center text-5xl font-semibold outline-none focus:border-blue-500"
        />
        {error && <p className="mt-2 text-center text-sm text-red-600">{error}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {topCategories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            disabled={saving}
            onClick={() => selectCategory(cat.id)}
            className="rounded-xl bg-gray-100 py-5 text-base font-medium active:bg-gray-200 disabled:opacity-50"
          >
            {cat.name}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        className="self-start text-sm text-gray-500 underline"
      >
        Details
      </button>

      {detailsOpen && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm text-gray-600">
            Datum
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-gray-300 p-2"
            />
          </label>

          {needsAccountField && (
            <label className="flex flex-col gap-1 text-sm text-gray-600">
              Konto
              <select
                value={accountId ?? ''}
                onChange={(e) => setAccountId(Number(e.target.value))}
                className="rounded-lg border border-gray-300 p-2"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
