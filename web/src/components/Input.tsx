import { forwardRef, useId, type InputHTMLAttributes } from 'react';

type FieldSize = 'md' | 'lg';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  fieldSize?: FieldSize;
}

const baseClasses =
  'w-full rounded-md border border-border bg-surface text-text ' +
  'placeholder:text-text-dim transition-colors duration-150 enabled:hover:border-text-dim ' +
  'focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50';

// "lg" ist der grosse Mono-Betrag (Ausgabenerfassung, Dashboard-Kontostand).
const sizeClasses: Record<FieldSize, string> = {
  md: 'min-h-11 px-3 text-base',
  lg: 'min-h-16 px-4 py-4 text-center text-5xl font-semibold tabular-amount',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, id, fieldSize = 'md', className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  const field = <input ref={ref} id={inputId} className={`${baseClasses} ${sizeClasses[fieldSize]} ${className}`} {...props} />;

  if (!label) return field;

  return (
    <label htmlFor={inputId} className="flex flex-col gap-1.5 text-sm text-text-dim">
      {label}
      {field}
    </label>
  );
});
