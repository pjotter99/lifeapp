# Projekt: Persönliche Finanz- und Lebens-App

Einzelnutzer-App. Läuft lokal. Keine fremde Cloud, keine Analytics, keine externen
Requests außer explizit definierten.

## Stack

- Frontend: React + Vite + TypeScript, Tailwind
- Backend: Node + Fastify + TypeScript
- DB: SQLite (Datei `data/app.db`), Zugriff über better-sqlite3
- Migrationen: nummerierte SQL-Dateien in `migrations/`, keine ORM-Automagie
- PWA: manifest + Service Worker, damit iOS "Zum Home-Bildschirm" funktioniert

## Harte Regeln — nicht verhandelbar

1. **Geld ist immer `INTEGER` in Cent.** Niemals Float, niemals `REAL`. Formatierung
   erst im UI.
2. **Vorzeichen:** Ausgaben negativ, Einnahmen positiv. Konsistent überall.
3. **Datum:** ISO-8601-String `YYYY-MM-DD`. Kein Timestamp, wo ein Datum reicht.
4. **Jede Buchung hat ein `source`-Feld** (`manual` | `csv` | `camt`) und ein
   `source_hash` (nullable). Auch wenn es aktuell nur `manual` gibt — der
   Bank-Import kommt später und darf das Modell nicht brechen.
5. **`category_locked`-Flag pro Buchung.** Was ich von Hand kategorisiert habe,
   darf kein späterer Automatismus überschreiben.
6. Keine Auth, kein Login, keine Nutzerverwaltung. Ein Mensch, ein Gerät.
7. Alle Beträge in EUR. Keine Mehrwährungslogik.

## Datenmodell

### accounts
Konten und Depots. Rein organisatorisch, kein Saldo-Tracking auf Buchungsebene.
```
id, name, type ('giro'|'tagesgeld'|'depot'|'bar'|'kreditkarte'), active
```

### categories
Zweistufig: Oberkategorie + Unterkategorie. Nicht tiefer.
```
id, name, parent_id (nullable), sort_order, archived
```
Startset: Wohnen, Lebensmittel, Shopping, Mobilität, Freizeit/Feiern,
Gesundheit, Versicherungen, Abos, Sonstiges, Einnahmen.

### transactions
```
id, date, amount_cents, category_id, account_id, payee, note,
source, source_hash, category_locked, recurring_id (nullable), created_at
```
`recurring_id` gesetzt = diese Buchung stammt aus einem Fixkosten-Eintrag.

### recurring
**Fixkosten und Abos sind dieselbe Tabelle.** Ein Abo ist ein Fixkosten-Eintrag
mit Kündigungsfrist. Nicht zwei Konzepte bauen.

**`recurring` ist reine Referenzliste zur Berechnung der monatlichen
Grundlast (und `cancel_by`) — sie erzeugt keine Buchungen.** Kein
automatischer Job, der aus einem `recurring`-Eintrag eine `transactions`-Zeile
macht. Wenn eine tatsächliche Buchung zu einem Fixkosten-Posten gehört, wird
sie regulär in `transactions` erfasst und optional per `recurring_id`
verknüpft.
```
id, name, amount_cents, category_id, account_id,
interval ('monthly'|'quarterly'|'yearly'), next_due,
contract_end (nullable), notice_period_days (nullable),
active, note
```
Abgeleitet, nicht gespeichert:
- monatliche Grundlast = Summe aller aktiven, auf Monat normalisiert
- `cancel_by` = `contract_end` minus `notice_period_days`

### networth_positions
```
id, name, kind ('asset'|'liability'), sort_order, archived
```

### networth_snapshots
Ein Wert pro Position pro Monat. Von Hand erfasst.
```
id, month ('YYYY-MM'), position_id, value_cents
```
Netto-Vermögen = Summe assets minus Summe liabilities pro Monat.

### scenarios
Parameter für den Rentenrechner. Mehrere Szenarien parallel.
```
id, name, current_age, retirement_age, life_expectancy,
start_capital_cents, monthly_savings_cents,
nominal_return_pct, inflation_pct,
statutory_pension_cents (nullable), pension_start_age
```

## Rentenrechner — inhaltliche Vorgaben

- **In heutiger Kaufkraft rechnen.** Realrendite = (1+nominal)/(1+inflation)-1.
  Keine Nominalbeträge im UI anzeigen, die suggerieren Genauigkeit, die nicht
  existiert.
- **Die Lücke zwischen Rentenbeginn (60) und gesetzlichem Renteneintritt ist der
  kritische Teil** und muss vollständig aus eigenem Kapital gedeckt werden.
  Diese Phase separat ausweisen, nicht in einer Gesamtzahl verstecken.
- Immer **drei Szenarien nebeneinander** darstellen (pessimistisch / realistisch /
  optimistisch), nie eine Einzelzahl.
- Ausgabe: Kapitalverlauf als Kurve + "Kapital reicht bis Alter X".
- Steuern und Krankenversicherung im Ruhestand sind bewusst **nicht** modelliert.
  Das im UI hinschreiben, nicht stillschweigend weglassen.

## UI-Prinzipien

- **Ausgabe erfassen muss in zwei Taps gehen.** Betrag + Kategorie, alles andere
  optional mit Defaults (heute, Standardkonto). Wenn das umständlich wird, wird
  die App nicht benutzt. Dieser Screen hat Vorrang vor allem anderen.
- Mobile first. Der Desktop ist der Zweitfall.
- Keine Modals für Kernfunktionen.

## Reihenfolge (nicht vorgreifen)

1. Migrationen, DB-Setup, Kategorien-Seed
2. Ausgabenerfassung + Liste + Monatsübersicht
3. Fixkosten/Abos inkl. Kündigungswarnung
4. Netto-Vermögen (Erfassung + Kurve)
5. Rentenrechner
6. Dashboard
7. Erst danach: Kalender, Bank-Import

Keine Features vorbauen, die in dieser Liste weiter unten stehen.

## Arbeitsweise

- Kleine Commits, ein Thema pro Commit.
- Keine Abhängigkeit hinzufügen ohne kurze Begründung im Commit.
- Bei Unklarheit im Modell: nachfragen statt raten.
