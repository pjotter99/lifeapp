import type { Database } from 'sql.js';
import { useEffect, useState } from 'react';
import { Amount, Button, Card, Chip, Input } from './components';
import { BottomTabBar } from './BottomTabBar';
import { CategoryPicker, type Category } from './CategoryPicker';
import { getCategories } from './data/categories.ts';
import { getAccounts, updateAccount, type Account } from './data/accounts.ts';
import {
  createRecurring,
  getRecurring,
  monthlyEquivalentCents,
  updateRecurring,
  type RecurringInterval,
  type RecurringKind,
  type RecurringListItem as Recurring,
} from './data/recurring.ts';
import { createSavingsGoal, getCurrentSavingsGoal, type SavingsGoal } from './data/savingsGoal.ts';
import { getReadyDb, persist } from './data/sqlite.ts';

const AMOUNT_PATTERN = /^\d*[.,]?\d*$/;
const SIGNED_AMOUNT_PATTERN = /^-?\d*[.,]?\d*$/;

const KIND_LABELS: Record<RecurringKind, string> = {
  income: 'Einnahmen',
  expense: 'Ausgaben',
  transfer: 'Transfers',
};

const INTERVAL_LABELS: Record<RecurringInterval, string> = {
  monthly: 'monatlich',
  quarterly: 'vierteljährlich',
  yearly: 'jährlich',
};

const KIND_OPTIONS: RecurringKind[] = ['income', 'expense', 'transfer'];
const INTERVAL_OPTIONS: RecurringInterval[] = ['monthly', 'quarterly', 'yearly'];

function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',');
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Stammdaten() {
  const [db, setDb] = useState<Database | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [savingsGoal, setSavingsGoal] = useState<SavingsGoal | null>(null);

  useEffect(() => {
    getReadyDb().then(setDb);
  }, []);

  function refreshAll(database: Database) {
    setCategories(getCategories(database));
    setAccounts(getAccounts(database));
    setRecurring(getRecurring(database));
    setSavingsGoal(getCurrentSavingsGoal(database));
  }

  useEffect(() => {
    if (!db) return;
    refreshAll(db);
  }, [db]);

  function reload() {
    if (db) refreshAll(db);
  }

  return (
    <div
      className="mx-auto flex min-h-svh max-w-2xl flex-col gap-10 p-4"
      style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <h1 className="text-2xl font-semibold">Stammdaten</h1>
      <AccountSection db={db} accounts={accounts} onSaved={reload} />
      <SavingsGoalSection db={db} goal={savingsGoal} onSaved={reload} />
      <RecurringSection db={db} categories={categories} recurring={recurring} onChanged={reload} />
      <BottomTabBar />
    </div>
  );
}

// --- Konto ------------------------------------------------------------

function AccountSection({ db, accounts, onSaved }: { db: Database | null; accounts: Account[]; onSaved: () => void }) {
  if (accounts.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Konto</h2>
      <div className="flex flex-col gap-4">
        {accounts.map((acc) => (
          <AccountForm key={acc.id} db={db} account={acc} onSaved={onSaved} />
        ))}
      </div>
    </section>
  );
}

function AccountForm({ db, account, onSaved }: { db: Database | null; account: Account; onSaved: () => void }) {
  const [balance, setBalance] = useState(() => centsToInputValue(account.opening_balance_cents));
  const [openingDate, setOpeningDate] = useState(account.opening_date ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!db) return;
    const parsed = Number.parseFloat(balance.replace(',', '.'));
    if (balance.trim() === '' || Number.isNaN(parsed)) {
      setError('Ungültiger Betrag.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      updateAccount(db, account.id, {
        opening_balance_cents: Math.round(parsed * 100),
        opening_date: openingDate || null,
      });
      await persist();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <span className="font-medium">{account.name}</span>
      <Input
        label="Startsaldo"
        value={balance}
        inputMode="decimal"
        onChange={(e) => {
          if (SIGNED_AMOUNT_PATTERN.test(e.target.value)) setBalance(e.target.value);
        }}
      />
      <Input label="Startdatum" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} />
      {error && <p className="text-sm text-negative">{error}</p>}
      <Button variant="primary" className="self-start" disabled={saving || !db} onClick={save}>
        Speichern
      </Button>
    </Card>
  );
}

// --- Sparziel -----------------------------------------------------------

function SavingsGoalSection({ db, goal, onSaved }: { db: Database | null; goal: SavingsGoal | null; onSaved: () => void }) {
  const [mode, setMode] = useState<'amount' | 'percent'>('amount');
  const [amountValue, setAmountValue] = useState('');
  const [percentValue, setPercentValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!goal) return;
    setMode(goal.mode);
    if (goal.mode === 'amount' && goal.monthly_target_cents !== null) {
      setAmountValue(centsToInputValue(goal.monthly_target_cents));
    }
    if (goal.mode === 'percent' && goal.target_percent !== null) {
      setPercentValue(String(goal.target_percent).replace('.', ','));
    }
  }, [goal]);

  async function save() {
    if (!db) return;
    setError(null);

    let parsedAmountCents: number | undefined;
    let parsedTargetPercent: number | undefined;

    if (mode === 'amount') {
      const parsed = Number.parseFloat(amountValue.replace(',', '.'));
      if (!amountValue || Number.isNaN(parsed) || parsed <= 0) {
        setError('Betrag eingeben.');
        return;
      }
      parsedAmountCents = Math.round(parsed * 100);
    } else {
      const parsed = Number.parseFloat(percentValue.replace(',', '.'));
      if (!percentValue || Number.isNaN(parsed) || parsed <= 0) {
        setError('Prozentsatz eingeben.');
        return;
      }
      parsedTargetPercent = parsed;
    }

    setSaving(true);
    try {
      createSavingsGoal(db, {
        mode,
        ...(parsedAmountCents !== undefined ? { monthly_target_cents: parsedAmountCents } : {}),
        ...(parsedTargetPercent !== undefined ? { target_percent: parsedTargetPercent } : {}),
      });
      await persist();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Sparziel</h2>
      <Card className="flex flex-col gap-3">
        {goal ? (
          <p className="flex items-center gap-2 text-sm text-text-dim">
            Aktuell:
            {goal.mode === 'amount' && goal.monthly_target_cents !== null ? (
              <Amount cents={goal.monthly_target_cents} size="sm" />
            ) : (
              <span className="tabular-amount text-text">{goal.target_percent?.toString().replace('.', ',')} %</span>
            )}
            <span>seit {goal.active_from}</span>
          </p>
        ) : (
          <p className="text-sm text-text-dim">Noch kein Sparziel gesetzt.</p>
        )}

        <div className="flex gap-2">
          <Chip selected={mode === 'amount'} onClick={() => setMode('amount')}>
            Betrag
          </Chip>
          <Chip selected={mode === 'percent'} onClick={() => setMode('percent')}>
            Prozent
          </Chip>
        </div>

        {mode === 'amount' ? (
          <Input
            label="Monatliches Ziel"
            value={amountValue}
            inputMode="decimal"
            onChange={(e) => {
              if (AMOUNT_PATTERN.test(e.target.value)) setAmountValue(e.target.value);
            }}
          />
        ) : (
          <Input
            label="Anteil vom regulären Nettogehalt (%)"
            value={percentValue}
            inputMode="decimal"
            onChange={(e) => {
              if (AMOUNT_PATTERN.test(e.target.value)) setPercentValue(e.target.value);
            }}
          />
        )}

        {error && <p className="text-sm text-negative">{error}</p>}

        <Button variant="primary" className="self-start" disabled={saving || !db} onClick={save}>
          Speichern
        </Button>
      </Card>
    </section>
  );
}

// --- Wiederkehrende Posten ------------------------------------------------

function RecurringSection({
  db,
  categories,
  recurring,
  onChanged,
}: {
  db: Database | null;
  categories: Category[];
  recurring: Recurring[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(item: Recurring) {
    setEditing(item);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function endRecurring(item: Recurring) {
    if (!db) return;
    setEndError(null);
    try {
      updateRecurring(db, item.id, { active: 0 });
      await persist();
      onChanged();
    } catch (err) {
      setEndError(err instanceof Error ? err.message : 'Beenden fehlgeschlagen.');
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Wiederkehrende Posten</h2>
        {!formOpen && (
          <Button variant="secondary" onClick={openCreate}>
            Neuer Posten
          </Button>
        )}
      </div>

      {endError && <p className="text-sm text-negative">{endError}</p>}

      {formOpen && (
        <RecurringForm
          db={db}
          categories={categories}
          initial={editing}
          onDone={() => {
            closeForm();
            onChanged();
          }}
          onCancel={closeForm}
        />
      )}

      {KIND_OPTIONS.map((kind) => {
        const items = recurring.filter((r) => r.kind === kind);
        if (items.length === 0) return null;

        const monthlySumCents = items
          .filter((r) => r.active === 1)
          .reduce((sum, r) => sum + monthlyEquivalentCents(r.amount_cents, r.interval), 0);

        return (
          <div key={kind} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wide text-text-dim">{KIND_LABELS[kind]}</span>
              <Amount cents={Math.round(monthlySumCents)} size="sm" />
            </div>
            <div className="flex flex-col gap-2">
              {items.map((item) => (
                <RecurringListItem key={item.id} item={item} onEdit={() => openEdit(item)} onEnd={() => endRecurring(item)} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function RecurringListItem({ item, onEdit, onEnd }: { item: Recurring; onEdit: () => void; onEnd: () => void }) {
  return (
    <Card surface="surface-2" className={`flex flex-col gap-2 ${item.active === 1 ? '' : 'opacity-50'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="truncate font-medium">{item.name}</span>
        <Amount cents={item.amount_cents} size="sm" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-text-dim">
          {item.category_name} · {INTERVAL_LABELS[item.interval]} · Tag {item.day_of_month}
          {item.active === 0 && ' · beendet'}
        </span>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={onEdit}>
            Bearbeiten
          </Button>
          {item.active === 1 && (
            <Button variant="danger" onClick={onEnd}>
              Beenden
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function RecurringForm({
  db,
  categories,
  initial,
  onDone,
  onCancel,
}: {
  db: Database | null;
  categories: Category[];
  initial: Recurring | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [amount, setAmount] = useState(initial ? centsToInputValue(Math.abs(initial.amount_cents)) : '');
  const [kind, setKind] = useState<RecurringKind>(initial?.kind ?? 'expense');
  const [interval, setIntervalValue] = useState<RecurringInterval>(initial?.interval ?? 'monthly');
  const [startDate, setStartDate] = useState(initial?.start_date ?? today());
  const [contractEnd, setContractEnd] = useState(initial?.contract_end ?? '');
  const [noticePeriodDays, setNoticePeriodDays] = useState(
    initial?.notice_period_days !== null && initial?.notice_period_days !== undefined ? String(initial.notice_period_days) : '',
  );
  const [topCategoryId, setTopCategoryId] = useState<number | null>(() => {
    if (!initial) return null;
    return categories.find((c) => c.id === initial.category_id)?.parent_id ?? null;
  });
  const [categoryId, setCategoryId] = useState<number | null>(initial?.category_id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectTop(id: number) {
    setTopCategoryId((current) => (current === id ? null : id));
  }

  async function save() {
    if (!db) return;
    setError(null);

    if (!name.trim()) {
      setError('Name eingeben.');
      return;
    }
    const parsedAmount = Number.parseFloat(amount.replace(',', '.'));
    if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Betrag eingeben.');
      return;
    }
    if (categoryId === null) {
      setError('Kategorie wählen.');
      return;
    }
    if (!startDate) {
      setError('Startdatum wählen.');
      return;
    }
    const dayOfMonth = Number.parseInt(startDate.slice(8, 10), 10);
    if (dayOfMonth > 28) {
      setError('Der Tag im Startdatum darf nicht über 28 liegen (Monatstage variieren).');
      return;
    }

    const noticePeriodDaysParsed = noticePeriodDays ? Number.parseInt(noticePeriodDays, 10) : undefined;
    if (noticePeriodDaysParsed !== undefined && (!Number.isInteger(noticePeriodDaysParsed) || noticePeriodDaysParsed < 0)) {
      setError('Kündigungsfrist muss eine nicht-negative Ganzzahl sein.');
      return;
    }

    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        amount_cents: Math.round(parsedAmount * 100),
        category_id: categoryId,
        kind,
        interval,
        start_date: startDate,
        ...(contractEnd ? { contract_end: contractEnd } : {}),
        ...(noticePeriodDaysParsed !== undefined ? { notice_period_days: noticePeriodDaysParsed } : {}),
      };

      if (initial) {
        updateRecurring(db, initial.id, input);
      } else {
        createRecurring(db, input);
      }
      await persist();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />

      <Input
        label="Betrag"
        value={amount}
        inputMode="decimal"
        onChange={(e) => {
          if (AMOUNT_PATTERN.test(e.target.value)) setAmount(e.target.value);
        }}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-text-dim">Art</span>
        <div className="flex gap-2">
          {KIND_OPTIONS.map((k) => (
            <Chip key={k} selected={kind === k} onClick={() => setKind(k)}>
              {KIND_LABELS[k]}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-text-dim">Kategorie</span>
        <CategoryPicker
          categories={categories}
          topCategoryId={topCategoryId}
          selectedSubId={categoryId}
          onSelectTop={selectTop}
          onSelectSub={setCategoryId}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-text-dim">Intervall</span>
        <div className="flex gap-2">
          {INTERVAL_OPTIONS.map((iv) => (
            <Chip key={iv} selected={interval === iv} onClick={() => setIntervalValue(iv)}>
              {INTERVAL_LABELS[iv]}
            </Chip>
          ))}
        </div>
      </div>

      <Input label="Startdatum" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />

      <Input label="Vertragsende (optional)" type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} />

      <Input
        label="Kündigungsfrist in Tagen (optional)"
        type="number"
        min={0}
        value={noticePeriodDays}
        onChange={(e) => setNoticePeriodDays(e.target.value)}
      />

      {error && <p className="text-sm text-negative">{error}</p>}

      <div className="flex gap-2">
        <Button variant="primary" disabled={saving || !db} onClick={save}>
          Speichern
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </Card>
  );
}
