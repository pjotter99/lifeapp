-- 006_recurring_start_date.sql
-- Startdatum fuer wiederkehrende Posten: der Job bucht ab diesem Datum,
-- nicht ab dem Anlagedatum des Eintrags. day_of_month wird daraus
-- abgeleitet (Tag-Anteil von start_date), nicht mehr eigenstaendig vom
-- Client gesetzt — vermeidet, dass beide auseinanderlaufen koennen.

ALTER TABLE recurring ADD COLUMN start_date TEXT
  CHECK (start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

-- Fuer eventuell schon vorhandene Eintraege: next_due war bisher der
-- effektive Start, also entspricht das dem bisherigen Verhalten.
UPDATE recurring SET start_date = next_due WHERE start_date IS NULL;
