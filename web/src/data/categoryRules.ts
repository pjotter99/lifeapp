import type { Database } from 'sql.js';
import { execRun, lastInsertRowId, queryAll, queryOne } from './sqlHelpers.ts';

/**
 * Regeln, die aus dem Empfaenger einer Bankbuchung eine Kategorie ableiten.
 *
 * Der Import setzt die Kategorie damit vor, laesst sie aber offen:
 * category_locked bleibt 0, damit ein Fehlgriff der Regel im
 * Nachkategorisieren-Screen korrigierbar ist und kein spaeterer Automatismus
 * die Korrektur wieder ueberschreibt (CLAUDE.md, harte Regel 5).
 */

export type MatchType = 'contains' | 'exact';

export interface CategoryRule {
  id: number;
  pattern: string;
  match_type: MatchType;
  category_id: number;
  priority: number;
  created_at: string;
}

/** Regel samt Klarnamen der Zielkategorie — fuer die Anzeige. */
export interface CategoryRuleListItem extends CategoryRule {
  category_name: string;
  parent_name: string | null;
}

export interface CreateRuleInput {
  pattern: string;
  match_type: MatchType;
  category_id: number;
  priority?: number;
}

export type UpdateRuleInput = Partial<CreateRuleInput>;

/**
 * Vergleichsform: Gross-/Kleinschreibung und umgebende Leerzeichen sind egal.
 * Banken schreiben denselben Empfaenger mal "REWE Markt", mal "Rewe SAGT
 * DANKE" — ein Muster soll nicht daran scheitern.
 */
function normalize(value: string): string {
  return value.trim().toLocaleUpperCase('de-DE');
}

/**
 * Reihenfolge bei mehreren Treffern: hoechste priority gewinnt, bei
 * Gleichstand das laengere Muster (das spezifischere), zuletzt die kleinere
 * id — damit das Ergebnis bei sonst identischen Regeln stabil bleibt statt
 * von der Zeilenreihenfolge abzuhaengen.
 */
function compareRules(a: CategoryRule, b: CategoryRule): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.pattern.length !== b.pattern.length) return b.pattern.length - a.pattern.length;
  return a.id - b.id;
}

export function getCategoryRules(db: Database): CategoryRuleListItem[] {
  const rules = queryAll<CategoryRuleListItem>(
    db,
    `SELECT r.id, r.pattern, r.match_type, r.category_id, r.priority, r.created_at,
            c.name AS category_name, p.name AS parent_name
     FROM category_rules r
     JOIN categories c ON c.id = r.category_id
     LEFT JOIN categories p ON p.id = c.parent_id`,
  );
  // In der Wirkreihenfolge sortiert, damit die Liste im UI zeigt, welche
  // Regel bei einem Konflikt tatsaechlich gewinnt.
  return rules.sort(compareRules);
}

/**
 * Findet die Regel, die fuer einen Empfaenger greift. Ohne payee gibt es
 * nichts zu vergleichen — importierte Buchungen ohne Gegenpartei bleiben
 * unkategorisiert.
 */
export function matchRule(rules: CategoryRule[], payee: string | null): CategoryRule | null {
  if (payee === null) return null;
  const haystack = normalize(payee);
  if (haystack === '') return null;

  const hits = rules.filter((rule) => {
    const needle = normalize(rule.pattern);
    if (needle === '') return false;
    return rule.match_type === 'exact' ? haystack === needle : haystack.includes(needle);
  });

  return hits.sort(compareRules)[0] ?? null;
}

// Rechtsformen und SEPA-Beiwerk, die den Empfaenger nicht unterscheiden.
const LEGAL_FORMS = /\b(gmbh|mbh|ag|se|kg|ohg|e\.?\s?k\.?|e\.?\s?v\.?|ug|s\.?c\.?a\.?|co|kgaa|ltd|inc|bv|nv)\b/gi;

/**
 * Schlaegt aus einem Empfaenger ein Muster vor. Absichtlich schlicht: das Feld
 * ist im Screen editierbar, der Vorschlag soll Tipparbeit sparen und nicht
 * clever raten.
 *
 * "REWE Markt GmbH//BERLIN/DE" -> "REWE Markt"
 */
export function suggestPattern(payee: string): string {
  let value = payee;
  // SEPA haengt oft "//Ort/Land" an.
  const sepaCut = value.indexOf('//');
  if (sepaCut > 0) value = value.slice(0, sepaCut);

  value = value
    .replace(LEGAL_FORMS, ' ')
    // Karten-/Referenznummern und Datumsfragmente tragen nichts bei.
    .replace(/\b\d[\d./-]{3,}\b/g, ' ')
    .replace(/[.,;:*|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Erste zwei Woerter reichen als Startpunkt; mehr macht das Muster
  // unnoetig spitz (Filialnummern, Ortsangaben).
  const words = value.split(' ').filter((w) => w.length > 0);
  const suggestion = words.slice(0, 2).join(' ');
  // Bleibt nach dem Putzen nichts uebrig, lieber den Originalwert anbieten
  // als ein leeres Feld.
  return suggestion === '' ? payee.trim() : suggestion;
}

function validate(db: Database, input: CreateRuleInput | UpdateRuleInput): void {
  if (input.pattern !== undefined && input.pattern.trim() === '') {
    throw new Error('Muster darf nicht leer sein.');
  }
  if (input.match_type !== undefined && input.match_type !== 'contains' && input.match_type !== 'exact') {
    throw new Error("match_type muss 'contains' oder 'exact' sein.");
  }
  if (input.priority !== undefined && !Number.isInteger(input.priority)) {
    throw new Error('priority muss eine Ganzzahl sein.');
  }
  if (input.category_id !== undefined) {
    const category = queryOne<{ archived: number }>(db, 'SELECT archived FROM categories WHERE id = ?', [
      input.category_id,
    ]);
    if (!category || category.archived) {
      throw new Error('Unbekannte oder archivierte Kategorie.');
    }
  }
}

export function createCategoryRule(db: Database, input: CreateRuleInput): CategoryRule {
  validate(db, input);
  if (input.pattern === undefined || input.match_type === undefined || input.category_id === undefined) {
    throw new Error('Muster, Art und Kategorie werden benoetigt.');
  }

  execRun(db, 'INSERT INTO category_rules (pattern, match_type, category_id, priority) VALUES (?, ?, ?, ?)', [
    input.pattern.trim(),
    input.match_type,
    input.category_id,
    input.priority ?? 0,
  ]);
  return queryOne<CategoryRule>(db, 'SELECT * FROM category_rules WHERE id = ?', [lastInsertRowId(db)])!;
}

export function updateCategoryRule(db: Database, id: number, input: UpdateRuleInput): CategoryRule {
  const existing = queryOne<CategoryRule>(db, 'SELECT * FROM category_rules WHERE id = ?', [id]);
  if (!existing) {
    throw new Error('Regel nicht gefunden.');
  }
  validate(db, input);

  const updates: Record<string, string | number> = {};
  if (input.pattern !== undefined) updates.pattern = input.pattern.trim();
  if (input.match_type !== undefined) updates.match_type = input.match_type;
  if (input.category_id !== undefined) updates.category_id = input.category_id;
  if (input.priority !== undefined) updates.priority = input.priority;

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    throw new Error('Keine Aenderungen angegeben.');
  }

  execRun(db, `UPDATE category_rules SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [
    ...keys.map((k) => updates[k]!),
    id,
  ]);
  return queryOne<CategoryRule>(db, 'SELECT * FROM category_rules WHERE id = ?', [id])!;
}

export function deleteCategoryRule(db: Database, id: number): void {
  const { changes } = execRun(db, 'DELETE FROM category_rules WHERE id = ?', [id]);
  if (changes === 0) {
    throw new Error('Regel nicht gefunden.');
  }
}
