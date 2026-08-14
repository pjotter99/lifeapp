interface ProportionLineProps {
  /** Anteil in Prozent. Werte ausserhalb 0–100 werden gedeckelt. */
  value: number;
  /** Ueberschreibt --accent, z. B. mit der Farbe einer Kategorie. */
  color?: string;
  /** Beschriftung darueber, Monospace-Versalien. */
  label?: string;
}

/**
 * Anteil als Haarlinie statt als gefuellter Balken — ein Balken traegt bei
 * zehn Kategorien untereinander zu viel Flaeche und konkurriert mit den
 * Betraegen. Fortschritt gegen ein Ziel ist etwas anderes und wird als `Ring`
 * dargestellt; diese Linie vergleicht nur Groessenverhaeltnisse.
 */
export function ProportionLine({ value, color, label }: ProportionLineProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && <span className="hud-label">{label}</span>}
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-px w-full bg-border"
      >
        <div
          className={`h-full ${color ? '' : 'bg-accent'}`}
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
