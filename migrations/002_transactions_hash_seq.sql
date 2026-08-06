-- 002_transactions_hash_seq.sql
-- Korrektur zu 001: identische Buchungen am selben Tag (gleicher
-- source_hash) sind legitim, kein Duplikat. Der reine UNIQUE-Index auf
-- source_hash war zu strikt. hash_seq unterscheidet mehrere Buchungen mit
-- demselben Hash voneinander — beim spaeteren Bank-Import zaehlt man ihn
-- pro echter Wiederholung hoch, statt die zweite Buchung zu verwerfen.

ALTER TABLE transactions ADD COLUMN hash_seq INTEGER NOT NULL DEFAULT 0;

DROP INDEX idx_transactions_source_hash;

CREATE UNIQUE INDEX idx_transactions_source_hash_seq
  ON transactions (source_hash, hash_seq)
  WHERE source_hash IS NOT NULL;
