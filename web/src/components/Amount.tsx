type Size = 'sm' | 'md' | 'lg';

interface AmountProps {
  cents: number;
  size?: Size;
  className?: string;
}

const sizes: Record<Size, string> = {
  sm: 'text-sm',
  md: 'text-xl',
  lg: 'text-5xl',
};

const formatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function Amount({ cents, size = 'md', className = '' }: AmountProps) {
  const tone = cents > 0 ? 'text-positive' : cents < 0 ? 'text-negative' : 'text-text';

  return <span className={`tabular-amount font-semibold ${sizes[size]} ${tone} ${className}`}>{formatter.format(cents / 100)}</span>;
}
