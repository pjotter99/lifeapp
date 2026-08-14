import type { CSSProperties, ReactNode } from 'react';

interface RingProps {
  /** Fortschritt in Prozent. Werte ausserhalb 0–100 werden gedeckelt. */
  value: number;
  /** Beschriftung unter der Zahl, Monospace-Versalien, 10px. */
  label?: string;
  /** Inhalt in der Mitte — im Regelfall ein Betrag. */
  children?: ReactNode;
  /** Aussendurchmesser in px. */
  size?: number;
  /** Ueberschreibt --accent, z. B. fuer Kategoriefarben. */
  color?: string;
}

const STROKE = 2;
const VIEWBOX = 100;

export function Ring({ value, label, children, size = 200, color }: RingProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (VIEWBOX - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* vector-effect: die viewBox skaliert auf jede size, der Strich soll
          aber laut Design-Abschnitt immer 2px bleiben und nicht mitwachsen.
          Die Strichmuster-Laenge (dasharray) bleibt davon unberuehrt, sie
          zaehlt in Nutzereinheiten entlang des Pfades. */}
      <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} className="h-full w-full" aria-hidden="true">
        <circle
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth={STROKE}
          vectorEffect="non-scaling-stroke"
        />
        <circle
          className="hud-ring-draw"
          cx={VIEWBOX / 2}
          cy={VIEWBOX / 2}
          r={radius}
          fill="none"
          stroke={color ?? 'var(--accent)'}
          strokeWidth={STROKE}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          // Start oben statt rechts; die Drehung sitzt am Element, damit der
          // Inhalt in der Mitte davon unberuehrt bleibt.
          transform={`rotate(-90 ${VIEWBOX / 2} ${VIEWBOX / 2})`}
          style={{ '--ring-circumference': circumference } as CSSProperties}
        />
      </svg>

      {/* role/aria am Container statt am SVG: Screenreader lesen dann Wert und
          Beschriftung zusammen, nicht zwei getrennte Fragmente. */}
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-4 text-center"
      >
        {children}
        {label && <span className="hud-label">{label}</span>}
      </div>
    </div>
  );
}
