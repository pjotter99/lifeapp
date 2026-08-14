/**
 * CAMT.052-Parser (Bank to Customer Account Report) — reine Umwandlung von
 * XML in Buchungskandidaten, ohne DB-Bezug.
 *
 * Der XML-Parser kommt als Parameter herein: im Browser der native
 * DOMParser, in den Tests @xmldom/xmldom (Node hat keinen). Dieselbe
 * Zuordnungslogik laeuft damit in beiden Faellen — nur der Tokenizer
 * unterscheidet sich, und beide sprechen dieselbe DOM-Schnittstelle.
 * Gleiches Muster wie DatabaseOpener in backup.ts.
 */

/**
 * Nur die Ausschnitte der DOM-Schnittstelle, die dieser Parser braucht —
 * absichtlich strukturell statt lib.dom's Element/Document: die Testdatei
 * laeuft unter der Node-tsconfig ohne DOM-Typen, und xmldom's Typen sind
 * nicht identisch mit denen des Browsers. Beide erfuellen dieses Minimum.
 */
export interface XmlElement {
  readonly textContent: string | null;
  getAttribute(name: string): string | null;
  getElementsByTagNameNS(namespace: string, localName: string): ArrayLike<XmlElement>;
}

export interface XmlDocument {
  readonly documentElement: XmlElement | null;
  getElementsByTagNameNS(namespace: string, localName: string): ArrayLike<XmlElement>;
}

export type XmlParser = (xml: string) => XmlDocument;

export interface CamtEntry {
  /** Buchungsdatum YYYY-MM-DD. */
  date: string;
  /** Vorzeichenbehaftet: Ausgaben negativ, Einnahmen positiv (CLAUDE.md). */
  amount_cents: number;
  payee: string | null;
  note: string | null;
  /** Referenz der Bank, falls die Datei eine brauchbare liefert. */
  bank_ref: string | null;
  source_hash: string;
}

export interface CamtParseResult {
  entries: CamtEntry[];
  /** IBAN des Kontos aus dem Report-Kopf, falls angegeben. */
  iban: string | null;
  /** Uebersprungene, noch nicht final gebuchte Eintraege (Sts != BOOK). */
  skippedPending: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// SEPA-Platzhalter: taucht in unzaehligen Auszuegen an jeder Buchung auf und
// ist als Referenz damit wertlos.
const PLACEHOLDER_REFS = new Set(['NOTPROVIDED', 'NICHT ANGEGEBEN', 'NV']);

/**
 * Sucht ueber den lokalen Namen statt ueber den qualifizierten. CAMT-Dateien
 * kommen mal mit Default-Namespace (<Ntry>), mal mit Praefix (<ns2:Ntry>);
 * getElementsByTagName('Ntry') findet den zweiten Fall nicht.
 */
function tags(scope: XmlElement | XmlDocument, local: string): XmlElement[] {
  return Array.from(scope.getElementsByTagNameNS('*', local));
}

function firstTag(scope: XmlElement | XmlDocument, local: string): XmlElement | undefined {
  return tags(scope, local)[0];
}

function text(scope: XmlElement | XmlDocument | undefined, local: string): string | null {
  if (!scope) return null;
  const value = firstTag(scope, local)?.textContent?.trim();
  return value ? value : null;
}

/**
 * Betrag als Dezimalstring in Cent — ohne parseFloat. CLAUDE.md verlangt Geld
 * ausdruecklich ohne Float; "1234.56" * 100 ergibt in IEEE-754
 * 123455.99999999999, und bei laengeren Nachkommastellen faengt auch
 * Math.round das nicht mehr zuverlaessig ab.
 */
export function parseAmountToCents(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Betrag nicht lesbar: "${raw}"`);
  }
  const [whole, fraction = ''] = trimmed.split('.') as [string, string?];
  if (fraction.length > 2 && /[^0]/.test(fraction.slice(2))) {
    throw new Error(`Betrag hat mehr als zwei Nachkommastellen: "${raw}"`);
  }
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}

/**
 * Stabiler Hash aus den fachlichen Merkmalen einer Buchung — nur noetig, wenn
 * die Bank keine brauchbare Referenz mitschickt. Bewusst synchron und ohne
 * Crypto-API (die ist asynchron und hier ueberdimensioniert): der Hash muss
 * nicht faelschungssicher sein, nur stabil und kollisionsarm genug, um
 * dieselbe Zeile bei einem zweiten Import wiederzuerkennen. Zwei echt gleiche
 * Zahlungen am selben Tag faengt ohnehin hash_seq ab, nicht der Hash.
 */
export function fingerprint(parts: (string | number | null)[]): string {
  const input = parts.map((p) => (p === null ? '' : String(p))).join('|');
  // FNV-1a, 32 Bit, als Hex — deterministisch ueber Browser und Node.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `f${hash.toString(16).padStart(8, '0')}`;
}

function usableRef(value: string | null): string | null {
  if (value === null) return null;
  return PLACEHOLDER_REFS.has(value.toUpperCase()) ? null : value;
}

// Status steht je nach CAMT-Version als Text (<Sts>BOOK</Sts>) oder
// verschachtelt (<Sts><Cd>BOOK</Cd></Sts>).
function entryStatus(entry: XmlElement): string | null {
  const sts = firstTag(entry, 'Sts');
  if (!sts) return null;
  return text(sts, 'Cd') ?? (sts.textContent?.trim() || null);
}

// Buchungsdatum vor Wertstellung: fuer den Kontostand zaehlt, wann die Bank
// gebucht hat. Manche Banken liefern DtTm statt Dt.
function bookingDate(entry: XmlElement): string | null {
  for (const local of ['BookgDt', 'ValDt']) {
    const node = firstTag(entry, local);
    if (!node) continue;
    const value = text(node, 'Dt') ?? text(node, 'DtTm');
    if (value) return value.slice(0, 10);
  }
  return null;
}

/**
 * Gegenpartei: bei einer Ausgabe der Empfaenger (Cdtr), bei einer Einnahme
 * der Zahler (Dbtr). Andersherum stuende bei jeder Ausgabe der eigene Name.
 */
function counterparty(scope: XmlElement, isCredit: boolean): string | null {
  const party = firstTag(scope, isCredit ? 'Dbtr' : 'Cdtr');
  return party ? text(party, 'Nm') : null;
}

// Verwendungszweck steht als eine oder mehrere <Ustrd>-Zeilen.
function remittance(scope: XmlElement): string | null {
  const parts = tags(scope, 'Ustrd')
    .map((el) => el.textContent?.trim() ?? '')
    .filter((s) => s.length > 0);
  return parts.length ? parts.join(' ') : null;
}

export function parseCamt052(xml: string, parseXml: XmlParser): CamtParseResult {
  const doc = parseXml(xml);

  if (tags(doc, 'parsererror').length > 0 || doc.documentElement === null) {
    throw new Error('Datei ist kein gueltiges XML.');
  }
  if (tags(doc, 'BkToCstmrAcctRpt').length === 0) {
    throw new Error('Keine CAMT.052-Datei: <BkToCstmrAcctRpt> fehlt.');
  }

  const iban = text(firstTag(doc, 'Acct'), 'IBAN');

  const entries: CamtEntry[] = [];
  let skippedPending = 0;

  for (const entry of tags(doc, 'Ntry')) {
    // Nur endgueltig gebuchte Eintraege. Vorgemerkte (PDNG) aendern sich noch
    // und kaemen beim naechsten Import ein zweites Mal — dann mit anderem
    // Betrag und damit anderem Hash, also als zusaetzliche Buchung.
    const status = entryStatus(entry);
    if (status !== null && status !== 'BOOK') {
      skippedPending += 1;
      continue;
    }

    const amountEl = firstTag(entry, 'Amt');
    if (!amountEl?.textContent) {
      throw new Error('Eintrag ohne <Amt>.');
    }
    const currency = amountEl.getAttribute('Ccy');
    if (currency !== null && currency !== 'EUR') {
      throw new Error(`Nur EUR wird unterstuetzt, Datei enthaelt ${currency}.`);
    }

    const indicator = text(entry, 'CdtDbtInd');
    if (indicator !== 'CRDT' && indicator !== 'DBIT') {
      throw new Error(`Unbekannter Credit-Debit-Indikator: ${indicator ?? 'fehlt'}`);
    }
    const isCredit = indicator === 'CRDT';

    const date = bookingDate(entry);
    if (date === null || !DATE_RE.test(date)) {
      throw new Error(`Eintrag ohne lesbares Buchungsdatum (${date ?? 'fehlt'}).`);
    }

    const entryMagnitude = parseAmountToCents(amountEl.textContent);

    // Ein Ntry kann mehrere TxDtls enthalten (Sammelbuchung). Dann zaehlt
    // jede Einzeltransaktion, sonst der Eintrag selbst.
    const details = tags(entry, 'TxDtls');
    const scopes: XmlElement[] = details.length > 0 ? details : [entry];
    const isBatch = details.length > 1;

    for (const scope of scopes) {
      const scopeAmount = scope === entry ? null : firstTag(scope, 'Amt')?.textContent;
      const magnitude = scopeAmount ? parseAmountToCents(scopeAmount) : entryMagnitude;
      const amount_cents = isCredit ? magnitude : -magnitude;

      const payee = counterparty(scope, isCredit);
      const note = remittance(scope);

      // AcctSvcrRef steht am Ntry und ist bei einer Sammelbuchung fuer alle
      // Teile identisch — als Referenz je Teilbuchung deshalb unbrauchbar.
      const scopeRef = usableRef(text(scope, 'TxId')) ?? usableRef(text(scope, 'EndToEndId'));
      const bank_ref = scopeRef ?? (isBatch ? null : usableRef(text(entry, 'AcctSvcrRef')));

      entries.push({
        date,
        amount_cents,
        payee,
        note,
        bank_ref,
        // Bank-Referenz bevorzugt: sie ist pro Buchung eindeutig. Der
        // abgeleitete Hash kann bei zwei gleichen Zahlungen am selben Tag
        // kollidieren — genau dafuer gibt es hash_seq.
        source_hash: bank_ref ?? fingerprint([date, amount_cents, payee, note]),
      });
    }
  }

  return { entries, iban, skippedPending };
}
