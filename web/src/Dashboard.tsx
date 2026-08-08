import type { Database } from 'sql.js';
import { useEffect, useState } from 'react';
import { Amount, Button, Card, ProgressBar } from './components';
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
import { shareOrDownload } from './shareOrDownload.ts';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

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

  return (
    <div
      className="flex min-h-svh flex-col gap-8 p-4"
      style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 1rem)' }}
    >
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      {error && <p className="text-sm text-negative">{error}</p>}

      {showReminder && (
        <Card className="flex flex-col gap-3">
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
        </Card>
      )}

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

      {lastGithubBackupAt !== undefined && (
        <p className={`text-xs ${isGithubBackupStale ? 'text-negative' : 'text-text-dim'}`}>
          {lastGithubBackupAt ? `Letzte Sicherung: ${formatGermanDateTime(lastGithubBackupAt)}` : 'Noch keine Sicherung'}
        </p>
      )}

      <BottomTabBar />
    </div>
  );
}
