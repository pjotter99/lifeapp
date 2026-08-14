import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

type Surface = 'surface' | 'surface-2';

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Sektionstitel, wird als `// TITEL` in Monospace-Versalien gesetzt. */
  title?: string;
  /** Statuszusatz rechts oben in der Titelzeile. Ohne Titel wirkungslos. */
  status?: ReactNode;
  surface?: Surface;
  /** Aktives/fokussiertes Panel: Rahmen in --border-lit statt --border. */
  lit?: boolean;
  /**
   * Position in einer Panel-Folge. Staffelt das Einblenden um 40ms je Panel.
   * Nur setzen, wo mehrere Panels gleichzeitig erscheinen.
   */
  index?: number;
}

const surfaces: Record<Surface, string> = {
  surface: 'bg-surface',
  'surface-2': 'bg-surface-2',
};

const STAGGER_MS = 40;

export function Panel({
  title,
  status,
  surface = 'surface',
  lit = false,
  index = 0,
  className = '',
  style,
  children,
  ...props
}: PanelProps) {
  const shell =
    'hud-panel hud-panel-in relative rounded-panel border p-5 ' +
    `${lit ? 'border-border-lit' : 'border-border'} ${surfaces[surface]}`;
  const shellStyle = { ...style, '--panel-delay': `${index * STAGGER_MS}ms` } as CSSProperties;

  // Ohne Titel verhaelt sich das Panel wie die alte Card: die Kinder sitzen
  // direkt im Rahmen, className beschreibt ihr Layout. Mit Titel braucht es
  // einen Rumpf, sonst wuerde die Titelzeile Teil dieses Layouts — deshalb
  // wandert className dann auf den Rumpf statt auf die Huelle.
  if (!title) {
    return (
      <div className={`${shell} ${className}`} style={shellStyle} {...props}>
        {children}
      </div>
    );
  }

  return (
    <div className={shell} style={shellStyle} {...props}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="hud-title">// {title}</h2>
        {status !== undefined && <span className="hud-label">{status}</span>}
      </div>
      <div className={className}>{children}</div>
    </div>
  );
}
