import type { Database } from 'sql.js';
import { useEffect, useState } from 'react';
import { Amount, Button, Card, ProgressBar } from './components';
import { BottomTabBar } from './BottomTabBar';
import { getCategorySummary, type CategorySummary, type CategorySummaryTop } from './data/categorySummary.ts';
import { getReadyDb } from './data/sqlite.ts';

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

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(yyyyMm: string): string {
  const [year, month] = yyyyMm.split('-').map(Number);
  return `${MONTH_NAMES[(month ?? 1) - 1]} ${year}`;
}

function shiftMonth(yyyyMm: string, delta: number): string {
  const [year, month] = yyyyMm.split('-').map(Number) as [number, number];
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatShortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}.${month}.`;
}

// Zehn unterscheidbare, nicht-neonfarbene Toene: gleiche Saettigung/Helligkeit
// wie --accent (Design-System, S~65% L~68%), aber gleichmaessig ueber den
// Farbkreis verteilt, Startpunkt bei --accents Farbton (230°).
const CHART_HUE_START = 230;
const CHART_COUNT = 10;

function chartColor(index: number): string {
  const hue = (CHART_HUE_START + (360 / CHART_COUNT) * index) % 360;
  return `hsl(${hue} 65% 68%)`;
}

export function Auswertung() {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<CategorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedTopId, setExpandedTopId] = useState<number | null>(null);
  const [expandedSubId, setExpandedSubId] = useState<number | null>(null);

  useEffect(() => {
    setExpandedTopId(null);
    setExpandedSubId(null);
    setError(null);
    getReadyDb()
      .then((db: Database) => setData(getCategorySummary(db, month)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen.'));
  }, [month]);

  function toggleTop(id: number) {
    setExpandedTopId((current) => (current === id ? null : id));
    setExpandedSubId(null);
  }

  function toggleSub(id: number) {
    setExpandedSubId((current) => (current === id ? null : id));
  }

  const hasData = !!data && data.categories.length > 0;

  return (
    <div
      className="flex min-h-svh flex-col gap-6 p-4"
      style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <h1 className="text-2xl font-semibold">Auswertung</h1>

      <div className="flex items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
          ‹
        </Button>
        <span className="text-lg font-medium">{monthLabel(month)}</span>
        <Button variant="secondary" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
          ›
        </Button>
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      {data && !hasData && (
        <Card>
          <p className="text-sm text-text-dim">Keine Ausgaben in {monthLabel(month)} erfasst.</p>
        </Card>
      )}

      {hasData && (
        <>
          <div className="flex justify-center">
            <Donut categories={data.categories} />
          </div>

          <div className="flex flex-col gap-4">
            {data.categories.map((cat, index) => {
              const percent = data.total_cents > 0 ? (Math.abs(cat.amount_cents) / data.total_cents) * 100 : 0;
              const color = chartColor(index);

              return (
                <div key={cat.id} className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => toggleTop(cat.id)}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="flex-1 truncate text-sm">{cat.name}</span>
                    <Amount cents={cat.amount_cents} size="sm" />
                    <span className="w-10 shrink-0 text-right text-xs text-text-dim">{Math.round(percent)} %</span>
                  </button>
                  <ProgressBar value={percent} color={color} />

                  {expandedTopId === cat.id && (
                    <div className="flex flex-col gap-2 border-l border-border pl-4">
                      {cat.subcategories.map((sub) => (
                        <div key={sub.id} className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => toggleSub(sub.id)}
                            className="flex w-full items-center justify-between gap-3 text-left text-sm"
                          >
                            <span className="truncate text-text-dim">{sub.name}</span>
                            <Amount cents={sub.amount_cents} size="sm" />
                          </button>

                          {expandedSubId === sub.id && (
                            <div className="flex flex-col gap-1.5 border-l border-border pl-4">
                              {sub.transactions.map((tx) => (
                                <div key={tx.id} className="flex items-center gap-3 text-xs">
                                  <span className="text-text-dim">{formatShortDate(tx.date)}</span>
                                  <span className="flex-1 truncate text-text-dim">{tx.payee ?? tx.note ?? ''}</span>
                                  <Amount cents={tx.amount_cents} size="sm" />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <BottomTabBar />
    </div>
  );
}

function Donut({ categories }: { categories: CategorySummaryTop[] }) {
  const total = categories.reduce((sum, c) => sum + Math.abs(c.amount_cents), 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  return (
    <svg viewBox="0 0 100 100" className="h-48 w-48">
      <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--surface-2)" strokeWidth="16" />
      {categories.map((cat, index) => {
        const fraction = total > 0 ? Math.abs(cat.amount_cents) / total : 0;
        const length = fraction * circumference;
        const dashoffset = -cumulative;
        cumulative += length;

        return (
          <circle
            key={cat.id}
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={chartColor(index)}
            strokeWidth="16"
            strokeDasharray={`${length} ${circumference - length}`}
            strokeDashoffset={dashoffset}
            transform="rotate(-90 50 50)"
          />
        );
      })}
    </svg>
  );
}
