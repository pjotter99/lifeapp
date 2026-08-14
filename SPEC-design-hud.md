# Design-Überarbeitung: HUD-Stil

Ersetzt den Design-Abschnitt in CLAUDE.md. Screens, Logik und Datenmodell bleiben
unverändert — nur Tokens und Komponenten werden neu gefasst.

## Grundidee

Technisches Interface statt App-Oberfläche: Panels mit Eckwinkeln statt gefüllter
Karten, Konturen statt Flächen, Monospace-Versalien als Sektionstitel, sehr
dunkler blaustichiger Grund, schwach leuchtende Ränder.

Das Vorbild sind Desktop-Dashboards mit vielen Panels nebeneinander. Auf dem
Handy gibt es eine Spalte. Deshalb wird der Stil übernommen, aber nicht die
Dichte: weniger Rahmen, größere Abstände, keine verschachtelten Panels.

## Tokens

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

**Farbe trägt weiter Bedeutung.** Cyan ist Struktur und Interface, nicht Inhalt.
Beträge bleiben grün und rot — das ist die wichtigste Information der App und
darf nicht im Akzentton verschwinden.

## Panel statt Karte

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

## Listeneinträge

- Links ein 2px breiter vertikaler Farbstrich als Statusmarkierung:
  `--negative` für Ausgaben, `--positive` für Einnahmen, `--accent-dim` für
  Transfers.
- Kein eigener Rahmen um jeden Eintrag — nur der Strich und eine 1px-Trennlinie
  in `--border` zwischen den Einträgen. Verschachtelte Rahmen wirken auf einer
  schmalen Spalte unruhig.

## Zahlen

- Alle Beträge Monospace, `tabular-nums`, deutsches Format.
- Kontostand im Dashboard: 44px, Monospace, umgeben von einem dünnen Ring in
  `--accent` (2px, SVG-Kreis), der als Fortschrittsbogen dient. Zahl in der
  Mitte, Beschriftung darunter in Monospace-Versalien, 10px.
- Sparfortschritt ebenfalls als Ring, nicht als Balken.

## Schrift

- Monospace (JetBrains Mono) für: Sektionstitel, alle Zahlen, Beschriftungen,
  Statusangaben. Das ist der prägende Stilträger.
- Inter nur für Fließtext und Eingabefelder.
- Sektionstitel und Labels durchgehend in Versalien mit weitem Buchstabenabstand.

## Buttons und Chips

- Rechteckig, Radius 3px, transparenter Grund, 1px Rahmen.
- Inaktiv: Rahmen `--border`, Text `--text-dim`
- Aktiv/gewählt: Rahmen `--accent`, Text `--accent`, Grund `--surface-2`
- Primärer Button: Grund `--accent` bei 12% Deckkraft, Rahmen `--accent`,
  Text `--accent`. Keine gefüllte Farbfläche.
- Beschriftung in Monospace-Versalien.

## Tab-Leiste

- Grund `--bg-deep`, Oberkante 1px `--border`
- Beschriftungen Monospace-Versalien, 10px
- Aktiver Tab: Text `--accent`, darüber ein 2px-Strich in `--accent` über die
  Breite des Tabs
- Bleibt bei geöffneter Tastatur ausgeblendet, wie bisher

## Hintergrund

- Radiale Vignette von `--bg` in der Mitte zu `--bg-deep` an den Rändern.
- Kein Hexraster, keine Scanlinien, keine Partikel. Auf einem Handybildschirm
  konkurriert das mit dem Inhalt und kostet Akkulaufzeit.

## Bewegung

- Panels blenden beim Erscheinen über 200ms ein, leicht von unten (8px).
  Gestaffelt mit 40ms Versatz pro Panel.
- Ringe zeichnen sich beim ersten Erscheinen über 600ms auf ihren Wert.
- Sonst keine Animation. Kein Pulsieren, kein Glühen, keine Dauerbewegung.
- `prefers-reduced-motion` schaltet alles davon ab.

## Was ausdrücklich nicht gebaut wird

- Keine Knoten-/Sternkarten-Navigation. Auf einer Handyspalte unbedienbar.
- Kein Glow-Effekt auf Text. Beeinträchtigt die Lesbarkeit von Zahlen.
- Keine mehrspaltigen Panel-Raster. Eine Spalte, untereinander.
