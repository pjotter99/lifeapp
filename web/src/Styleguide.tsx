import { useState, type ReactNode } from 'react';
import { Amount, Button, Card, Chip, Input, ProgressBar } from './components';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-text-dim">{title}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Swatch({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {children}
      <span className="text-xs text-text-dim">{label}</span>
    </div>
  );
}

// Forced-state Klassen: bilden die echten hover:/focus-visible:-Styles statisch
// nach, damit man alle Zustaende gleichzeitig sieht statt jeden anfassen zu muessen.
const FORCED_HOVER_SOLID = 'brightness-110';
const FORCED_HOVER_SECONDARY = 'border-accent';
const FORCED_FOCUS = 'outline outline-2 outline-offset-2 outline-accent';

export function Styleguide() {
  const [chipsSelected, setChipsSelected] = useState({ wohnen: false, lebensmittel: true });
  const [inputValue, setInputValue] = useState('');

  return (
    <div className="min-h-svh bg-bg px-4 py-10 text-text sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-14">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Styleguide</h1>
          <p className="text-text-dim">
            Basis-Komponenten in allen Zuständen. Kein Screen — nur die Bausteine, aus denen Screens gebaut werden.
          </p>
        </header>

        <Section title="Typografie">
          <Card className="flex flex-col gap-3">
            <p className="font-sans text-base">Inter Regular — Der frühe Vogel bucht den Wurm.</p>
            <p className="font-sans text-base font-medium">Inter Medium — Der frühe Vogel bucht den Wurm.</p>
            <p className="font-sans text-base font-semibold">Inter Semibold — Der frühe Vogel bucht den Wurm.</p>
            <p className="tabular-amount text-base">JetBrains Mono Regular — 1.234,56 €</p>
            <p className="tabular-amount text-base font-semibold">JetBrains Mono Semibold — 1.234,56 €</p>
          </Card>
        </Section>

        <Section title="Button">
          {(['primary', 'secondary', 'danger'] as const).map((variant) => (
            <Group key={variant} title={variant}>
              <Swatch label="Default">
                <Button variant={variant}>Speichern</Button>
              </Swatch>
              <Swatch label="Hover (erzwungen)">
                <Button variant={variant} className={variant === 'secondary' ? FORCED_HOVER_SECONDARY : FORCED_HOVER_SOLID}>
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
              <Swatch label="Live — hier hovern/tabben">
                <Button variant={variant}>Live testen</Button>
              </Swatch>
            </Group>
          ))}
        </Section>

        <Section title="Karte">
          <div className="flex flex-wrap gap-4">
            <Card>
              <p className="font-medium">Surface</p>
              <p className="text-sm text-text-dim">Standard-Karte, bg-surface.</p>
            </Card>
            <Card surface="surface-2">
              <p className="font-medium">Surface-2</p>
              <p className="text-sm text-text-dim">Erhöhte/verschachtelte Karte, z. B. Karte in Karte.</p>
            </Card>
          </div>
        </Section>

        <Section title="Eingabefeld">
          <Group title="Zustände">
            <Swatch label="Leer">
              <Input placeholder="Betrag" />
            </Swatch>
            <Swatch label="Befüllt">
              <Input defaultValue="12,50" readOnly />
            </Swatch>
            <Swatch label="Fokus (erzwungen)">
              <Input placeholder="Betrag" className={FORCED_FOCUS + ' border-accent'} />
            </Swatch>
            <Swatch label="Deaktiviert">
              <Input placeholder="Betrag" disabled />
            </Swatch>
            <Swatch label="Live — hier tippen">
              <Input placeholder="Betrag" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
            </Swatch>
          </Group>
          <Group title="Mit Label">
            <Input label="Datum" type="date" defaultValue="2026-08-06" />
          </Group>
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
            <Chip
              selected={chipsSelected.wohnen}
              onClick={() => setChipsSelected((s) => ({ ...s, wohnen: !s.wohnen }))}
            >
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

        <Section title="Fortschrittsbalken">
          <div className="flex max-w-sm flex-col gap-5">
            <ProgressBar label="0 % — Sparrate: 0 € / 500 €" value={0} />
            <ProgressBar label="45 % — Sparrate: 225 € / 500 €" value={45} />
            <ProgressBar label="100 % — Sparrate: 500 € / 500 €" value={100} />
            <ProgressBar label="130 % (gedeckelt) — Sparrate: 650 € / 500 €" value={130} />
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
          <Group title="lg (Kontostand-Groesse)">
            <Amount cents={-125000} size="lg" />
            <Amount cents={280000} size="lg" />
          </Group>
        </Section>
      </div>
    </div>
  );
}
