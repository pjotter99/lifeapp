import { forwardRef, useId, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

const fieldClasses =
  'min-h-11 w-full rounded-md border border-border bg-surface px-3 text-text ' +
  'placeholder:text-text-dim transition-colors duration-150 enabled:hover:border-text-dim ' +
  'focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, id, className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  const field = <input ref={ref} id={inputId} className={`${fieldClasses} ${className}`} {...props} />;

  if (!label) return field;

  return (
    <label htmlFor={inputId} className="flex flex-col gap-1.5 text-sm text-text-dim">
      {label}
      {field}
    </label>
  );
});
