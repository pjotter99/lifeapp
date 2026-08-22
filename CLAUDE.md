# Projekt: Persönliche Finanz- und Lebens-App

Einzelnutzer-App. Läuft lokal. Keine fremde Cloud, keine Analytics, keine externen
Requests außer explizit definierten.

## Stack

**Seit „Umbau: Lokale Datenhaltung statt Server" (weiter unten) ersetzt —
reine Frontend-App, kein Backend-Server mehr.** Der Umbau läuft schrittweise
(siehe „Reihenfolge des Umbaus"); bis ein Screen umgestellt ist, läuft er
weiter gegen den alten Fastify-Server.

- Frontend: React + Vite + TypeScript, Tailwind
- SQLite läuft über sql.js (WASM) direkt im Browser. Die Datenbankdatei wird
  als Blob in IndexedDB abgelegt — kein Server, kein laufender Prozess.
- Migrationen: dieselben nummerierten SQL-Dateien in `migrations/` wie bisher,
  keine ORM-Automagie. Laufen beim App-Start im Browser statt beim Serverstart.
- `server/` bleibt im Repository (Migrationsdateien werden von dort
  weiterverwendet, ins Frontend eingebunden), wird aber nicht mehr gestartet.
- Deployment: statische Seite auf GitHub Pages.
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
source, source_hash, category_locked, recurring_id (nullable), created_at,
is_exceptional
```
`recurring_id` gesetzt = diese Buchung stammt aus einem Fixkosten-Eintrag.

**`is_exceptional`** kennzeichnet einmalige Ausgaben: Waschmaschine,
Autoreparatur, Zahnarzt, Urlaub. Setzbar beim Erfassen und nachträglich im
Nachkategorisieren-Screen (dort über „Auch kategorisierte" auch an längst
zugeordneten Buchungen).

In der Monatsauswertung **eingeblendet, aber markiert** — das Geld ist
abgeflossen, es gehört in die Summe. Getrennt ausgewiesen als „davon
außergewöhnlich". Die Hochrechnung schließt sie später standardmäßig aus:
eine einzelne Autoreparatur zieht den Monatsdurchschnitt sonst so weit hoch,
dass die Zahl nichts mehr aussagt.

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

### category_rules
Leiten beim Bank-Import aus dem Empfänger (`payee`) eine Kategorie ab.
```
id, pattern, match_type ('contains'|'exact'), category_id, priority, created_at
```
**Die Regel schlägt vor, sie entscheidet nicht:** der Import setzt
`category_id`, lässt `category_locked` aber auf 0. Ein Fehlgriff ist damit im
Nachkategorisieren-Screen korrigierbar, und die Korrektur sperrt die Buchung
anschließend gegen weitere Automatik (harte Regel 5).

Bei mehreren Treffern gewinnt die höchste `priority`, bei Gleichstand das
längere (spezifischere) `pattern`, zuletzt die kleinere `id` — sonst hinge das
Ergebnis von der Zeilenreihenfolge ab. Groß-/Kleinschreibung ist egal.

Zusammengeführte Fixkostenbuchungen bleiben ausgenommen; sie bringen ihre
Kategorie aus dem `recurring`-Eintrag mit.

### Fremdschlüssel

**Fremdschlüssel werden durchgesetzt.** SQLite hat sie per Default aus; ohne
Einschalten sind die `REFERENCES` im Schema reine Dokumentation. `PRAGMA
foreign_keys = ON` steht deshalb in `enableForeignKeys()` (`data/integrity.ts`)
und wird an jeder Stelle aufgerufen, an der eine Verbindung entsteht.

Beim App-Start läuft einmal `PRAGMA foreign_key_check` (in `getReadyDb`, nach
den Migrationen). Fremdschlüssel greifen nur bei Schreibzugriffen — was vor
dem Einschalten kaputtging, fällt sonst nie auf. Ein Fund hält die App nicht
an, erscheint aber als Banner über jedem Screen: eine Buchung mit einer
Kategorie-ID, die es nicht gibt, taucht in keiner Auswertung auf und zählt
trotzdem im Kontostand mit.

Drei Randbedingungen, die beim Ändern zu beachten sind:

- **Das Pragma hängt an der Verbindung, nicht an der Datei.** Jede frisch
  geöffnete Datenbank steht wieder auf 0 — auch eine importierte Sicherung in
  `openDatabaseFromBytes`. Wer eine neue Verbindung aufmacht, muss es setzen.
- **In einer offenen Transaktion ist es wirkungslos.** SQLite ignoriert es
  dort stillschweigend. Es gehört direkt hinter das Öffnen, nicht in
  `runMigrations` — das arbeitet je Migration in `BEGIN`/`COMMIT`.
- **`DELETE FROM categories` in Migration 004 funktioniert nur ohne
  `WHERE`-Klausel.** `categories.parent_id` verweist auf dieselbe Tabelle. Ein
  vollständiges DELETE lässt SQLite durch, ein eingeschränktes würde einen
  Elternsatz löschen, auf den ein Kind noch zeigt, und mit „FOREIGN KEY
  constraint failed" scheitern. Wer die Zeile einschränkt, bricht die
  Migration.

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
  hat und jede Buchung eine Unterkategorie braucht. Ein Umschalter Ausgabe/
  Einnahme/Transfer über dem Kategoriegitter (Ausgabe ist Standard) filtert
  die Oberkategorien auf die gewählte Art — im ueblichen Ausgaben-Fall sieht
  man nur die acht Ausgaben-Oberkategorien statt aller zehn, das haelt den
  dritten Tap so klein wie moeglich, ersetzt aber nicht die Notwendigkeit.
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
- **Neue Spalte `recurring.start_date` (Migration 006).** Der Job bucht ab
  diesem Datum, nicht ab dem Anlagedatum des Eintrags. `day_of_month` wird
  aus `start_date` abgeleitet (Tag-Anteil), nicht mehr eigenständig gesetzt —
  im Formular gibt es dafür kein eigenes Feld mehr. Liegt `start_date` in der
  Vergangenheit, holt der Job die Perioden nach; `accounts.opening_date`
  bleibt die untere Grenze, davor wird trotzdem nicht gebucht.
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

### Kategorienbaum (Migration 004 ersetzt den Seed aus 001, Migration 005 ergänzt Bargeld,
Migration 007 ergänzt Online Shopping, Migration 010 benennt um und ergänzt
Kantine/Mittag)

```
Einnahmen        Gehalt · Sonderzahlung · Steuererstattung · Sonstiges
Wohnen           Darlehen · Strom · Nebenkosten · Wasser ·
                 Grundsteuer · GEZ
Lebensmittel     Einkauf · Essen gehen · Kantine/Mittag
Mobilität        Benzin · Kfz-Steuer · Kfz-Versicherung ·
                 Kfz-Instandhaltung · ÖPNV
Persönlich       Beauty · Kleidung & Schuhe · Geschenke · Handy ·
                 Mitgliedschaften · Anschaffungen
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

**"Anschaffungen" statt "Online Shopping".** Der Kanal, über den gekauft
wird, ist keine Ausgabenart — sonst steht in der Auswertung ein Sammelposten
ohne Aussage. Gemeint sind Kabel, Kleinkram, Haushalt, Technik. Aus demselben
Grund gilt:

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

### Design — HUD-Stil

Technisches Interface statt App-Oberfläche: Panels mit Eckwinkeln statt
gefüllter Karten, Konturen statt Flächen, Monospace-Versalien als
Sektionstitel, sehr dunkler blaustichiger Grund, schwach leuchtende Ränder.

Das Vorbild sind Desktop-Dashboards mit vielen Panels nebeneinander. Auf dem
Handy gibt es eine Spalte. Deshalb wird der Stil übernommen, aber nicht die
Dichte: weniger Rahmen, größere Abstände, keine verschachtelten Panels.

#### Tokens

```
--bg          #070B10   fast schwarz, deutlich blaustichig
--bg-deep     #04060A   Vignette an den Rändern
--surface     #0C1219   Panel-Innenfläche
--surface-2   #121A24   erhöhte Elemente, aktive Zustände
--border      #1B2733   Panel-Rahmen, 1px
--border-lit  #2E4A5C   Rahmen aktiver/fokussierter Panels
--accent      #4DD8E0   Cyan — Struktur, Rahmenwinkel, aktive Zustände, Ringe
--accent-dim  #1F5C63   gedämpftes Cyan für inaktive Ränder
--text        #D6E4EC   leicht kühl statt reinweiß
--text-dim    #6B8494   Labels, Sekundärinfo
--text-mono   #8FA9B8   Monospace-Sektionstitel
--positive    #4ADE80   Zugang
--negative    #F87171   Abgang
--warn        #E8A33D   Warnung, Priorität
```

**Farbe trägt weiter Bedeutung.** Cyan ist Struktur und Interface, nicht
Inhalt. Beträge bleiben grün und rot — das ist die wichtigste Information der
App und darf nicht im Akzentton verschwinden.

#### Panel statt Karte

Die zentrale Komponente. Ersetzt `Card`.

- Hintergrund `--surface`, Rahmen 1px `--border`, Radius 4px (nicht 14px —
  der Stil ist kantig)
- **Eckwinkel**: an allen vier Ecken kurze L-förmige Striche in `--accent-dim`,
  etwa 12px lang, 1px stark, mit ~6px Abstand zum Panelrand. Umgesetzt über
  Pseudo-Elemente oder ein SVG-Overlay, nicht als vier zusätzliche divs.
- **Titel**: `// BEZEICHNUNG` in Monospace, Versalien, `--text-mono`,
  Buchstabenabstand 0.12em, Größe 11px. Der doppelte Schrägstrich gehört dazu.
- Optionaler Statuszusatz rechts oben in derselben Zeile, `--text-dim`.
- Kein Schatten. Tiefe entsteht durch Rahmen und Flächenhelligkeit.

#### Listeneinträge

- Links ein 2px breiter vertikaler Farbstrich als Statusmarkierung:
  `--negative` für Ausgaben, `--positive` für Einnahmen, `--accent-dim` für
  Transfers.
- Kein eigener Rahmen um jeden Eintrag — nur der Strich und eine
  1px-Trennlinie in `--border` zwischen den Einträgen. Verschachtelte Rahmen
  wirken auf einer schmalen Spalte unruhig.

#### Zahlen

- Alle Beträge Monospace, `tabular-nums`, deutsches Format: `1.234,56 €`.
- Kontostand im Dashboard: 44px, Monospace, umgeben von einem dünnen Ring in
  `--accent` (2px, SVG-Kreis), der als Fortschrittsbogen dient. Zahl in der
  Mitte, Beschriftung darunter in Monospace-Versalien, 10px.
- Sparfortschritt ebenfalls als Ring, nicht als Balken.

#### Schrift

- Monospace (JetBrains Mono) für: Sektionstitel, alle Zahlen, Beschriftungen,
  Statusangaben. Das ist der prägende Stilträger.
- Inter nur für Fließtext und Eingabefelder.
- Sektionstitel und Labels durchgehend in Versalien mit weitem
  Buchstabenabstand.

#### Buttons und Chips

- Rechteckig, Radius 3px, transparenter Grund, 1px Rahmen.
- Inaktiv: Rahmen `--border`, Text `--text-dim`
- Aktiv/gewählt: Rahmen `--accent`, Text `--accent`, Grund `--surface-2`
- Primärer Button: Grund `--accent` bei 12% Deckkraft, Rahmen `--accent`,
  Text `--accent`. Keine gefüllte Farbfläche.
- Beschriftung in Monospace-Versalien.
- Touch-Ziele mindestens 44px.

#### Tab-Leiste

- Grund `--bg-deep`, Oberkante 1px `--border`
- Beschriftungen Monospace-Versalien, 10px
- Aktiver Tab: Text `--accent`, darüber ein 2px-Strich in `--accent` über die
  Breite des Tabs
- Bleibt bei geöffneter Tastatur ausgeblendet, wie bisher

#### Hintergrund

- Radiale Vignette von `--bg` in der Mitte zu `--bg-deep` an den Rändern.
- Kein Hexraster, keine Scanlinien, keine Partikel. Auf einem Handybildschirm
  konkurriert das mit dem Inhalt und kostet Akkulaufzeit.

#### Bewegung

- Panels blenden beim Erscheinen über 200ms ein, leicht von unten (8px).
  Gestaffelt mit 40ms Versatz pro Panel.
- Ringe zeichnen sich beim ersten Erscheinen über 600ms auf ihren Wert.
- Sonst keine Animation. Kein Pulsieren, kein Glühen, keine Dauerbewegung.
- `prefers-reduced-motion` schaltet alles davon ab. Sichtbarer Tastaturfokus
  bleibt Pflicht.

#### Was ausdrücklich nicht gebaut wird

- Keine Knoten-/Sternkarten-Navigation. Auf einer Handyspalte unbedienbar.
- Kein Glow-Effekt auf Text. Beeinträchtigt die Lesbarkeit von Zahlen.
- Keine mehrspaltigen Panel-Raster. Eine Spalte, untereinander.

## Umbau: Lokale Datenhaltung statt Server

Ersetzt die bisherige Client/Server-Architektur. Datenmodell, Migrationen,
Geschäftslogik und alle Screens bleiben inhaltlich unverändert — sie ziehen um.

### Warum

Die App soll täglich vom iPhone aus benutzbar sein, auch ohne Netz und ohne dass
irgendwo ein Rechner läuft. Ein Backend erfüllt das nicht.

### Zielarchitektur

- Reine Frontend-App, keine laufenden Server-Prozesse.
- SQLite läuft über **sql.js** oder **wa-sqlite** direkt im Browser (WASM).
  Die Datenbankdatei wird als Blob in **IndexedDB** abgelegt.
- Grund für SQLite statt reinem IndexedDB: Migrationen 001–006, alle Queries,
  CHECK-Constraints und der Recurring-Job existieren bereits als SQL. Die bleiben
  dadurch nahezu unverändert. Ein Umbau auf IndexedDB-Objektspeicher würde die
  gesamte Logik neu schreiben.
- Der Fastify-Server entfällt. Jeder bisherige Endpunkt wird zu einer Funktion in
  `web/src/data/`, die dieselben Argumente nimmt und dasselbe Ergebnis liefert.
  Die Screens rufen statt `fetch('/api/...')` diese Funktionen auf.
- Der Recurring-Job läuft beim App-Start im Browser, nicht mehr zeitgesteuert.
  Beim Öffnen prüfen, ob seit dem letzten Lauf Perioden fällig geworden sind.
  Die bestehende Nachhol-Logik über `next_due` funktioniert dafür unverändert.
- Nach jeder schreibenden Operation wird die Datenbank in IndexedDB persistiert.
  Nicht bei jeder Query — nur bei Änderungen.
- Das `server/`-Verzeichnis bleibt im Repository, wird aber nicht mehr gestartet.
  Die Migrationsdateien werden von dort weiterverwendet und beim Build in das
  Frontend eingebunden.

### Deployment

Der Build ist eine statische Seite. Sie wird auf **GitHub Pages** aus dem
Repository veröffentlicht — kostenlos, HTTPS inklusive, keine laufenden Kosten.

Die App enthält keine Zugangsdaten und keine Daten. Selbst wenn jemand die
Adresse kennt, sieht er nur eine leere App: alle Inhalte liegen ausschließlich
im IndexedDB des jeweiligen Geräts.

### Backup

#### Automatisch: GitHub

- In den Einstellungen hinterlegt der Nutzer einen Fine-grained Personal Access
  Token mit Schreibrechten auf genau ein privates Repository.
- Nach jeder Änderung, frühestens aber alle 15 Minuten, schreibt die App zwei
  Dateien über die GitHub Contents API:
  - `backup/db.sqlite.b64` — die Datenbankdatei
  - `backup/transactions.csv` — alle Buchungen mit Datum, Betrag, Ober- und
    Unterkategorie, Konto, Notiz
- Der CSV-Export ist Pflicht, nicht optional: eine SQLite-Datei ist ohne diese
  App nicht lesbar, eine CSV in zehn Jahren noch.
- Schlägt der Upload fehl, wird das in der App sichtbar gemacht — ein stiller
  Fehlschlag ist schlimmer als kein Backup.
- Der Token wird in IndexedDB gespeichert, nicht in localStorage, und nie
  geloggt oder in Fehlermeldungen ausgegeben.

#### Manuell: Datei teilen

- Button „Sicherung exportieren" erzeugt eine ZIP-Datei mit DB und CSV.
- Auf iOS über `navigator.share` mit Datei-Anhang, damit „In Dateien sichern"
  und damit iCloud Drive als Ziel erscheint.
- Auf Desktop normaler Download.

#### Selbsterklärende Sicherung

Die ZIP enthält zusätzlich `LIESMICH.txt`: Erstellungsdatum, App-Version,
Schema-Version, eine Inhaltsübersicht (Zeitraum, Anzahl Buchungen je Tabelle)
und eine kurze Anleitung, wie man die Daten auch ohne diese App liest.

Die CSV enthält alle Buchungen mit Klarnamen der Kategorien (Ober- und
Unterkategorie), nicht mit IDs — lesbar, auch wenn die Datenbank selbst
irgendwann nicht mehr zu öffnen ist.

#### Wiederherstellen

Import akzeptiert die ZIP, die einzelne `.sqlite`-Datei oder die CSV.

Ablauf:
1. Datei prüfen (Format, lesbar).
2. Schema-Version lesen.
3. Inhalt im Voraus anzeigen — Zeitraum, Anzahl Buchungen, Summen — bevor
   irgendetwas übernommen wird.
4. Erst nach Bestätigung durch den Nutzer übernehmen.

Vor dem Überschreiben automatisch den aktuellen Zustand sichern, danach
Rückgängig anbieten.

Ist die Sicherung älter als das aktuelle Schema, laufen die fehlenden
Migrationen automatisch nach. Ist sie neuer (Schema-Version höher als die der
laufenden App), wird der Import mit klarer Meldung abgelehnt — kein stiller
Downgrade-Versuch.

#### Sichtbarkeit

Auf dem Dashboard eine unauffällige Zeile: Zeitpunkt der letzten erfolgreichen
Sicherung. Liegt sie mehr als 7 Tage zurück, wird die Zeile in `--negative`
eingefärbt. Kein Modal, kein Nag — nur sichtbar.

#### Erinnerung

Die App merkt sich den Zeitpunkt des letzten manuellen Exports. Liegt er mehr
als 90 Tage zurück oder gab es nie einen, erscheint beim Start eine Karte auf
dem Dashboard mit direktem Export-Knopf. Wegklickbar, dann für 7 Tage nicht
wieder.

Keine Push-Benachrichtigung — auf iOS für PWAs unzuverlässig.

### Offline

- Service Worker cacht die App-Shell, damit sie ohne Netz startet.
- Ohne Netz funktioniert alles außer dem GitHub-Upload. Der wird nachgeholt,
  sobald wieder Verbindung besteht.

### Was ausdrücklich nicht gebaut wird

- Keine Synchronisation zwischen Geräten. Handy und Desktop sind getrennte
  Datenbestände. Der Desktop dient der Entwicklung, das Handy der Nutzung.
- Keine Verschlüsselung der lokalen Datenbank. Das Gerät ist per Code gesichert,
  das ist die Schutzebene.

### Reihenfolge des Umbaus

1. sql.js einbinden, Migrationen im Browser laufen lassen, Persistenz in
   IndexedDB. Bestehende Screens noch nicht anfassen.
2. Endpunkte einzeln als Funktionen portieren, Screen für Screen umstellen.
   Nach jedem Screen prüfen, dass er unverändert funktioniert.
3. Recurring-Job auf App-Start umstellen, bestehende Tests anpassen.
4. Backup: erst Export und Import von Hand, dann GitHub automatisch.
5. Service Worker und Offline-Fähigkeit.
6. GitHub Pages einrichten.

Nach jedem Punkt committen und prüfen. Nicht mehrere Punkte zusammenfassen.

### Aktueller Stand

Umbau auf lokale Datenhaltung (sql.js + IndexedDB, kein Server) abgeschlossen.
App läuft live auf GitHub Pages unter `/lifeapp/`. Migrationen bis 007.
Letzte Korrekturrunde (Details-Notiz, Tastatur/Tab-Leiste, Kategorieauswahl
Ausgabe/Einnahme/Transfer, Stammdaten Beendete-Filter/Löschen, Auswertung
Mehrfach-Aufklappen, Feldbreiten) erledigt.

Umstellung auf den HUD-Stil abgeschlossen: Tokens, Basis-Komponenten und alle
Screens. Komponenten sind `Amount`, `Button`, `Chip`, `Input`, `Panel`,
`ProportionLine`, `Ring` — `Card` und `ProgressBar` sind ersatzlos entfernt.
`/styleguide` zeigt alle Komponenten in allen Zuständen. Die Begründungen
hinter den Tokens stehen in `SPEC-design-hud.md`; bindend ist der
Design-Abschnitt oben.

Offen:
- Saldo-Abgleich gegen die Realität (`balance_checks`, siehe „Erweiterung")
- Netto-Vermögen (Erfassung + Kurve)
- Rentenrechner
- Bearbeiten-Funktion für bestehende Buchungen (aktuell nur anlegen/löschen)

## Arbeitsweise

- Kleine Commits, ein Thema pro Commit.
- Keine Abhängigkeit hinzufügen ohne kurze Begründung im Commit.
- Bei Unklarheit im Modell: nachfragen statt raten.
