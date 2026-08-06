# Erweiterung — an CLAUDE.md anhängen

Ersetzt die bisherige Regel "`recurring` ist reine Referenzliste".

## Grundprinzip

Kein Bank-Import. Der Kontostand wird aus einem manuell gesetzten Startsaldo
plus allen Buchungen fortgeschrieben. Wiederkehrende Posten (Gehalt, Fixkosten,
Sparrate) erzeugen automatisch Buchungen. Alles andere erfasst der Nutzer von Hand.

## Modelländerungen (Migration 003)

### recurring erzeugt jetzt Buchungen

- Neue Spalte `recurring.kind` — `'income' | 'expense' | 'transfer'`
- Neue Spalte `recurring.day_of_month` (1–28; höhere Werte vermeiden wegen Februar)
- Ein Job beim Serverstart und danach einmal täglich legt fällige Buchungen an.
- **Idempotenz zwingend:** `transactions.period TEXT` (`'YYYY-MM'`) plus
  `UNIQUE(recurring_id, period) WHERE recurring_id IS NOT NULL`.
  Ohne das legt jeder Serverstart die Miete erneut an.
- Nie in die Zukunft buchen. Nur Perioden, deren Stichtag erreicht ist.
- `recurring.active = 0` beendet die Serie ab sofort; bereits erzeugte
  Buchungen bleiben unberührt. Das ist der Abo-Kündigen-Mechanismus.

### Transfers sind keine Ausgaben

- Neue Spalte `transactions.is_transfer INTEGER DEFAULT 0`
- Transfers verändern den Kontostand, zählen aber **nicht** in
  Ausgabenauswertungen, Kategorie-Charts oder Budgetvergleiche.
- Die Sparrate ist ein Transfer, keine Ausgabe.

### Saldo-Abgleich gegen die Realität

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

### Sparziel

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

### Startsaldo

`accounts.opening_balance_cents` und `accounts.opening_date`.
Kontostand = opening_balance + Summe aller Buchungen ab opening_date.

## Kategorienbaum (Migration 003 ersetzt den Seed aus 001)

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
Sonstiges        Nicht erfasst · Sonstiges
Transfer         Sparen
```

**"Abos" ist keine Kategorie.** Ein Abo ist ein `recurring`-Eintrag und trägt die
Kategorie seines Inhalts (Netflix → Freizeit, Fitnessstudio → Mitgliedschaften).
Sonst zeigt die Auswertung einen Sammelposten ohne Aussage.

Kfz-Versicherung steht bewusst unter Mobilität, nicht unter Versicherungen —
die Frage lautet "was kostet mich das Auto", nicht "was kosten mich Policen".

## Dashboard

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

## Kategorie-Ansicht

Eigene Seite, nicht ins Dashboard quetschen.
- Monatswähler
- Donut oder horizontales Balkendiagramm über Oberkategorien
- Klick auf eine Oberkategorie klappt die Unterkategorien auf
- Klick auf eine Unterkategorie zeigt die Einzelbuchungen
- Transfers sind ausgeschlossen

## Design

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
