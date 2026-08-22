import type { Database } from 'sql.js';
import { useState } from 'react';
import { Button, Chip, Input, Panel } from './components';
import { CategoryPicker, type Category } from './CategoryPicker';
import {
  createCategoryRule,
  deleteCategoryRule,
  updateCategoryRule,
  type CategoryRuleListItem,
  type MatchType,
} from './data/categoryRules.ts';
import { persist } from './data/sqlite.ts';

const MATCH_LABELS: Record<MatchType, string> = {
  contains: 'Enthält',
  exact: 'Genau',
};

export function CategoryRulesSection({
  db,
  rules,
  categories,
  onChanged,
}: {
  db: Database | null;
  rules: CategoryRuleListItem[];
  categories: Category[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<CategoryRuleListItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
  }

  async function remove(rule: CategoryRuleListItem) {
    if (!db) return;
    setError(null);
    try {
      deleteCategoryRule(db, rule.id);
      await persist();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen.');
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="hud-title">// Kategorie-Regeln</h2>
        {!formOpen && (
          <Button variant="secondary" onClick={openCreate}>
            Neue Regel
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      {formOpen && (
        <RuleForm
          db={db}
          categories={categories}
          initial={editing}
          onDone={() => {
            closeForm();
            onChanged();
          }}
          onCancel={closeForm}
        />
      )}

      {rules.length === 0 && !formOpen && (
        <Panel>
          <p className="text-sm text-text-dim">
            Noch keine Regeln. Beim Nachkategorisieren lässt sich aus einem Empfänger direkt eine erzeugen.
          </p>
        </Panel>
      )}

      {rules.length > 0 && (
        // In Wirkreihenfolge: die oberste gewinnt, wenn mehrere passen.
        <Panel title="In Wirkreihenfolge" status={rules.length}>
          {rules.map((rule, i) => (
            <div
              key={rule.id}
              className={`flex flex-col gap-2 border-l-2 border-l-accent-dim py-3 pl-3 ${
                i > 0 ? 'border-t border-t-border' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm">{rule.pattern}</span>
                <span className="hud-label shrink-0">{MATCH_LABELS[rule.match_type]}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="hud-label">
                  {rule.parent_name ? `${rule.parent_name} · ` : ''}
                  {rule.category_name} · Priorität {rule.priority}
                </span>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditing(rule);
                      setFormOpen(true);
                    }}
                  >
                    Bearbeiten
                  </Button>
                  <Button variant="danger" onClick={() => remove(rule)}>
                    Löschen
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </Panel>
      )}
    </section>
  );
}

function RuleForm({
  db,
  categories,
  initial,
  onDone,
  onCancel,
}: {
  db: Database | null;
  categories: Category[];
  initial: CategoryRuleListItem | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pattern, setPattern] = useState(initial?.pattern ?? '');
  const [matchType, setMatchType] = useState<MatchType>(initial?.match_type ?? 'contains');
  const [priority, setPriority] = useState(String(initial?.priority ?? 0));
  const [topCategoryId, setTopCategoryId] = useState<number | null>(
    initial ? (categories.find((c) => c.id === initial.category_id)?.parent_id ?? null) : null,
  );
  const [categoryId, setCategoryId] = useState<number | null>(initial?.category_id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!db) return;
    if (pattern.trim() === '') {
      setError('Muster eingeben.');
      return;
    }
    if (categoryId === null) {
      setError('Kategorie wählen.');
      return;
    }
    const parsedPriority = Number.parseInt(priority, 10);
    if (!Number.isInteger(parsedPriority)) {
      setError('Priorität muss eine ganze Zahl sein.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const input = { pattern, match_type: matchType, category_id: categoryId, priority: parsedPriority };
      if (initial) updateCategoryRule(db, initial.id, input);
      else createCategoryRule(db, input);
      await persist();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen.');
      setSaving(false);
    }
  }

  return (
    <Panel lit title={initial ? 'Regel bearbeiten' : 'Neue Regel'} className="flex flex-col gap-4">
      <Input label="Muster" value={pattern} onChange={(e) => setPattern(e.target.value)} />

      <div className="flex flex-col gap-1.5">
        <span className="hud-label">Vergleich</span>
        <div className="flex flex-wrap gap-2">
          <Chip selected={matchType === 'contains'} onClick={() => setMatchType('contains')}>
            Enthält
          </Chip>
          <Chip selected={matchType === 'exact'} onClick={() => setMatchType('exact')}>
            Genau
          </Chip>
        </div>
      </div>

      <Input
        label="Priorität"
        fieldWidth="auto"
        inputMode="numeric"
        value={priority}
        onChange={(e) => {
          if (/^-?\d*$/.test(e.target.value)) setPriority(e.target.value);
        }}
      />

      <div className="flex flex-col gap-1.5">
        <span className="hud-label">Kategorie</span>
        <CategoryPicker
          categories={categories}
          topCategoryId={topCategoryId}
          selectedSubId={categoryId}
          onSelectTop={(id) => setTopCategoryId((current) => (current === id ? null : id))}
          onSelectSub={setCategoryId}
          disabled={saving}
        />
      </div>

      {error && <p className="text-sm text-negative">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={saving || !db} onClick={save}>
          Speichern
        </Button>
        <Button variant="secondary" disabled={saving} onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </Panel>
  );
}
