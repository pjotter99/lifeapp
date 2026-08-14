import { useState, type ReactNode } from 'react';
import { Amount, Button, Chip, Input, Panel, ProportionLine, Ring } from './components';
import { BottomTabBar } from './BottomTabBar';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="hud-title">// {title}</h2>
      {children}
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="hud-label">{title}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Swatch({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2">
      {children}
      <span className="hud-label">{label}</span>
    </div>
  );
}

const TOKENS = [
  ['--bg', 'Seitenmitte'],
  ['--bg-deep', 'Vignette, Tab-Leiste'],
  ['--surface', 'Panel-Innenfläche'],
  ['--surface-2', 'erhöht, aktiv'],
  ['--border', 'Rahmen 1px'],
  ['--border-lit', 'Rahmen aktiv'],
  ['--accent', 'Struktur, Ringe'],
  ['--accent-dim', 'Eckwinkel'],
  ['--text', 'Text'],
  ['--text-dim', 'Sekundär'],
  ['--text-mono', 'Sektionstitel'],
  ['--positive', 'Zugang'],
  ['--negative', 'Abgang'],
  ['--warn', 'Warnung'],
] as const;

// Forced-state Klassen: bilden die echten hover:/focus-visible:-Styles statisch
// nach, damit man alle Zustaende gleichzeitig sieht statt jeden anfassen zu muessen.
const FORCED_HOVER_PRIMARY = 'bg-accent/20';
const FORCED_HOVER_SECONDARY = 'border-border-lit text-text';
const FORCED_HOVER_DANGER = 'bg-negative/20';
const FORCED_FOCUS = 'outline outline-2 outline-offset-2 outline-accent';

export function Styleguide() {
  const [chipsSelected, setChipsSelected] = useState({ wohnen: false, lebensmittel: true });
  const [inputValue, setInputValue] = useState('');

  return (
    <div
      className="min-h-svh px-4 py-10 text-text sm:px-8"
      style={{ paddingBottom: 'calc(var(--tabbar-height) + env(safe-area-inset-bottom) + 2.5rem)' }}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-14">
        <header className="flex flex-col gap-1">
          <h1 className="hud-page-title">Styleguide</h1>
          <p className="text-text-dim">
            Basis-Komponenten im HUD-Stil, in allen Zuständen. Kein Screen — nur die Bausteine, aus denen Screens gebaut
            werden.
          </p>
        </header>

        <Section title="Tokens">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {TOKENS.map(([name, use]) => (
              <div key={name} className="flex items-center gap-3">
                <span
                  className="h-9 w-9 shrink-0 rounded-control border border-border"
                  style={{ backgroundColor: `var(${name})` }}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-xs text-text">{name}</span>
                  <span className="truncate text-xs text-text-dim">{use}</span>
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typografie">
          <Panel className="flex flex-col gap-3">
            <p className="font-sans text-base">Inter Regular — Fließtext und Eingabefelder.</p>
            <p className="font-sans text-base font-medium">Inter Medium — Der frühe Vogel bucht den Wurm.</p>
            <p className="hud-title">// SEKTIONSTITEL — Mono, Versalien, 11px</p>
            <p className="hud-label">Label — Mono, Versalien, 10px</p>
            <p className="tabular-amount text-base">JetBrains Mono — 1.234,56 €</p>
          </Panel>
        </Section>

        <Section title="Panel">
          <div className="flex flex-col gap-4">
            <Panel title="Kontostand" status="14.08.2026" className="flex flex-col gap-2">
              <Amount cents={284531} size="md" />
              <p className="text-sm text-text-dim">Mit Titel und Statuszusatz. Eckwinkel an allen vier Ecken.</p>
            </Panel>

            <Panel className="flex flex-col gap-1">
              <p className="font-medium">Ohne Titel</p>
              <p className="text-sm text-text-dim">Grund --surface. Kinder sitzen direkt im Rahmen.</p>
            </Panel>

            <Panel surface="surface-2" className="flex flex-col gap-1">
              <p className="font-medium">Surface-2</p>
              <p className="text-sm text-text-dim">Erhöht, für aktive Zustände. Nicht als Panel im Panel verwenden.</p>
            </Panel>

            <Panel lit title="Aktiv" className="flex flex-col gap-1">
              <p className="text-sm text-text-dim">Rahmen in --border-lit statt --border.</p>
            </Panel>
          </div>
        </Section>

        <Section title="Listeneinträge">
          {/* Keine eigene Komponente, sondern ein Muster: border-l-2 in der
              Statusfarbe, border-t ab dem zweiten Eintrag. Genauso in
              /erfassen, /stammdaten und auf dem Dashboard. */}
          <Panel title="Buchungen">
            <ul className="flex flex-col">
              {[
                { label: 'Rewe', cents: -3412, stripe: 'border-l-negative' },
                { label: 'Gehalt', cents: 284000, stripe: 'border-l-positive' },
                { label: 'Sparen', cents: -50000, stripe: 'border-l-accent-dim' },
              ].map((row, i) => (
                <li
                  key={row.label}
                  className={`flex items-center gap-3 border-l-2 py-3 pl-3 ${row.stripe} ${
                    i > 0 ? 'border-t border-t-border' : ''
                  }`}
                >
                  <span className="hud-label w-12 shrink-0">14.08.</span>
                  <span className="flex-1 truncate text-sm">{row.label}</span>
                  <Amount cents={row.cents} size="sm" />
                </li>
              ))}
            </ul>
          </Panel>
        </Section>

        <Section title="Button">
          {(['primary', 'secondary', 'danger'] as const).map((variant) => {
            const forcedHover =
              variant === 'primary' ? FORCED_HOVER_PRIMARY : variant === 'danger' ? FORCED_HOVER_DANGER : FORCED_HOVER_SECONDARY;
            return (
              <Group key={variant} title={variant}>
                <Swatch label="Default">
                  <Button variant={variant}>Speichern</Button>
                </Swatch>
                <Swatch label="Hover (erzwungen)">
                  <Button variant={variant} className={forcedHover}>
                    Speichern
                  </Button>
                </Swatch>
                <Swatch label="Fokus (erzwungen)">
                  <Button variant={variant} className={FORCED_FOCUS}>
                    Speichern
                  </Button>
                </Swatch>
                <Swatch label="Deaktiviert">
                  <Button variant={variant} disabled>
                    Speichern
                  </Button>
                </Swatch>
                <Swatch label="Live — hovern/tabben">
                  <Button variant={variant}>Live testen</Button>
                </Swatch>
              </Group>
            );
          })}
        </Section>

        <Section title="Auswahl-Chip">
          <Group title="Zustände">
            <Swatch label="Unselektiert">
              <Chip>Wohnen</Chip>
            </Swatch>
            <Swatch label="Selektiert">
              <Chip selected>Lebensmittel</Chip>
            </Swatch>
            <Swatch label="Hover (erzwungen)">
              <Chip className={FORCED_HOVER_SECONDARY}>Mobilität</Chip>
            </Swatch>
            <Swatch label="Fokus (erzwungen)">
              <Chip className={FORCED_FOCUS}>Freizeit</Chip>
            </Swatch>
            <Swatch label="Deaktiviert">
              <Chip disabled>Sonstiges</Chip>
            </Swatch>
          </Group>
          <Group title="Live — hier antippen">
            <Chip selected={chipsSelected.wohnen} onClick={() => setChipsSelected((s) => ({ ...s, wohnen: !s.wohnen }))}>
              Wohnen
            </Chip>
            <Chip
              selected={chipsSelected.lebensmittel}
              onClick={() => setChipsSelected((s) => ({ ...s, lebensmittel: !s.lebensmittel }))}
            >
              Lebensmittel
            </Chip>
          </Group>
        </Section>

        <Section title="Eingabefeld">
          <Group title="Zustände">
            <Swatch label="Leer">
              <Input placeholder="Betrag" fieldWidth="auto" />
            </Swatch>
            <Swatch label="Befüllt">
              <Input defaultValue="12,50" fieldWidth="auto" readOnly />
            </Swatch>
            <Swatch label="Fokus (erzwungen)">
              <Input placeholder="Betrag" fieldWidth="auto" className={FORCED_FOCUS + ' border-accent'} />
            </Swatch>
            <Swatch label="Deaktiviert">
              <Input placeholder="Betrag" fieldWidth="auto" disabled />
            </Swatch>
            <Swatch label="Live — hier tippen">
              <Input placeholder="Betrag" fieldWidth="auto" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
            </Swatch>
          </Group>
          <Group title="Mit Label">
            <Input label="Datum" type="date" defaultValue="2026-08-14" fieldWidth="auto" />
          </Group>
          <Group title="Groß (Betragserfassung)">
            <Input fieldSize="lg" defaultValue="12,50" inputMode="decimal" readOnly />
          </Group>
        </Section>

        <Section title="Ring">
          <div className="flex flex-wrap items-end gap-8">
            <Ring value={0} label="Sparrate 0 / 500 €" size={140}>
              <Amount cents={0} size="md" />
            </Ring>
            <Ring value={45} label="Sparrate 225 / 500 €" size={140}>
              <Amount cents={22500} size="md" />
            </Ring>
            <Ring value={100} label="Sparrate 500 / 500 €" size={140}>
              <Amount cents={50000} size="md" />
            </Ring>
          </div>
          {/* 300px, weil ein sechsstelliger Betrag in 44px Mono rund 260px
              breit ist und in einen kleineren Ring nicht hineinpasst. */}
          <Group title="Kontostand-Größe (44px, Dashboard)">
            <Ring value={68} label="Kontostand" size={300}>
              <Amount cents={284531} size="lg" />
            </Ring>
          </Group>
        </Section>

        <Section title="Proportionslinie">
          <p className="text-sm text-text-dim">
            Größenverhältnisse als Haarlinie. Fortschritt gegen ein Ziel ist etwas anderes und wird als Ring dargestellt.
          </p>
          <div className="flex max-w-sm flex-col gap-5">
            <ProportionLine label="42 % — Wohnen" value={42} color="hsl(183 65% 68%)" />
            <ProportionLine label="27 % — Lebensmittel" value={27} color="hsl(219 65% 68%)" />
            <ProportionLine label="8 % — Mobilität" value={8} color="hsl(255 65% 68%)" />
            <ProportionLine label="100 % (ohne Farbe, --accent)" value={100} />
          </div>
        </Section>

        <Section title="Betragsanzeige">
          <Group title="sm">
            <Amount cents={-1250} size="sm" />
            <Amount cents={99999} size="sm" />
            <Amount cents={0} size="sm" />
          </Group>
          <Group title="md">
            <Amount cents={-125000} size="md" />
            <Amount cents={280000} size="md" />
            <Amount cents={0} size="md" />
          </Group>
          <Group title="lg (Kontostand-Größe)">
            <Amount cents={-125000} size="lg" />
            <Amount cents={280000} size="lg" />
          </Group>
        </Section>

        <Section title="Tab-Leiste">
          <p className="text-sm text-text-dim">
            Am unteren Rand dieser Seite, echte Komponente. „Erfassen“ ist hier fest als aktiv gesetzt, damit beide
            Zustände sichtbar sind.
          </p>
        </Section>
      </div>

      <BottomTabBar activeRoute="/erfassen" />
    </div>
  );
}
