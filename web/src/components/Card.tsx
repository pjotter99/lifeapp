import type { HTMLAttributes } from 'react';

type Surface = 'surface' | 'surface-2';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  surface?: Surface;
}

const surfaces: Record<Surface, string> = {
  surface: 'bg-surface',
  'surface-2': 'bg-surface-2',
};

export function Card({ surface = 'surface', className = '', ...props }: CardProps) {
  return <div className={`rounded-card border border-border p-5 ${surfaces[surface]} ${className}`} {...props} />;
}
