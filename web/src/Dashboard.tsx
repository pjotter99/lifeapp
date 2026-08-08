import { useEffect, useState } from 'react';
import { Amount, Card, ProgressBar } from './components';
import { BottomTabBar } from './BottomTabBar';

interface DashboardData {
  month: string;
  balance: { available: boolean; balance_cents: number | null };
  available_until_month_end_cents: number | null;
  savings_rate: {
    mode: 'amount' | 'percent' | null;
    achieved_cents: number;
    goal_cents: number | null;
    target_percent: number | null;
    basis_cents: number | null;
  };
  upcoming_fixed_costs: Array<{ id: number; name: string; amount_cents: number; due_date: string }>;
  expenses_this_month_cents: number;
  unrecorded_this_month_cents: number;
}

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

function monthLabel(yyyyMm: string): string {
  const [year, month] = yyyyMm.split('-').map(Number);
  return `${MONTH_NAMES[(month ?? 1) - 1]} ${year}`;
}

function formatShortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}.${month}.`;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setData);
  }, []);

  const progressPct =
    data?.savings_rate.goal_cents && data.savings_rate.goal_cents > 0
      ? (data.savings_rate.achieved_cents / data.savings_rate.goal_cents) * 100
      : 0;

  return (
    <div
      className="flex min-h-svh flex-col gap-8 p-4"
      style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {data && !data.balance.available && (
        <Card className="flex flex-col gap-2">
          <p className="text-sm text-text-dim">
            Kein Startsaldo bzw. Startdatum gesetzt — der Kontostand lässt sich ohne das nicht berechnen.
          </p>
          <a href="/stammdaten" className="text-sm font-medium text-accent underline">
            Zu den Stammdaten
          </a>
        </Card>
      )}

      {data && data.balance.available && (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-dim">Kontostand jetzt</span>
            <Amount cents={data.balance.balance_cents!} size="lg" />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-text-dim">Verfügbar bis Monatsende</span>
            <Amount cents={data.available_until_month_end_cents!} size="md" />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs text-text-dim">Sparrate</span>
            {data.savings_rate.goal_cents !== null ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <Amount cents={data.savings_rate.achieved_cents} size="md" />
                  <span className="flex items-baseline gap-1 text-sm text-text-dim">
                    von <Amount cents={data.savings_rate.goal_cents} size="sm" />
                    {data.savings_rate.mode === 'percent' && data.savings_rate.target_percent !== null && (
                      <span>({data.savings_rate.target_percent.toString().replace('.', ',')} %)</span>
                    )}
                  </span>
                </div>
                <ProgressBar value={progressPct} />
              </>
            ) : (
              <p className="text-sm text-text-dim">Noch kein Sparziel gesetzt.</p>
            )}
          </div>
        </>
      )}

      {data && data.upcoming_fixed_costs.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-text-dim">Anstehende Fixkosten</span>
          <div className="flex flex-col gap-2">
            {data.upcoming_fixed_costs.map((item) => (
              <div key={item.id} className="flex items-center gap-3 text-sm">
                <span className="w-12 shrink-0 text-text-dim">{formatShortDate(item.due_date)}</span>
                <span className="flex-1 truncate">{item.name}</span>
                <Amount cents={item.amount_cents} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-text-dim">Ausgaben {monthLabel(data.month)}</span>
            <Amount cents={data.expenses_this_month_cents} size="sm" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-text-dim">Nicht erfasst {monthLabel(data.month)}</span>
            <Amount cents={data.unrecorded_this_month_cents} size="sm" />
          </div>
        </div>
      )}

      <BottomTabBar />
    </div>
  );
}
