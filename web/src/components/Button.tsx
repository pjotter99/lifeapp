import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

// Rechteckig, transparenter Grund, 1px Rahmen, Monospace-Versalien. Keine
// gefuellten Farbflaechen mehr — Farbe steckt im Rahmen und im Text.
const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border px-4 ' +
  'font-mono text-xs uppercase tracking-[0.12em] ' +
  'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<Variant, string> = {
  // 12% Deckkraft statt gefuellter Flaeche — hebt den Primaerbutton ab, ohne
  // dass Cyan zur Inhaltsfarbe wird.
  primary: 'border-accent bg-accent/12 text-accent enabled:hover:bg-accent/20',
  secondary: 'border-border text-text-dim enabled:hover:border-border-lit enabled:hover:text-text',
  danger: 'border-negative bg-negative/12 text-negative enabled:hover:bg-negative/20',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
