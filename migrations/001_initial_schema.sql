-- 001_initial_schema.sql
-- Grundschema laut CLAUDE.md: accounts, categories, transactions, recurring,
-- networth_positions, networth_snapshots, scenarios. Plus Kategorien-Startset.
--
-- Regeln, die sich im Schema niederschlagen:
--   - Geld immer INTEGER (Cent), nie REAL.
--   - Datum immer TEXT im Format YYYY-MM-DD (CHECK statt Vertrauen).
--   - Jede Buchung: source + source_hash, auch wenn aktuell nur 'manual'.
--   - category_locked schuetzt manuelle Kategorisierung vor Automatismen.

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name   TEXT NOT NULL,
  type   TEXT NOT NULL CHECK (type IN ('giro', 'tagesgeld', 'depot', 'bar', 'kreditkarte')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

-- ---------------------------------------------------------------------------
-- categories — zweistufig: Oberkategorie (parent_id NULL) + Unterkategorie.
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  parent_id  INTEGER REFERENCES categories (id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
);

CREATE INDEX idx_categories_parent_id ON categories (parent_id);

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  date           TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_cents   INTEGER NOT NULL,
  category_id    INTEGER REFERENCES categories (id),
  account_id     INTEGER REFERENCES accounts (id),
  payee          TEXT,
  note           TEXT,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'camt')),
  source_hash    TEXT,
  category_locked INTEGER NOT NULL DEFAULT 0 CHECK (category_locked IN (0, 1)),
  recurring_id   INTEGER REFERENCES recurring (id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_transactions_date ON transactions (date);
CREATE INDEX idx_transactions_category_id ON transactions (category_id);
CREATE INDEX idx_transactions_account_id ON transactions (account_id);
CREATE INDEX idx_transactions_recurring_id ON transactions (recurring_id);

-- Verhindert doppelten Import derselben Buchung (Bank-Import kommt spaeter,
-- das Modell muss aber jetzt schon dafuer stehen).
CREATE UNIQUE INDEX idx_transactions_source_hash
  ON transactions (source_hash)
  WHERE source_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- recurring — Fixkosten und Abos sind dieselbe Tabelle.
-- ---------------------------------------------------------------------------
CREATE TABLE recurring (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,
  category_id        INTEGER REFERENCES categories (id),
  account_id         INTEGER REFERENCES accounts (id),
  interval           TEXT NOT NULL CHECK (interval IN ('monthly', 'quarterly', 'yearly')),
  next_due           TEXT NOT NULL CHECK (next_due GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  contract_end       TEXT CHECK (contract_end IS NULL OR contract_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  notice_period_days INTEGER,
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  note               TEXT
);

CREATE INDEX idx_recurring_active ON recurring (active);

-- ---------------------------------------------------------------------------
-- networth_positions
-- ---------------------------------------------------------------------------
CREATE TABLE networth_positions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('asset', 'liability')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
);

-- ---------------------------------------------------------------------------
-- networth_snapshots — ein Wert pro Position pro Monat.
-- ---------------------------------------------------------------------------
CREATE TABLE networth_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  position_id INTEGER NOT NULL REFERENCES networth_positions (id),
  value_cents INTEGER NOT NULL,
  UNIQUE (month, position_id)
);

CREATE INDEX idx_networth_snapshots_position_id ON networth_snapshots (position_id);

-- ---------------------------------------------------------------------------
-- scenarios — Parameter fuer den Rentenrechner, mehrere parallel.
-- ---------------------------------------------------------------------------
CREATE TABLE scenarios (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  name                    TEXT NOT NULL,
  current_age             INTEGER NOT NULL,
  retirement_age          INTEGER NOT NULL,
  life_expectancy         INTEGER NOT NULL,
  start_capital_cents     INTEGER NOT NULL,
  monthly_savings_cents   INTEGER NOT NULL,
  nominal_return_pct      REAL NOT NULL,
  inflation_pct           REAL NOT NULL,
  statutory_pension_cents INTEGER,
  pension_start_age       INTEGER
);

-- ---------------------------------------------------------------------------
-- Kategorien-Startset (Oberkategorien laut CLAUDE.md).
-- Unterkategorien bewusst schlank gehalten — koennen spaeter von Hand
-- ergaenzt werden, hier geht es nur um ein sinnvolles Startset.
-- ---------------------------------------------------------------------------
INSERT INTO categories (name, parent_id, sort_order) VALUES ('Wohnen', NULL, 10);
INSERT INTO categories (name, parent_id, sort_order) VALUES ('Lebensmittel', NULL, 20);
INSERT INTO categories (name, parent_id, sort_order) VALUES ('Shopping', NULL, 30);
INSERT INTO categories (name, parent_id, sort_order) VALUES ('Mobilität', NULL, 40);
INSERT INTO categories (name, parent_id, sort_order) VALUES ('Freizeit/Feiern', NULL, 50);
INSERT INTO categories (name, parent_id, sort_order) VALUES ('Gesundheit', NULL, 60);
INSERT INTO categories (name, parent_id, sort_order) VALUES ('Versicherungen', NULL, 70);
INSERT INTO categories (name, parent_id, sort_order) VALUES ('Abos', NULL, 80);
INSERT INTO categories (name, parent_id, sort_order) VALUES ('Sonstiges', NULL, 90);
INSERT INTO categories (name, parent_id, sort_order) VALUES ('Einnahmen', NULL, 100);
