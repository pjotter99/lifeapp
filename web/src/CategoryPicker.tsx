import { Chip } from './components';

export interface Category {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
  archived: number;
}

interface CategoryPickerProps {
  categories: Category[];
  topCategoryId: number | null;
  onSelectTop: (id: number) => void;
  onSelectSub: (id: number) => void;
  selectedSubId?: number | null;
  disabled?: boolean;
}

// Zweistufig, kontrolliert von aussen: der aufrufende Screen haelt
// topCategoryId selbst (er muss es beim Reset/Abbrechen sowieso zuruecksetzen)
// und entscheidet, was ein Tap auf eine Unterkategorie bedeutet — bei der
// Ausgabenerfassung ein sofortiges Speichern, bei den Stammdaten nur das
// Setzen eines Formularfelds.
export function CategoryPicker({
  categories,
  topCategoryId,
  onSelectTop,
  onSelectSub,
  selectedSubId = null,
  disabled = false,
}: CategoryPickerProps) {
  const topCategories = categories.filter((c) => c.parent_id === null);
  const subCategories = categories.filter((c) => c.parent_id === topCategoryId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {topCategories.map((cat) => (
          <Chip key={cat.id} selected={cat.id === topCategoryId} disabled={disabled} onClick={() => onSelectTop(cat.id)}>
            {cat.name}
          </Chip>
        ))}
      </div>

      {topCategoryId !== null && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {subCategories.map((cat) => (
            <Chip key={cat.id} selected={cat.id === selectedSubId} disabled={disabled} onClick={() => onSelectSub(cat.id)}>
              {cat.name}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
