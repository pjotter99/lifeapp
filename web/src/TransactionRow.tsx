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

interface TransactionRowProps {
  tx: Transaction;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onDelete: () => void;
}

// Wisch-Geste ist ein einfacher Schwellwert (Start- vs. Endpunkt), kein
// kontinuierliches Mitziehen — robuster gegen Fehlgesten, das Zuklappen per
// Tap auf die offene Zeile faengt den Rest ab. Ueber Pointer- statt
// Touch-Events, damit es auch mit der Maus (Desktop, Tests) funktioniert.
export function TransactionRow({ tx, isOpen, onOpen, onClose, onDelete }: TransactionRowProps) {
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

  return (
    <div className="relative overflow-hidden rounded-md">
      <button
        type="button"
        onClick={onDelete}
        className="absolute inset-y-0 right-0 flex w-20 items-center justify-center bg-negative text-sm font-medium text-on-accent"
      >
        Löschen
      </button>
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onClick={() => {
          if (isOpen) onClose();
        }}
        className="relative z-10 flex items-center gap-3 bg-surface px-1 py-2 transition-transform duration-150"
        style={{ transform: isOpen ? 'translateX(-5rem)' : 'translateX(0)' }}
      >
        <span className="w-12 shrink-0 text-sm text-text-dim">{formatShortDate(tx.date)}</span>
        <span className="flex-1 truncate text-sm text-text">{tx.category_name}</span>
        <Amount cents={tx.amount_cents} size="sm" />
      </div>
    </div>
  );
}
