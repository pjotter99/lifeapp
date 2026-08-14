interface ProgressBarProps {
  value: number;
  label?: string;
  /** Ueberschreibt die Standardfarbe (--accent), z. B. fuer Kategorie-Farben in der Auswertung. */
  color?: string;
}

/**
 * @deprecated Fortschritt wird im HUD-Stil als `Ring` dargestellt. Diese
 * Komponente existiert nur noch, bis die Screens umgebaut sind — Dashboard
 * (Sparfortschritt) und Auswertung (Kategorie-Anteile) zeigen sonst nichts an.
 * Auf die neuen Tokens angepasst, damit sie in der Zwischenzeit nicht aus dem
 * Bild faellt.
 */
export function ProgressBar({ value, label, color }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && <span className="hud-label">{label}</span>}
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-0.5 w-full overflow-hidden bg-border"
      >
        <div
          className={`h-full transition-[width] duration-150 ${color ? '' : 'bg-accent'}`}
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
