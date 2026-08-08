# Umbau: Lokale Datenhaltung statt Server

Ersetzt die bisherige Client/Server-Architektur. Datenmodell, Migrationen,
Geschäftslogik und alle Screens bleiben inhaltlich unverändert — sie ziehen um.

## Warum

Die App soll täglich vom iPhone aus benutzbar sein, auch ohne Netz und ohne dass
irgendwo ein Rechner läuft. Ein Backend erfüllt das nicht.

## Zielarchitektur

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

## Deployment

Der Build ist eine statische Seite. Sie wird auf **GitHub Pages** aus dem
Repository veröffentlicht — kostenlos, HTTPS inklusive, keine laufenden Kosten.

Die App enthält keine Zugangsdaten und keine Daten. Selbst wenn jemand die
Adresse kennt, sieht er nur eine leere App: alle Inhalte liegen ausschließlich
im IndexedDB des jeweiligen Geräts.

## Backup

### Automatisch: GitHub

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

### Manuell: Datei teilen

- Button „Sicherung exportieren" erzeugt eine ZIP-Datei mit DB und CSV.
- Auf iOS über `navigator.share` mit Datei-Anhang, damit „In Dateien sichern"
  und damit iCloud Drive als Ziel erscheint.
- Auf Desktop normaler Download.

### Wiederherstellen

- Import akzeptiert die ZIP oder die einzelne DB-Datei.
- Vor dem Überschreiben eine Sicherung des aktuellen Zustands anlegen.
- Nach dem Import Migrationen laufen lassen, falls die Sicherung älter ist.

### Sichtbarkeit

Auf dem Dashboard eine unauffällige Zeile: Zeitpunkt der letzten erfolgreichen
Sicherung. Liegt sie mehr als 7 Tage zurück, wird die Zeile in `--negative`
eingefärbt. Kein Modal, kein Nag — nur sichtbar.

## Offline

- Service Worker cacht die App-Shell, damit sie ohne Netz startet.
- Ohne Netz funktioniert alles außer dem GitHub-Upload. Der wird nachgeholt,
  sobald wieder Verbindung besteht.

## Was ausdrücklich nicht gebaut wird

- Keine Synchronisation zwischen Geräten. Handy und Desktop sind getrennte
  Datenbestände. Der Desktop dient der Entwicklung, das Handy der Nutzung.
- Keine Verschlüsselung der lokalen Datenbank. Das Gerät ist per Code gesichert,
  das ist die Schutzebene.

## Reihenfolge des Umbaus

1. sql.js einbinden, Migrationen im Browser laufen lassen, Persistenz in
   IndexedDB. Bestehende Screens noch nicht anfassen.
2. Endpunkte einzeln als Funktionen portieren, Screen für Screen umstellen.
   Nach jedem Screen prüfen, dass er unverändert funktioniert.
3. Recurring-Job auf App-Start umstellen, bestehende Tests anpassen.
4. Backup: erst Export und Import von Hand, dann GitHub automatisch.
5. Service Worker und Offline-Fähigkeit.
6. GitHub Pages einrichten.

Nach jedem Punkt committen und prüfen. Nicht mehrere Punkte zusammenfassen.
