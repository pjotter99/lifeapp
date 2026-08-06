-- 003_accounts_seed.sql
-- Startkonto fuer die Ausgabenerfassung. Solange genau ein aktives Konto
-- existiert, braucht die Erfassung kein Konto-Auswahlfeld — die Buchung
-- geht automatisch hierauf.

INSERT INTO accounts (name, type, active) VALUES ('Girokonto', 'giro', 1);
