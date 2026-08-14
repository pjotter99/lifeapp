import type { ButtonHTMLAttributes } from 'react';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({ selected = false, className = '', ...props }: ChipProps) {
  const tone = selected
    ? 'border-accent bg-surface-2 text-accent'
    : 'border-border text-text-dim enabled:hover:border-border-lit enabled:hover:text-text';

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={
        'min-h-11 rounded-control border px-4 font-mono text-xs uppercase tracking-[0.12em] ' +
        `transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${className}`
      }
      {...props}
    />
  );
}
