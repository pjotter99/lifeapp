-- 008_accounts_iban.sql
-- IBAN je Konto, damit der CAMT-Import die Datei dem richtigen Konto
-- zuordnen kann. Bewusst kein Pflichtfeld: ist keine hinterlegt, faellt der
-- Import auf die Kontoauswahl in der Vorschau zurueck, statt zu blockieren.
-- Beim ersten Import mit unbekannter IBAN bietet die App an, sie einem Konto
-- zuzuordnen und hier zu speichern.

ALTER TABLE accounts ADD COLUMN iban TEXT;

-- Zwei Konten mit derselben IBAN waeren eine mehrdeutige Zuordnung. Partiell,
-- weil NULL der Normalfall bleibt und beliebig oft vorkommen darf.
CREATE UNIQUE INDEX idx_accounts_iban
  ON accounts (iban)
  WHERE iban IS NOT NULL;
