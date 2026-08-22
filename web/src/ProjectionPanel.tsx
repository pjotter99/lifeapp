import { Amount, Panel } from './components';
import type { Projection } from './data/projection.ts';

const MONTH_SHORT = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function monthShort(yyyyMm: string): string {
  const [, month] = yyyyMm.split('-').map(Number);
  return MONTH_SHORT[(month ?? 1) - 1] ?? yyyyMm;
}

/** "Mai–Juli" bzw. "Juni–Juli" — bei einem Monat nur dieser. */
function basisLabel(fromMonth: string, toMonth: string): string {
  const from = monthShort(fromMonth);
  const to = monthShort(toMonth);
  return from === to ? from : `${from}–${to}`;
}

export function ProjectionPanel({ projection, index }: { projection: Projection; index?: number }) {
  if (!projection.available || projection.basis === null || projection.startBalanceCents === null) {
    return (
      <Panel title="Hochrechnung" index={index} className="flex flex-col gap-2">
        {/* Fehlendes Startdatum zuerst pruefen: ohne das gibt es weder einen
            Kontostand noch eine Historie, und "zu wenig Historie" waere dann
            die falsche Erklaerung. */}
        <p className="text-sm text-text-dim">
          {projection.startBalanceCents === null
            ? 'Kontostand nicht berechenbar — bei einem Konto fehlt das Startdatum.'
            : `Noch zu wenig Historie — ${projection.fullMonthsAvailable === 1 ? 'ein voller Monat' : 'kein voller Monat'} erfasst. Ab zwei vollen Monaten erscheint hier eine Kurve.`}
        </p>
      </Panel>
    );
  }

  const { basis, startBalanceCents, points } = projection;
  const series = [{ monthsAhead: 0, balanceCents: startBalanceCents }, ...points];

  return (
    <Panel
      title="Hochrechnung"
      status={`Basis: Durchschnitt ${basisLabel(basis.fromMonth, basis.toMonth)}`}
      index={index}
      className="flex flex-col gap-4"
    >
      <ProjectionChart series={series} />

      <dl className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="hud-label">Einnahmen je Monat</dt>
          <Amount cents={basis.avgIncomeCents} size="sm" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="hud-label">Ausgaben je Monat</dt>
          <Amount cents={basis.avgExpenseCents} size="sm" />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-1.5">
          <dt className="hud-label">Bleibt je Monat</dt>
          <Amount cents={basis.avgNetCents} size="sm" />
        </div>
      </dl>

      {/* Die Annahme ausschreiben: eine Hochrechnung aus wenigen Monaten ist
          eine Fortschreibung, keine Vorhersage. */}
      <p className="text-xs text-text-dim">
        Fortschreibung des Durchschnitts aus {basis.months} {basis.months === 1 ? 'Monat' : 'Monaten'}. Transfers und
        außergewöhnliche Ausgaben sind ausgenommen; anstehende Fixkosten stecken im Durchschnitt, nicht als Termin.
      </p>
    </Panel>
  );
}

const CHART_HEIGHT = 120;
const CHART_WIDTH = 300;
const PAD_Y = 12;

function ProjectionChart({ series }: { series: { monthsAhead: number; balanceCents: number }[] }) {
  const values = series.map((p) => p.balanceCents);
  // Die Nulllinie gehoert immer ins Bild: ob die Kurve sie schneidet, ist die
  // eigentliche Aussage.
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;

  const x = (i: number) => (i / (series.length - 1)) * CHART_WIDTH;
  const y = (cents: number) => PAD_Y + (1 - (cents - min) / span) * (CHART_HEIGHT - 2 * PAD_Y);

  const path = series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.balanceCents).toFixed(1)}`).join(' ');
  const zeroY = y(0);
  const endsNegative = values[values.length - 1]! < 0;

  return (
    <div className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-32 w-full" aria-hidden="true">
        <line x1="0" y1={zeroY} x2={CHART_WIDTH} y2={zeroY} stroke="var(--border)" strokeWidth="1" />
        <path
          d={path}
          fill="none"
          stroke={endsNegative ? 'var(--negative)' : 'var(--accent)'}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {series.map((p, i) => (
          <circle
            key={p.monthsAhead}
            cx={x(i)}
            cy={y(p.balanceCents)}
            r="2.5"
            fill={endsNegative ? 'var(--negative)' : 'var(--accent)'}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      <div className="flex justify-between">
        {series.map((p) => (
          <span key={p.monthsAhead} className="hud-label">
            {p.monthsAhead === 0 ? 'jetzt' : `+${p.monthsAhead}`}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="hud-label">In 12 Monaten</span>
        <Amount cents={series[series.length - 1]!.balanceCents} size="sm" />
      </div>
    </div>
  );
}
