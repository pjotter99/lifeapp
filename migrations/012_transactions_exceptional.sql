-- 012_transactions_exceptional.sql
-- Kennzeichen fuer aussergewoehnliche Ausgaben: Waschmaschine, Autoreparatur,
-- Zahnarzt, Urlaub.
--
-- Sie gehoeren in die Monatsauswertung — das Geld ist ja abgeflossen — aber
-- nicht in eine Hochrechnung des Monatsdurchschnitts, weil sie sich nicht
-- wiederholen. Ohne das Kennzeichen zieht eine einzelne Autoreparatur den
-- Schnitt so weit hoch, dass die Zahl nichts mehr aussagt.

ALTER TABLE transactions ADD COLUMN is_exceptional INTEGER NOT NULL DEFAULT 0
  CHECK (is_exceptional IN (0, 1));

-- Die spaetere Hochrechnung filtert darueber; der Index spart bei wachsender
-- Tabelle den vollen Scan.
CREATE INDEX idx_transactions_exceptional ON transactions (is_exceptional);
