import type { ButtonHTMLAttributes } from 'react';

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({ selected = false, className = '', ...props }: ChipProps) {
  const tone = selected
    ? 'border-accent bg-accent text-on-accent'
    : 'border-border bg-surface-2 text-text enabled:hover:border-accent';

  return (
    <button
      type="button"
      aria-pressed={selected}
      className={
        'min-h-11 rounded-md border px-4 text-sm font-medium transition-colors duration-150 ' +
        `disabled:cursor-not-allowed disabled:opacity-50 ${tone} ${className}`
      }
      {...props}
    />
  );
}
