-- 004_recurring_transfers_balance_savings.sql
-- Erweiterung laut SPEC-erweiterung.md: recurring erzeugt jetzt automatisch
-- Buchungen, Transfers sind keine Ausgaben, Saldo-Abgleich gegen die Realitaet,
-- Sparziel, Startsaldo pro Konto. Ersetzt ausserdem den Kategorien-Seed aus 001.
--
-- Numeriert als 004, nicht 003: 003 ist bereits der Konten-Seed
-- (003_accounts_seed.sql, committed und angewendet).

-- ---------------------------------------------------------------------------
-- recurring: erzeugt jetzt Buchungen statt reine Referenzliste zu sein.
-- ---------------------------------------------------------------------------
ALTER TABLE recurring ADD COLUMN kind TEXT NOT NULL DEFAULT 'expense'
  CHECK (kind IN ('income', 'expense', 'transfer'));
ALTER TABLE recurring ADD COLUMN day_of_month INTEGER NOT NULL DEFAULT 1
  CHECK (day_of_month BETWEEN 1 AND 28);

-- ---------------------------------------------------------------------------
-- transactions: period (Idempotenz fuer den taeglichen Recurring-Job) + Transfer-Flag.
-- ---------------------------------------------------------------------------
ALTER TABLE transactions ADD COLUMN period TEXT
  CHECK (period IS NULL OR period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]');
ALTER TABLE transactions ADD COLUMN is_transfer INTEGER NOT NULL DEFAULT 0
  CHECK (is_transfer IN (0, 1));

-- Verhindert doppelte Buchungen, wenn der Job zweimal fuer dieselbe Periode laeuft.
CREATE UNIQUE INDEX idx_transactions_recurring_period
  ON transactions (recurring_id, period)
  WHERE recurring_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- accounts: Startsaldo. Kontostand = opening_balance + Summe Buchungen ab opening_date.
-- ---------------------------------------------------------------------------
ALTER TABLE accounts ADD COLUMN opening_balance_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN opening_date TEXT
  CHECK (opening_date IS NULL OR opening_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

-- ---------------------------------------------------------------------------
-- balance_checks — Saldo-Abgleich gegen die Realitaet.
-- ---------------------------------------------------------------------------
CREATE TABLE balance_checks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  account_id   INTEGER NOT NULL REFERENCES accounts (id),
  actual_cents INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_balance_checks_account_id ON balance_checks (account_id);

-- ---------------------------------------------------------------------------
-- savings_goal — ein aktives Ziel zur Zeit, Historie bleibt erhalten.
-- Zielaenderung = neuer Eintrag mit neuem active_from, der alte bleibt stehen.
-- Prozentbasis (mode='percent') ist das reguelare Nettogehalt
-- (recurring mit kind='income', ohne Sonderzahlungen) — nicht die
-- Monatssumme aller Einnahmen. Diese Ableitung passiert in der Anwendung,
-- nicht im Schema.
-- ---------------------------------------------------------------------------
CREATE TABLE savings_goal (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  mode                  TEXT NOT NULL CHECK (mode IN ('amount', 'percent')),
  monthly_target_cents  INTEGER,
  target_percent        REAL,
  active_from           TEXT NOT NULL CHECK (active_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (
    (mode = 'amount' AND monthly_target_cents IS NOT NULL AND target_percent IS NULL) OR
    (mode = 'percent' AND target_percent IS NOT NULL AND monthly_target_cents IS NULL)
  )
);

-- ---------------------------------------------------------------------------
-- Kategorienbaum ersetzt den Seed aus 001 vollstaendig.
-- ---------------------------------------------------------------------------
DELETE FROM categories;

INSERT INTO categories (name, parent_id, sort_order) VALUES
  ('Einnahmen', NULL, 10),
  ('Wohnen', NULL, 20),
  ('Lebensmittel', NULL, 30),
  ('Mobilität', NULL, 40),
  ('Persönlich', NULL, 50),
  ('Freizeit', NULL, 60),
  ('Versicherungen', NULL, 70),
  ('Kredite', NULL, 80),
  ('Sonstiges', NULL, 90),
  ('Transfer', NULL, 100);

-- SQLite kennt keine Spalten-Alias-Liste "AS v(name, sort_order)" fuer
-- VALUES-Tabellen — daher die impliziten Namen column1/column2.

INSERT INTO categories (name, parent_id, sort_order)
SELECT v.column1, c.id, v.column2
FROM (VALUES ('Gehalt', 10), ('Sonderzahlung', 20), ('Steuererstattung', 30), ('Sonstiges', 40)) AS v
JOIN categories c ON c.name = 'Einnahmen' AND c.parent_id IS NULL;

INSERT INTO categories (name, parent_id, sort_order)
SELECT v.column1, c.id, v.column2
FROM (VALUES ('Darlehen', 10), ('Strom', 20), ('Nebenkosten', 30), ('Wasser', 40), ('Grundsteuer', 50), ('GEZ', 60)) AS v
JOIN categories c ON c.name = 'Wohnen' AND c.parent_id IS NULL;

INSERT INTO categories (name, parent_id, sort_order)
SELECT v.column1, c.id, v.column2
FROM (VALUES ('Einkauf', 10), ('Essen gehen', 20)) AS v
JOIN categories c ON c.name = 'Lebensmittel' AND c.parent_id IS NULL;

INSERT INTO categories (name, parent_id, sort_order)
SELECT v.column1, c.id, v.column2
FROM (VALUES ('Benzin', 10), ('Kfz-Steuer', 20), ('Kfz-Versicherung', 30), ('Kfz-Instandhaltung', 40), ('ÖPNV', 50)) AS v
JOIN categories c ON c.name = 'Mobilität' AND c.parent_id IS NULL;

INSERT INTO categories (name, parent_id, sort_order)
SELECT v.column1, c.id, v.column2
FROM (VALUES ('Beauty', 10), ('Kleidung', 20), ('Geschenke', 30), ('Handy', 40), ('Mitgliedschaften', 50)) AS v
JOIN categories c ON c.name = 'Persönlich' AND c.parent_id IS NULL;

INSERT INTO categories (name, parent_id, sort_order)
SELECT v.column1, c.id, v.column2
FROM (VALUES ('Feiern', 10), ('Sonstiges', 20)) AS v
JOIN categories c ON c.name = 'Freizeit' AND c.parent_id IS NULL;

INSERT INTO categories (name, parent_id, sort_order)
SELECT v.column1, c.id, v.column2
FROM (VALUES ('Haftpflicht', 10), ('Hausrat', 20), ('BU', 30)) AS v
JOIN categories c ON c.name = 'Versicherungen' AND c.parent_id IS NULL;

INSERT INTO categories (name, parent_id, sort_order)
SELECT v.column1, c.id, v.column2
FROM (VALUES ('Sonstiges', 10)) AS v
JOIN categories c ON c.name = 'Kredite' AND c.parent_id IS NULL;

INSERT INTO categories (name, parent_id, sort_order)
SELECT v.column1, c.id, v.column2
FROM (VALUES ('Nicht erfasst', 10), ('Sonstiges', 20)) AS v
JOIN categories c ON c.name = 'Sonstiges' AND c.parent_id IS NULL;

INSERT INTO categories (name, parent_id, sort_order)
SELECT v.column1, c.id, v.column2
FROM (VALUES ('Sparen', 10)) AS v
JOIN categories c ON c.name = 'Transfer' AND c.parent_id IS NULL;
