import type { Database } from 'sql.js';
import { useEffect, useState } from 'react';
import { Amount, Chip, Panel, ProportionLine } from './components';
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

// Zehn unterscheidbare, nicht-neonfarbene Toene, gleichmaessig ueber den
// Farbkreis verteilt. Startpunkt ist der Farbton von --accent (#4DD8E0,
// ~183°), damit die erste Kategorie zum Interface passt; Saettigung und
// Helligkeit liegen etwas darunter bzw. darueber (65 % / 68 %), damit alle
// zehn Toene auf --surface gleich gut lesbar bleiben.
const CHART_HUE_START = 183;
const CHART_COUNT = 10;

function chartColor(index: number): string {
  const hue = (CHART_HUE_START + (360 / CHART_COUNT) * index) % 360;
  return `hsl(${hue} 65% 68%)`;
}

export function Auswertung() {
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<CategorySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set statt einzelner id: mehrere Oberkategorien sollen gleichzeitig
  // aufklappbar sein, nicht nur eine.
  const [expandedTopIds, setExpandedTopIds] = useState<Set<number>>(new Set());
  const [expandedSubId, setExpandedSubId] = useState<number | null>(null);

  useEffect(() => {
    setExpandedTopIds(new Set());
    setExpandedSubId(null);
    setError(null);
    getReadyDb()
      .then((db: Database) => setData(getCategorySummary(db, month)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen.'));
  }, [month]);

  function toggleTop(id: number) {
    setExpandedTopIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setExpandedSubId(null);
  }

  function toggleSub(id: number) {
    setExpandedSubId((current) => (current === id ? null : id));
  }

  const hasData = !!data && data.categories.length > 0;
  const isCurrentMonth = month === currentMonth();

  return (
    <div
      className="flex min-h-svh flex-col gap-6 p-4"
      style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <h1 className="hud-page-title">Auswertung</h1>

      {/* Der mittlere Chip ist kein Zierstueck: er springt zurueck auf den
          laufenden Monat und zeigt als gewaehlter Zustand an, dass man dort
          gerade steht. */}
      <div className="flex items-center gap-2">
        <Chip aria-label="Vorheriger Monat" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
          ‹
        </Chip>
        <Chip selected={isCurrentMonth} className="flex-1" onClick={() => setMonth(currentMonth())}>
          {monthLabel(month)}
        </Chip>
        <Chip aria-label="Nächster Monat" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
          ›
        </Chip>
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      {data && !hasData && (
        <Panel>
          <p className="text-sm text-text-dim">Keine Ausgaben in {monthLabel(month)} erfasst.</p>
        </Panel>
      )}

      {hasData && (
        <>
          <div className="flex justify-center">
            <Donut categories={data.categories} totalCents={data.total_cents} />
          </div>

          <Panel title="Kategorien" status={monthLabel(month)}>
            {data.categories.map((cat, index) => {
              const percent = data.total_cents > 0 ? (Math.abs(cat.amount_cents) / data.total_cents) * 100 : 0;
              const color = chartColor(index);

              return (
                <div
                  key={cat.id}
                  className={`flex flex-col gap-2 py-3 ${index > 0 ? 'border-t border-border' : ''}`}
                >
                  <button type="button" onClick={() => toggleTop(cat.id)} className="flex w-full items-center gap-3 text-left">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                    <span className="flex-1 truncate text-sm">{cat.name}</span>
                    <Amount cents={cat.amount_cents} size="sm" />
                    <span className="hud-label w-8 shrink-0 text-right">{Math.round(percent)} %</span>
                  </button>
                  <ProportionLine value={percent} color={color} />

                  {expandedTopIds.has(cat.id) && (
                    <div className="mt-1 flex flex-col gap-2 border-l border-border pl-4">
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
                                <div key={tx.id} className="flex items-center gap-3">
                                  <span className="hud-label">{formatShortDate(tx.date)}</span>
                                  <span className="flex-1 truncate text-xs text-text-dim">{tx.payee ?? tx.note ?? ''}</span>
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
          </Panel>
        </>
      )}

      <BottomTabBar />
    </div>
  );
}

// Duenner Ring statt fetter Donut, mit Luft zwischen den Segmenten. Die Summe
// steht in der Mitte — ein Loch ohne Zahl verschenkt die Flaeche.
const DONUT_RADIUS = 40;
const DONUT_STROKE = 6;
// Luft zwischen zwei Segmenten, in Nutzereinheiten entlang des Pfades.
const DONUT_GAP = 1.2;

function Donut({ categories, totalCents }: { categories: CategorySummaryTop[]; totalCents: number }) {
  const total = categories.reduce((sum, c) => sum + Math.abs(c.amount_cents), 0);
  const circumference = 2 * Math.PI * DONUT_RADIUS;
  let cumulative = 0;

  return (
    <div className="relative h-56 w-56">
      <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
        <circle cx="50" cy="50" r={DONUT_RADIUS} fill="none" stroke="var(--border)" strokeWidth={DONUT_STROKE} />
        {categories.map((cat, index) => {
          const fraction = total > 0 ? Math.abs(cat.amount_cents) / total : 0;
          const length = fraction * circumference;
          // Der Vorschub zaehlt die volle Laenge, gezeichnet wird etwas
          // weniger — sonst wandert die Luft in die Segmente hinein.
          const drawn = Math.max(length - DONUT_GAP, 0);
          const dashoffset = -cumulative;
          cumulative += length;

          return (
            <circle
              key={cat.id}
              cx="50"
              cy="50"
              r={DONUT_RADIUS}
              fill="none"
              stroke={chartColor(index)}
              strokeWidth={DONUT_STROKE}
              strokeDasharray={`${drawn} ${circumference - drawn}`}
              strokeDashoffset={dashoffset}
              transform="rotate(-90 50 50)"
            />
          );
        })}
      </svg>

      {/* totalCents ist die Summe der Betraege, also positiv — als Ausgabe
          dargestellt braucht sie das Minus, sonst faerbt Amount sie gruen. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-2 text-center">
        <Amount cents={-totalCents} size="md" />
        <span className="hud-label">Ausgaben</span>
      </div>
    </div>
  );
}
