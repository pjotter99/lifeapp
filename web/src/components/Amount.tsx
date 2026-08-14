type Size = 'sm' | 'md' | 'lg';

interface AmountProps {
  cents: number;
  size?: Size;
  className?: string;
}

// "lg" ist die Kontostand-Groesse im Dashboard: 44px laut Design-Abschnitt.
const sizes: Record<Size, string> = {
  sm: 'text-sm',
  md: 'text-xl',
  lg: 'text-[44px] leading-none',
};

const formatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function Amount({ cents, size = 'md', className = '' }: AmountProps) {
  // Betraege bleiben gruen/rot — sie sind der Inhalt, nicht die Struktur, und
  // duerfen deshalb nicht im Akzent-Cyan verschwinden.
  const tone = cents > 0 ? 'text-positive' : cents < 0 ? 'text-negative' : 'text-text';

  return <span className={`tabular-amount ${sizes[size]} ${tone} ${className}`}>{formatter.format(cents / 100)}</span>;
}
