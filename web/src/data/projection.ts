import type { Database } from 'sql.js';
import { getCurrentBalance, getHistoryStart } from './balance.ts';
import { queryOne } from './sqlHelpers.ts';

/**
 * Hochrechnung des Kontostands aus dem Durchschnitt der letzten vollen Monate.
 *
 * Grob und ehrlich statt praezise und falsch: ein Durchschnitt ueber wenige
 * Monate ist eine Annahme, keine Vorhersage. Deshalb wird die Basis im UI
 * ausgeschrieben und die Kurve erst ab zwei vollen Monaten gezeigt.
 */

/** Wie viele volle Monate hoechstens in den Durchschnitt eingehen. */
const AVERAGE_MONTHS = 3;
/** Ab wie vielen vollen Monaten ueberhaupt hochgerechnet wird. */
const MIN_MONTHS = 2;
/** Stuetzstellen der Kurve, in Monaten ab heute. */
export const HORIZONS = [3, 6, 9, 12] as const;

export interface ProjectionBasis {
  /** Anzahl gemittelter Monate (2 oder 3). */
  months: number;
  /** Erster und letzter beruecksichtigte Monat, je 'YYYY-MM'. */
  fromMonth: string;
  toMonth: string;
  /** Positiv. */
  avgIncomeCents: number;
  /** Negativ, wie ueberall in der App. */
  avgExpenseCents: number;
  /** avgIncomeCents + avgExpenseCents — was pro Monat uebrig bleibt. */
  avgNetCents: number;
}

export interface ProjectionPoint {
  monthsAhead: number;
  balanceCents: number;
}

export interface Projection {
  /** false = zu wenig Historie oder kein berechenbarer Kontostand. */
  available: boolean;
  /** Wie viele volle Monate Historie vorliegen — fuer den Hinweistext. */
  fullMonthsAvailable: number;
  startBalanceCents: number | null;
  basis: ProjectionBasis | null;
  points: ProjectionPoint[];
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(yyyyMm: string, delta: number): string {
  const [year, month] = yyyyMm.split('-').map(Number) as [number, number];
  return monthKey(new Date(Date.UTC(year, month - 1 + delta, 1)));
}

function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * Erster Monat, der vollstaendig von der Aufzeichnung abgedeckt ist. Beginnt
 * die Aufzeichnung mitten im Monat, ist dieser Monat unvollstaendig und wuerde
 * den Schnitt nach unten ziehen.
 */
function firstFullMonth(historyStart: string): string {
  const month = historyStart.slice(0, 7);
  return historyStart.endsWith('-01') ? month : shiftMonth(month, 1);
}

/**
 * Der laufende Monat bleibt aussen vor: er ist angebrochen und wuerde den
 * Schnitt verfaelschen — am dritten Tag eines Monats sind kaum Ausgaben
 * gebucht, der Durchschnitt saehe schlagartig gut aus.
 */
export function getProjection(db: Database, today: Date = new Date()): Projection {
  const currentMonth = monthKey(today);
  const lastFullMonth = shiftMonth(currentMonth, -1);

  const historyStart = getHistoryStart(db);
  const balance = getCurrentBalance(db);

  const fullMonthsAvailable =
    historyStart === null ? 0 : Math.max(0, monthsBetween(firstFullMonth(historyStart), lastFullMonth) + 1);

  if (fullMonthsAvailable < MIN_MONTHS || !balance.available || balance.cents === null) {
    return {
      available: false,
      fullMonthsAvailable,
      startBalanceCents: balance.cents,
      basis: null,
      points: [],
    };
  }

  const months = Math.min(AVERAGE_MONTHS, fullMonthsAvailable);
  const fromMonth = shiftMonth(lastFullMonth, -(months - 1));
  const rangeStart = `${fromMonth}-01`;
  const rangeEnd = `${shiftMonth(lastFullMonth, 1)}-01`;

  // Transfers und Einmalausgaben raus: das eine ist kein Verbrauch, das andere
  // wiederholt sich nicht. Beides wuerde den Schnitt unbrauchbar machen.
  const sums = queryOne<{ income: number; expense: number }>(
    db,
    `SELECT
       COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents END), 0) AS income,
       COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents END), 0) AS expense
     FROM transactions
     WHERE is_transfer = 0 AND is_exceptional = 0
       AND date >= ? AND date < ?`,
    [rangeStart, rangeEnd],
  )!;

  const avgIncomeCents = Math.round(sums.income / months);
  const avgExpenseCents = Math.round(sums.expense / months);
  const avgNetCents = avgIncomeCents + avgExpenseCents;

  return {
    available: true,
    fullMonthsAvailable,
    startBalanceCents: balance.cents,
    basis: { months, fromMonth, toMonth: lastFullMonth, avgIncomeCents, avgExpenseCents, avgNetCents },
    points: HORIZONS.map((monthsAhead) => ({
      monthsAhead,
      balanceCents: balance.cents! + avgNetCents * monthsAhead,
    })),
  };
}
