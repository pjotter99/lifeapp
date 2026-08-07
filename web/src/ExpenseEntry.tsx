import { useEffect, useRef, useState } from 'react';
import { Button, Card, Chip, Input } from './components';

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
  const [topCategoryId, setTopCategoryId] = useState<number | null>(null);
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
  const subCategories = categories.filter((c) => c.parent_id === topCategoryId);
  const needsAccountField = accounts.length > 1;

  function resetForm() {
    setAmount('');
    setDate(today());
    setAccountId(accounts[0]?.id ?? null);
    setTopCategoryId(null);
    setDetailsOpen(false);
  }

  async function saveWithCategory(categoryId: number) {
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

  function selectTopCategory(id: number) {
    // Nochmal antippen geht zurueck zu den Oberkategorien.
    setTopCategoryId((current) => (current === id ? null : id));
  }

  return (
    <div className="flex min-h-svh flex-col gap-6 p-4">
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

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {topCategories.map((cat) => (
            <Chip key={cat.id} selected={cat.id === topCategoryId} disabled={saving} onClick={() => selectTopCategory(cat.id)}>
              {cat.name}
            </Chip>
          ))}
        </div>

        {topCategoryId !== null && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {subCategories.map((cat) => (
              <Chip key={cat.id} disabled={saving} onClick={() => saveWithCategory(cat.id)}>
                {cat.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}
