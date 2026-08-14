import type { Database } from 'sql.js';
import { useEffect, useState } from 'react';
import { Amount, Button, Panel, Ring } from './components';
import { BottomTabBar } from './BottomTabBar';
import { buildExportArchive } from './data/backup.ts';
import {
  loadLastGithubBackupSuccessAt,
  loadLastManualExportAt,
  loadReminderDismissedAt,
  saveLastManualExportAt,
  saveReminderDismissedAt,
} from './data/indexeddb.ts';
import { getDashboard, type Dashboard as DashboardData } from './data/dashboard.ts';
import { getReadyDb } from './data/sqlite.ts';
import { routeHref } from './routing.ts';
import { shareOrDownload } from './shareOrDownload.ts';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Der Kontostand-Ring darf nicht breiter werden als der Bildschirm. 340px
// fasst in 44px Mono Betraege bis 999.999,99 € — darueber liefe die Zahl aus
// dem Ring, was fuer ein Girokonto dieser App keine ernste Groesse ist.
const BALANCE_RING_SIZE = 'min(340px, 100%)';
const SAVINGS_RING_SIZE = 200;

function formatGermanDateTime(iso: string): string {
  const date = new Date(iso);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy}, ${hh}:${min} Uhr`;
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

/** Beschriftete Zahl unter einem Ring — Label in Mono-Versalien, Betrag darunter. */
function RingCaption({ label, cents, size = 'md' }: { label: string; cents: number; size?: 'sm' | 'md' }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="hud-label">{label}</span>
      <Amount cents={cents} size={size} />
    </div>
  );
}

export function Dashboard() {
  const [db, setDb] = useState<Database | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [lastGithubBackupAt, setLastGithubBackupAt] = useState<string | null>();

  const [reminder, setReminder] = useState<{ lastExportAt: string | null; dismissedAt: string | null } | null>(null);
  const [reminderExporting, setReminderExporting] = useState(false);
  const [reminderError, setReminderError] = useState<string | null>(null);

  useEffect(() => {
    getReadyDb()
      .then((database: Database) => {
        setDb(database);
        setData(getDashboard(database));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Laden fehlgeschlagen.'));

    loadLastGithubBackupSuccessAt().then((iso) => setLastGithubBackupAt(iso ?? null));

    Promise.all([loadLastManualExportAt(), loadReminderDismissedAt()]).then(([lastExportAt, dismissedAt]) => {
      setReminder({ lastExportAt: lastExportAt ?? null, dismissedAt: dismissedAt ?? null });
    });
  }, []);

  const progressPct =
    data?.savings_rate.goal_cents && data.savings_rate.goal_cents > 0
      ? (data.savings_rate.achieved_cents / data.savings_rate.goal_cents) * 100
      : 0;

  // Der Bogen des Kontostand-Rings zeigt, welcher Anteil des Kontostands nach
  // den offenen Fixkosten und der fehlenden Sparrate noch frei ist — also die
  // "Verfuegbar bis Monatsende"-Zahl, die unter dem Ring beziffert steht. Ohne
  // positiven Kontostand gibt es nichts zu verteilen, dann bleibt der Ring leer.
  const balanceCents = data?.balance.balance_cents ?? null;
  const availableCents = data?.available_until_month_end_cents ?? null;
  const availablePct =
    balanceCents !== null && balanceCents > 0 && availableCents !== null ? (availableCents / balanceCents) * 100 : 0;

  const isGithubBackupStale = !lastGithubBackupAt || Date.now() - new Date(lastGithubBackupAt).getTime() > SEVEN_DAYS_MS;

  const showReminder =
    reminder !== null &&
    (!reminder.lastExportAt || Date.now() - new Date(reminder.lastExportAt).getTime() > NINETY_DAYS_MS) &&
    (!reminder.dismissedAt || Date.now() - new Date(reminder.dismissedAt).getTime() > SEVEN_DAYS_MS);

  async function handleReminderExport() {
    if (!db) return;
    setReminderExporting(true);
    setReminderError(null);
    try {
      const { bytes, filename } = buildExportArchive(db);
      await shareOrDownload(new Blob([bytes.slice()], { type: 'application/zip' }), filename);
      const nowIso = new Date().toISOString();
      await saveLastManualExportAt(nowIso);
      setReminder((r) => ({ lastExportAt: nowIso, dismissedAt: r?.dismissedAt ?? null }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Nutzer hat den Teilen-Dialog abgebrochen — kein Fehler.
      } else {
        setReminderError(err instanceof Error ? err.message : 'Export fehlgeschlagen.');
      }
    } finally {
      setReminderExporting(false);
    }
  }

  async function dismissReminder() {
    const nowIso = new Date().toISOString();
    await saveReminderDismissedAt(nowIso);
    setReminder((r) => ({ lastExportAt: r?.lastExportAt ?? null, dismissedAt: nowIso }));
  }

  // Fortlaufender Zaehler statt fester Werte: die Staffelung soll der
  // tatsaechlichen Reihenfolge folgen, auch wenn Panels wegfallen (kein
  // Sparziel gesetzt, keine Fixkosten offen). Wird bei jedem Render neu
  // gezaehlt und ist damit deterministisch.
  let panelIndex = 0;

  return (
    <div
      className="flex min-h-svh flex-col gap-8 p-4"
      style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <h1 className="hud-page-title">Dashboard</h1>

      {error && <p className="text-sm text-negative">{error}</p>}

      {showReminder && (
        <Panel title="Sicherung" index={panelIndex++} className="flex flex-col gap-3">
          <p className="text-sm text-text-dim">
            {reminder?.lastExportAt
              ? `Letzte manuelle Sicherung: ${formatGermanDateTime(reminder.lastExportAt)}.`
              : 'Noch keine manuelle Sicherung erstellt.'}{' '}
            Für alle Fälle: Sicherung als Datei exportieren.
          </p>
          {reminderError && <p className="text-sm text-negative">{reminderError}</p>}
          <div className="flex gap-2">
            <Button variant="primary" disabled={!db || reminderExporting} onClick={handleReminderExport}>
              {reminderExporting ? 'Wird erzeugt…' : 'Jetzt exportieren'}
            </Button>
            <Button variant="secondary" onClick={dismissReminder}>
              Später
            </Button>
          </div>
        </Panel>
      )}

      {data && !data.balance.available && (
        <Panel title="Kontostand" index={panelIndex++} className="flex flex-col gap-3">
          <p className="text-sm text-text-dim">
            Kein Startsaldo bzw. Startdatum gesetzt — der Kontostand lässt sich ohne das nicht berechnen.
          </p>
          <a href={routeHref('/stammdaten')} className="hud-label text-accent underline">
            Zu den Stammdaten
          </a>
        </Panel>
      )}

      {data && data.balance.available && (
        <div className="flex flex-col items-center gap-10">
          <div className="flex w-full flex-col items-center gap-4">
            <Ring value={availablePct} label="Kontostand" size={BALANCE_RING_SIZE}>
              <Amount cents={balanceCents!} size="lg" />
            </Ring>
            <RingCaption label="Verfügbar bis Monatsende" cents={availableCents!} />
          </div>

          {data.savings_rate.goal_cents !== null ? (
            <div className="flex flex-col items-center gap-4">
              <Ring value={progressPct} label="Sparrate" size={SAVINGS_RING_SIZE}>
                <Amount cents={data.savings_rate.achieved_cents} size="md" />
              </Ring>
              <RingCaption
                label={
                  data.savings_rate.mode === 'percent' && data.savings_rate.target_percent !== null
                    ? `Ziel — ${data.savings_rate.target_percent.toString().replace('.', ',')} %`
                    : 'Ziel'
                }
                cents={data.savings_rate.goal_cents}
                size="sm"
              />
            </div>
          ) : (
            <Panel title="Sparrate" index={panelIndex++} className="w-full">
              <p className="text-sm text-text-dim">Noch kein Sparziel gesetzt.</p>
            </Panel>
          )}
        </div>
      )}

      {data && data.upcoming_fixed_costs.length > 0 && (
        <Panel title="Anstehende Fixkosten" status={monthLabel(data.month)} index={panelIndex++}>
          <ul className="flex flex-col">
            {data.upcoming_fixed_costs.map((item, i) => (
              // Statusstrich links: Fixkosten sind ausnahmslos Ausgaben.
              <li
                key={item.id}
                className={`flex items-center gap-3 border-l-2 border-l-negative py-3 pl-3 ${
                  i > 0 ? 'border-t border-t-border' : ''
                }`}
              >
                <span className="hud-label w-12 shrink-0">{formatShortDate(item.due_date)}</span>
                <span className="flex-1 truncate text-sm">{item.name}</span>
                <Amount cents={item.amount_cents} size="sm" />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {data && (
        <Panel title={monthLabel(data.month)} index={panelIndex++}>
          <div className="flex items-center justify-between gap-3 pb-3">
            <span className="hud-label">Ausgaben</span>
            <Amount cents={data.expenses_this_month_cents} size="sm" />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="hud-label">Nicht erfasst</span>
            <Amount cents={data.unrecorded_this_month_cents} size="sm" />
          </div>
        </Panel>
      )}

      {lastGithubBackupAt !== undefined && (
        <p className={`hud-label ${isGithubBackupStale ? 'text-negative' : ''}`}>
          {lastGithubBackupAt ? `Letzte Sicherung: ${formatGermanDateTime(lastGithubBackupAt)}` : 'Noch keine Sicherung'}
        </p>
      )}

      <BottomTabBar />
    </div>
  );
}
