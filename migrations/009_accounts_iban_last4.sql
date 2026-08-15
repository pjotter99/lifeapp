-- 009_accounts_iban_last4.sql
-- Nur noch die letzten vier Stellen der IBAN speichern statt der vollen.
-- Fuer die Kontozuordnung beim CAMT-Import reicht der Vergleich der letzten
-- vier Stellen vollstaendig; die komplette IBAN ist eine Kontonummer, die
-- ohne Not weder in der Datenbank noch in der Sicherung liegen muss.
--
-- Bewusst eine neue Migration statt einer Aenderung an 008: 008 ist bereits
-- ausgeliefert und angewendet. Eine nachtraeglich geaenderte Migration laeuft
-- auf bestehenden Geraeten nicht erneut — Neuinstallation und Bestandsgeraet
-- haetten dann unterschiedliche Schemata, ohne dass checkSchemaCompatibility
-- das bemerkt (die vergleicht Dateinamen, nicht Struktur).

-- Der Index aus 008 haengt an der alten Spalte und muss vor dem Loeschen weg.
DROP INDEX IF EXISTS idx_accounts_iban;

ALTER TABLE accounts ADD COLUMN iban_last4 TEXT;

-- Bereits gespeicherte vollstaendige IBAN auf die letzten vier Stellen
-- kuerzen. Leerzeichen und Bindestriche vorher entfernen, sonst waeren bei
-- "DE02 1203 0000 0000 2020 51" die letzten vier Zeichen "2051" nur zufaellig
-- richtig — bei anderer Gruppierung stuende ein Leerzeichen darin.
UPDATE accounts
   SET iban_last4 = substr(replace(replace(upper(iban), ' ', ''), '-', ''), -4)
 WHERE iban IS NOT NULL AND trim(iban) <> '';

ALTER TABLE accounts DROP COLUMN iban;

-- Weiterhin eindeutig: zwei Konten mit denselben vier Endziffern waeren beim
-- Import nicht unterscheidbar. Bei vier Stellen ist eine Kollision deutlich
-- wahrscheinlicher als bei einer vollen IBAN — der Index laesst das zweite
-- Konto dann bewusst auflaufen, statt still das falsche zuzuordnen.
CREATE UNIQUE INDEX idx_accounts_iban_last4
  ON accounts (iban_last4)
  WHERE iban_last4 IS NOT NULL;
