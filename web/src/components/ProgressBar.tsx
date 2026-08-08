interface ProgressBarProps {
  value: number;
  label?: string;
  /** Ueberschreibt die Standardfarbe (--accent), z. B. fuer Kategorie-Farben in der Auswertung. */
  color?: string;
}

export function ProgressBar({ value, label, color }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="flex w-full flex-col gap-1.5">
      {label && <span className="text-sm text-text-dim">{label}</span>}
      <div
        role="progressbar"
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-150 ${color ? '' : 'bg-accent'}`}
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
