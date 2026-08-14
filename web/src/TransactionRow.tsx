import type { PointerEvent } from 'react';
import { useRef } from 'react';
import { Amount } from './components';

export interface Transaction {
  id: number;
  date: string;
  amount_cents: number;
  category_id: number;
  category_name: string;
  is_transfer: number;
}

function formatShortDate(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}.${month}.`;
}

// Statusmarkierung laut Design-Abschnitt: rot fuer Ausgaben, gruen fuer
// Einnahmen, gedaempftes Cyan fuer Transfers. Transfers zuerst pruefen — sie
// sind je nach Richtung positiv oder negativ und wuerden sonst als Ein- oder
// Ausgabe eingefaerbt.
function statusStripe(tx: Transaction): string {
  if (tx.is_transfer === 1) return 'border-l-accent-dim';
  return tx.amount_cents > 0 ? 'border-l-positive' : 'border-l-negative';
}

interface TransactionRowProps {
  tx: Transaction;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDelete: () => void;
  /** Trennlinie nach oben — beim ersten Eintrag einer Liste weglassen. */
  separated?: boolean;
}

// Wisch-Geste ist ein einfacher Schwellwert (Start- vs. Endpunkt), kein
// kontinuierliches Mitziehen — robuster gegen Fehlgesten, das Zuklappen per
// Tap auf die offene Zeile faengt den Rest ab. Ueber Pointer- statt
// Touch-Events, damit es auch mit der Maus (Desktop, Tests) funktioniert.
export function TransactionRow({ tx, isOpen, onOpen, onClose, onDelete, separated = false }: TransactionRowProps) {
  const startRef = useRef<{ x: number; y: number } | null>(null);

  function handlePointerDown(e: PointerEvent) {
    startRef.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerUp(e: PointerEvent) {
    const start = startRef.current;
    startRef.current = null;
    if (!start) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) < Math.abs(dy)) return; // vertikale Geste: normales Scrollen

    if (dx < -40) {
      onOpen();
    } else if (dx > 20) {
      onClose();
    }
  }

  // Statusstrich und Trennlinie sitzen auf der Huelle, nicht auf der
  // verschiebbaren Ebene: beim Aufwischen soll die Markierung stehen bleiben
  // und nur der Inhalt zur Seite fahren.
  return (
    <div
      className={`relative overflow-hidden border-l-2 ${statusStripe(tx)} ${separated ? 'border-t border-t-border' : ''}`}
    >
      <button
        type="button"
        onClick={onDelete}
        className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-negative font-mono text-xs uppercase tracking-[0.06em] text-on-accent"
      >
        Löschen
      </button>
      {/* bg-surface ist hier kein Dekor, sondern noetig, damit der
          Loeschen-Knopf hinter der Zeile verdeckt bleibt. Gleicher Ton wie
          das umgebende Panel, also unsichtbar als eigene Flaeche. */}
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onClick={() => {
          if (isOpen) onClose();
        }}
        className="relative z-10 flex items-center gap-3 bg-surface py-3 pl-3 transition-transform duration-150"
        style={{ transform: isOpen ? 'translateX(-5rem)' : 'translateX(0)' }}
      >
        <span className="hud-label w-12 shrink-0">{formatShortDate(tx.date)}</span>
        <span className="flex-1 truncate text-sm text-text">{tx.category_name}</span>
        <Amount cents={tx.amount_cents} size="sm" />
      </div>
    </div>
  );
}
