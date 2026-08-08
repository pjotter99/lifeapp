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
Startset: siehe „Kategorienbaum" unter „Erweiterung" weiter unten (ersetzt in
Migration 004 den ursprünglichen Seed aus Migration 001).

### transactions
```
id, date, amount_cents, category_id, account_id, payee, note,
source, source_hash, category_locked, recurring_id (nullable), created_at
```
`recurring_id` gesetzt = diese Buchung stammt aus einem Fixkosten-Eintrag.

### recurring
**Fixkosten und Abos sind dieselbe Tabelle.** Ein Abo ist ein Fixkosten-Eintrag
mit Kündigungsfrist. Nicht zwei Konzepte bauen.

**Seit der Erweiterung (siehe „Erweiterung: Wiederkehrende Buchungen,
Transfers, Saldo, Sparziel" weiter unten) erzeugt `recurring` automatisch
Buchungen** — ein täglicher Job legt fällige Buchungen an. Die alte Regel
„reine Referenzliste, erzeugt keine Buchungen" ist damit hinfällig.
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

  **Bekannte Abweichung:** Die Kategorie-Auswahl ist real dreistufig (Betrag →
  Oberkategorie → Unterkategorie), weil das Datenmodell zweistufige Kategorien
  hat und jede Buchung eine Unterkategorie braucht. Die „Häufig"-Zeile über dem
  Kategoriegitter (die fünf meistgenutzten Unterkategorien der letzten 60 Tage,
  ein Tap speichert direkt) ist der Schnellweg, der die zwei Taps für die
  üblichen Fälle wiederherstellt. Ist die Historie leer, entfällt die Zeile.
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

## Erweiterung: Wiederkehrende Buchungen, Transfers, Saldo, Sparziel

### Grundprinzip

Kein Bank-Import. Der Kontostand wird aus einem manuell gesetzten Startsaldo
plus allen Buchungen fortgeschrieben. Wiederkehrende Posten (Gehalt, Fixkosten,
Sparrate) erzeugen automatisch Buchungen. Alles andere erfasst der Nutzer von Hand.

### Modelländerungen (Migration 004)

#### recurring erzeugt jetzt Buchungen

- Neue Spalte `recurring.kind` — `'income' | 'expense' | 'transfer'`
- Neue Spalte `recurring.day_of_month` (1–28; höhere Werte vermeiden wegen Februar)
- Ein Job beim Serverstart und danach einmal täglich legt fällige Buchungen an.
- **Idempotenz zwingend:** `transactions.period TEXT` (`'YYYY-MM'`) plus
  `UNIQUE(recurring_id, period) WHERE recurring_id IS NOT NULL`.
  Ohne das legt jeder Serverstart die Miete erneut an.
- Nie in die Zukunft buchen. Nur Perioden, deren Stichtag erreicht ist.
- `recurring.active = 0` beendet die Serie ab sofort; bereits erzeugte
  Buchungen bleiben unberührt. Das ist der Abo-Kündigen-Mechanismus.

#### Transfers sind keine Ausgaben

- Neue Spalte `transactions.is_transfer INTEGER DEFAULT 0`
- Transfers verändern den Kontostand, zählen aber **nicht** in
  Ausgabenauswertungen, Kategorie-Charts oder Budgetvergleiche.
- Die Sparrate ist ein Transfer, keine Ausgabe.

#### Saldo-Abgleich gegen die Realität

Der berechnete Kontostand driftet zwangsläufig vom echten ab, weil kleine
Ausgaben vergessen werden. Ohne Abgleich verliert der Nutzer nach wenigen
Monaten das Vertrauen in die Zahl und hört auf, die App zu benutzen.

Neue Tabelle:
```
balance_checks   id, date, account_id, actual_cents, created_at
```
Ablauf: Nutzer trägt den echten Kontostand ein. Die App bildet die Differenz zum
berechneten Stand und legt eine Buchung in der Kategorie
`Sonstiges > Nicht erfasst` an. Danach stimmen beide Werte exakt überein.

Diese Differenz ist eine eigene Kennzahl und wird im Dashboard angezeigt
("Nicht erfasst diesen Monat"). Sie ist kein Fehler, sondern Information.

#### Sparziel

Neue Tabelle:
```
savings_goal     id, mode ('amount'|'percent'), monthly_target_cents (nullable),
                 target_percent (nullable REAL), active_from
```
Je nach `mode` ist genau eines von `monthly_target_cents` / `target_percent`
gesetzt, das andere `NULL` — per CHECK erzwungen.

Prozentbasis (`mode='percent'`) ist das **reguläre Nettogehalt** — die
`recurring`-Einträge mit `kind='income'`, ohne Sonderzahlungen — nicht die
Monatssumme aller Einnahmen. Diese Ableitung passiert in der Anwendung, nicht
im Schema.

Ein aktives Ziel zur Zeit. Historie bleibt erhalten: eine Zieländerung ist ein
neuer Eintrag mit neuem `active_from`, der alte Eintrag bleibt unverändert
stehen.

#### Startsaldo

`accounts.opening_balance_cents` und `accounts.opening_date`.
Kontostand = opening_balance + Summe aller Buchungen ab opening_date.

### Kategorienbaum (Migration 004 ersetzt den Seed aus 001, Migration 005 ergänzt Bargeld)

```
Einnahmen        Gehalt · Sonderzahlung · Steuererstattung · Sonstiges
Wohnen           Darlehen · Strom · Nebenkosten · Wasser ·
                 Grundsteuer · GEZ
Lebensmittel     Einkauf · Essen gehen
Mobilität        Benzin · Kfz-Steuer · Kfz-Versicherung ·
                 Kfz-Instandhaltung · ÖPNV
Persönlich       Beauty · Kleidung · Geschenke · Handy ·
                 Mitgliedschaften
Freizeit         Feiern · Sonstiges
Versicherungen   Haftpflicht · Hausrat · BU
Kredite          Sonstiges
Sonstiges        Nicht erfasst · Sonstiges · Bargeld
Transfer         Sparen
```

Bargeld ist eine normale Ausgabe (Bargeldabhebung), kein Transfer —
`is_transfer` bleibt 0, obwohl auch hier Geld zwischen "Konten" (Giro → Bar)
wandert. Anders als bei Sparen wird die Bar-Seite hier nicht als eigenes Konto
geführt, deshalb zählt die Abhebung als Ausgabe.

**"Abos" ist keine Kategorie.** Ein Abo ist ein `recurring`-Eintrag und trägt die
Kategorie seines Inhalts (Netflix → Freizeit, Fitnessstudio → Mitgliedschaften).
Sonst zeigt die Auswertung einen Sammelposten ohne Aussage.

Kfz-Versicherung steht bewusst unter Mobilität, nicht unter Versicherungen —
die Frage lautet "was kostet mich das Auto", nicht "was kosten mich Policen".

### Dashboard

Drei Zahlen, in dieser Hierarchie:

1. **Kontostand jetzt** — groß, die Hauptzahl.
2. **Verfügbar bis Monatsende** — Kontostand minus noch anstehende Fixkosten
   des laufenden Monats minus noch fehlende Sparrate. Das ist die Zahl, nach der
   tatsächlich entschieden wird.
3. **Sparrate: erreicht / Ziel** — als schlichter Fortschrittsbalken.

Darunter, kleiner:
- Anstehende Fixkosten als Liste mit Datum und Betrag, chronologisch
- Ausgaben diesen Monat, Summe
- Nicht erfasst diesen Monat

Keine Zahl ohne Zeitbezug. "Ausgaben" allein ist mehrdeutig, "Ausgaben August"
nicht.

### Kategorie-Ansicht

Eigene Seite, nicht ins Dashboard quetschen.
- Monatswähler
- Donut oder horizontales Balkendiagramm über Oberkategorien
- Klick auf eine Oberkategorie klappt die Unterkategorien auf
- Klick auf eine Unterkategorie zeigt die Einzelbuchungen
- Transfers sind ausgeschlossen

### Design

Dunkel, ruhig, Zahlen im Vordergrund. Kein Neon, keine Glow-Effekte, keine
Verläufe als Dekoration. Farbe trägt Bedeutung: grün heißt Zugang, rot heißt
Abgang, alles andere ist neutral grau.

```
--bg          #15171B   Seitenhintergrund, warmes Dunkelgrau statt Schwarz
--surface     #1D2026   Karten
--surface-2   #24282F   erhöhte Elemente, Hover
--border      #2A2E37   Hairlines, 1px
--text        #E8EAED
--text-dim    #8B929E   Labels, Sekundärinfo
--positive    #4ADE80   Zugang
--negative    #F87171   Abgang
--accent      #7C8CF8   aktive Zustände, Fokus, Fortschritt
```

- Radius 14px durchgehend, 20px bei Karten
- Kein Schlagschatten. Ebenen werden durch Flächenhelligkeit unterschieden.
- Schrift: **Inter** für Text, **JetBrains Mono** für alle Beträge
- Alle Beträge mit `font-variant-numeric: tabular-nums`, damit Zahlen
  untereinander bündig stehen. Das ist der Detailunterschied zwischen
  "Bastelprojekt" und "Produkt".
- Deutsche Zahlenformatierung: `1.234,56 €`
- Kontostand im Dashboard groß (48–56px), Mono, tabular
- Touch-Ziele mindestens 44px
- Übergänge maximal 150ms, nur auf Farbe und Hintergrund. Keine
  Einblend-Animationen bei Seitenwechseln.
- `prefers-reduced-motion` respektieren, sichtbarer Tastaturfokus

## Arbeitsweise

- Kleine Commits, ein Thema pro Commit.
- Keine Abhängigkeit hinzufügen ohne kurze Begründung im Commit.
- Bei Unklarheit im Modell: nachfragen statt raten.
