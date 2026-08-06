import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const base =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium ' +
  'transition-[filter,background-color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent enabled:hover:brightness-110 enabled:active:brightness-95',
  secondary: 'border border-border bg-surface-2 text-text enabled:hover:border-accent',
  danger: 'bg-negative text-on-accent enabled:hover:brightness-110 enabled:active:brightness-95',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
