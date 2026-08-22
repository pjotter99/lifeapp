import assert from 'node:assert/strict';
import test from 'node:test';
import { getCategories, type Category } from './categories.ts';
import {
  createCategoryRule,
  deleteCategoryRule,
  getCategoryRules,
  matchRule,
  suggestPattern,
  updateCategoryRule,
  type CategoryRule,
} from './categoryRules.ts';
import { createTestDb } from './testDb.ts';

function findCategory(categories: Category[], name: string, parentName: string): Category {
  const match = categories.find(
    (c) => c.name === name && categories.find((p) => p.id === c.parent_id)?.name === parentName,
  );
  if (!match) throw new Error(`Kategorie "${name}" nicht gefunden.`);
  return match;
}

/** Regel-Attrappe fuer die reinen Matching-Tests, ohne Datenbank. */
function rule(over: Partial<CategoryRule> = {}): CategoryRule {
  return {
    id: 1,
    pattern: 'REWE',
    match_type: 'contains',
    category_id: 10,
    priority: 0,
    created_at: '2026-08-15',
    ...over,
  };
}

// --- Matching --------------------------------------------------------------

test('contains trifft irgendwo im Empfaenger', () => {
  assert.equal(matchRule([rule()], 'REWE Markt GmbH')?.id, 1);
  assert.equal(matchRule([rule()], 'Zahlung an REWE')?.id, 1);
  assert.equal(matchRule([rule()], 'ALDI Sued'), null);
});

test('exact verlangt den vollstaendigen Empfaenger', () => {
  const r = rule({ match_type: 'exact', pattern: 'REWE Markt' });
  assert.equal(matchRule([r], 'REWE Markt')?.id, 1);
  assert.equal(matchRule([r], 'REWE Markt GmbH'), null);
});

// Banken schreiben denselben Empfaenger mal so, mal so.
test('Gross-/Kleinschreibung und Randleerzeichen sind egal', () => {
  assert.ok(matchRule([rule({ pattern: 'rewe' })], 'REWE MARKT'));
  assert.ok(matchRule([rule({ pattern: '  REWE  ' })], 'rewe markt'));
  assert.ok(matchRule([rule({ match_type: 'exact', pattern: 'rewe markt' })], '  REWE Markt  '));
});

test('Ohne Empfaenger greift keine Regel', () => {
  assert.equal(matchRule([rule()], null), null);
  assert.equal(matchRule([rule()], '   '), null);
});

test('Leeres Muster greift nie', () => {
  assert.equal(matchRule([rule({ pattern: '   ' })], 'REWE'), null);
});

// --- Reihenfolge bei mehreren Treffern -------------------------------------

test('Hoechste priority gewinnt', () => {
  const hits = [
    rule({ id: 1, pattern: 'REWE', priority: 0, category_id: 10 }),
    rule({ id: 2, pattern: 'REWE', priority: 5, category_id: 20 }),
  ];
  assert.equal(matchRule(hits, 'REWE Markt')?.category_id, 20);
});

test('Bei gleicher priority gewinnt das laengere Muster', () => {
  const hits = [
    rule({ id: 1, pattern: 'REWE', priority: 0, category_id: 10 }),
    rule({ id: 2, pattern: 'REWE Markt', priority: 0, category_id: 20 }),
  ];
  assert.equal(matchRule(hits, 'REWE Markt Berlin')?.category_id, 20, 'spezifischer');
});

// priority schlaegt Laenge — sonst waere die Einstellung wirkungslos, sobald
// irgendwo ein laengeres Muster steht.
test('priority schlaegt Musterlaenge', () => {
  const hits = [
    rule({ id: 1, pattern: 'REWE Markt Berlin Mitte', priority: 0, category_id: 10 }),
    rule({ id: 2, pattern: 'REWE', priority: 1, category_id: 20 }),
  ];
  assert.equal(matchRule(hits, 'REWE Markt Berlin Mitte')?.category_id, 20);
});

test('Bei sonst gleichen Regeln entscheidet die kleinere id, nicht die Zeilenreihenfolge', () => {
  const a = rule({ id: 7, pattern: 'REWE', category_id: 10 });
  const b = rule({ id: 3, pattern: 'REWE', category_id: 20 });
  assert.equal(matchRule([a, b], 'REWE')?.id, 3);
  assert.equal(matchRule([b, a], 'REWE')?.id, 3, 'unabhaengig von der Eingabereihenfolge');
});

// --- suggestPattern --------------------------------------------------------

test('suggestPattern entfernt Rechtsform und SEPA-Anhang', () => {
  assert.equal(suggestPattern('REWE Markt GmbH//BERLIN/DE'), 'REWE Markt');
  assert.equal(suggestPattern('Stadtwerke AG'), 'Stadtwerke');
  assert.equal(suggestPattern('Muster Handels GmbH & Co. KG'), 'Muster Handels');
});

test('suggestPattern kuerzt auf die ersten zwei Woerter', () => {
  assert.equal(suggestPattern('Deutsche Telekom Festnetz Rechnung'), 'Deutsche Telekom');
});

test('suggestPattern wirft Referenznummern weg', () => {
  assert.equal(suggestPattern('ALDI SAGT DANKE 12.08.2026'), 'ALDI SAGT');
  assert.equal(suggestPattern('Amazon 302-1234567-1234567'), 'Amazon');
});

// Lieber der Originalwert als ein leeres Feld — der Nutzer kuerzt selbst.
test('suggestPattern gibt den Originalwert zurueck, wenn nichts uebrig bleibt', () => {
  assert.equal(suggestPattern('GmbH'), 'GmbH');
  assert.equal(suggestPattern('  AG  '), 'AG');
});

// --- CRUD ------------------------------------------------------------------

test('createCategoryRule legt an und trimmt das Muster', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');

  const created = createCategoryRule(db, { pattern: '  REWE  ', match_type: 'contains', category_id: einkauf.id });

  assert.equal(created.pattern, 'REWE');
  assert.equal(created.priority, 0, 'Default');
  assert.equal(getCategoryRules(db).length, 1);
});

test('getCategoryRules liefert Klarnamen und sortiert in Wirkreihenfolge', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const geschenke = findCategory(categories, 'Geschenke', 'Persönlich');

  createCategoryRule(db, { pattern: 'A', match_type: 'contains', category_id: einkauf.id, priority: 0 });
  createCategoryRule(db, { pattern: 'BBBB', match_type: 'contains', category_id: geschenke.id, priority: 0 });
  createCategoryRule(db, { pattern: 'C', match_type: 'contains', category_id: einkauf.id, priority: 9 });

  const list = getCategoryRules(db);
  assert.deepEqual(
    list.map((r) => r.pattern),
    ['C', 'BBBB', 'A'],
    'priority, dann Laenge',
  );
  assert.equal(list[1]!.category_name, 'Geschenke');
  assert.equal(list[1]!.parent_name, 'Persönlich');
});

test('createCategoryRule wirft bei leerem Muster oder unbekannter Kategorie', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');

  assert.throws(
    () => createCategoryRule(db, { pattern: '   ', match_type: 'contains', category_id: einkauf.id }),
    /nicht leer/,
  );
  assert.throws(
    () => createCategoryRule(db, { pattern: 'X', match_type: 'contains', category_id: 999999 }),
    /Unbekannte oder archivierte/,
  );
});

test('updateCategoryRule aendert nur die angegebenen Felder', async () => {
  const db = await createTestDb();
  const categories = getCategories(db);
  const einkauf = findCategory(categories, 'Einkauf', 'Lebensmittel');
  const geschenke = findCategory(categories, 'Geschenke', 'Persönlich');
  const created = createCategoryRule(db, { pattern: 'REWE', match_type: 'contains', category_id: einkauf.id });

  const updated = updateCategoryRule(db, created.id, { priority: 3, category_id: geschenke.id });

  assert.equal(updated.pattern, 'REWE', 'unveraendert');
  assert.equal(updated.match_type, 'contains', 'unveraendert');
  assert.equal(updated.priority, 3);
  assert.equal(updated.category_id, geschenke.id);
});

test('updateCategoryRule wirft bei unbekannter id und ohne Aenderungen', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');
  const created = createCategoryRule(db, { pattern: 'REWE', match_type: 'contains', category_id: einkauf.id });

  assert.throws(() => updateCategoryRule(db, 999999, { priority: 1 }), /nicht gefunden/);
  assert.throws(() => updateCategoryRule(db, created.id, {}), /Keine Aenderungen/);
});

test('deleteCategoryRule entfernt die Regel und wirft bei unbekannter id', async () => {
  const db = await createTestDb();
  const einkauf = findCategory(getCategories(db), 'Einkauf', 'Lebensmittel');
  const created = createCategoryRule(db, { pattern: 'REWE', match_type: 'contains', category_id: einkauf.id });

  deleteCategoryRule(db, created.id);

  assert.equal(getCategoryRules(db).length, 0);
  assert.throws(() => deleteCategoryRule(db, created.id), /nicht gefunden/);
});
