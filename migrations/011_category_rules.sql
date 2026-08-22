-- 011_category_rules.sql
-- Regeln, die beim Bank-Import aus dem Empfaenger (payee) automatisch eine
-- Kategorie ableiten. Bis hierher setzte der Import bewusst keine Kategorie;
-- die Regeln nehmen die Wiederholarbeit ab, ohne die Entscheidung
-- festzuschreiben.

CREATE TABLE category_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern     TEXT NOT NULL,
  match_type  TEXT NOT NULL CHECK (match_type IN ('contains', 'exact')),
  -- NOT NULL: eine Regel ohne Zielkategorie hat keinen Zweck.
  category_id INTEGER NOT NULL REFERENCES categories (id),
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Die Auswahlreihenfolge bei mehreren Treffern: hoechste priority zuerst,
-- bei Gleichstand das laengere (spezifischere) Muster.
CREATE INDEX idx_category_rules_order ON category_rules (priority DESC, length(pattern) DESC);
