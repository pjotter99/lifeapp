import { forwardRef, useId, type InputHTMLAttributes } from 'react';

type FieldSize = 'md' | 'lg';
type FieldWidth = 'full' | 'auto';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  fieldSize?: FieldSize;
  /**
   * "auto" begrenzt die Breite auf den Inhalt statt volle Breite — fuer
   * kurze Werte wie Betraege/Prozentsaetze. self-start noetig, weil ein
   * umgebendes "flex flex-col" (siehe unten) das Feld sonst per
   * align-items:stretch trotzdem auf volle Breite ziehen wuerde.
   */
  fieldWidth?: FieldWidth;
}

const baseClasses =
  'rounded-md border border-border bg-surface text-text ' +
  'placeholder:text-text-dim transition-colors duration-150 enabled:hover:border-text-dim ' +
  'focus-visible:border-accent disabled:cursor-not-allowed disabled:opacity-50';

// "lg" ist der grosse Mono-Betrag (Ausgabenerfassung, Dashboard-Kontostand).
const sizeClasses: Record<FieldSize, string> = {
  md: 'min-h-11 px-3 text-base',
  lg: 'min-h-16 px-4 py-4 text-center text-5xl font-semibold tabular-amount',
};

const widthClasses: Record<FieldWidth, string> = {
  full: 'w-full',
  auto: 'w-auto self-start',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, id, fieldSize = 'md', fieldWidth = 'full', className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  const field = (
    <input
      ref={ref}
      id={inputId}
      className={`${baseClasses} ${sizeClasses[fieldSize]} ${widthClasses[fieldWidth]} ${className}`}
      {...props}
    />
  );

  if (!label) return field;

  return (
    <label htmlFor={inputId} className="flex flex-col gap-1.5 text-sm text-text-dim">
      {label}
      {field}
    </label>
  );
});
