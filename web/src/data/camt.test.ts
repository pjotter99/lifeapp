import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { fingerprint, parseAmountToCents, parseCamt052, type XmlDocument, type XmlParser } from './camt.ts';

// Node hat keinen DOMParser; im Browser wird der native uebergeben.
const parseXml: XmlParser = (xml) => new DOMParser().parseFromString(xml, 'application/xml') as unknown as XmlDocument;

function camt(entriesXml: string, opts: { iban?: string | null } = {}): string {
  const iban = opts.iban === undefined ? 'DE02120300000000202051' : opts.iban;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.052.001.02">
  <BkToCstmrAcctRpt>
    <Rpt>
      <Acct>${iban === null ? '' : `<Id><IBAN>${iban}</IBAN></Id>`}</Acct>
      ${entriesXml}
    </Rpt>
  </BkToCstmrAcctRpt>
</Document>`;
}

function entry(body: string): string {
  return `<Ntry>${body}</Ntry>`;
}

// --- parseAmountToCents ----------------------------------------------------

test('parseAmountToCents wandelt Dezimalstrings verlustfrei in Cent', () => {
  assert.equal(parseAmountToCents('1234.56'), 123456);
  assert.equal(parseAmountToCents('0.01'), 1);
  assert.equal(parseAmountToCents('100'), 10000);
  assert.equal(parseAmountToCents('100.5'), 10050);
  assert.equal(parseAmountToCents(' 12.30 '), 1230);
});

// Der Grund, warum hier nicht ueber Float gerechnet wird: bei diesen
// Betraegen ist x * 100 keine ganze Zahl. Math.round faengt genau diese
// Faelle noch ab, aber CLAUDE.md verlangt Geld ausdruecklich ohne Float, und
// die Umrechnung ueber den String ist exakt statt nur meistens richtig.
test('parseAmountToCents ist exakt, wo die Float-Multiplikation es nicht ist', () => {
  for (const [raw, cents] of [
    ['8.29', 829],
    ['19.99', 1999],
    ['4.35', 435],
    ['0.07', 7],
  ] as const) {
    assert.equal(Number.isInteger(Number(raw) * 100), false, `${raw} * 100 waere in Float nicht ganzzahlig`);
    assert.equal(parseAmountToCents(raw), cents);
  }
});

test('parseAmountToCents wirft bei mehr als zwei signifikanten Nachkommastellen', () => {
  assert.throws(() => parseAmountToCents('1.005'), /zwei Nachkommastellen/);
  // Nullen dahinter sind unschaedlich, manche Banken schreiben sie.
  assert.equal(parseAmountToCents('12.3400'), 1234);
});

test('parseAmountToCents wirft bei unlesbaren Betraegen', () => {
  assert.throws(() => parseAmountToCents('12,34'), /nicht lesbar/);
  assert.throws(() => parseAmountToCents('abc'), /nicht lesbar/);
  assert.throws(() => parseAmountToCents(''), /nicht lesbar/);
});

// --- Vorzeichen ------------------------------------------------------------

test('DBIT wird negativ, CRDT positiv', () => {
  const xml = camt(
    entry('<Amt Ccy="EUR">84.20</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>') +
      entry('<Amt Ccy="EUR">2840.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-08-01</Dt></BookgDt>'),
  );
  const { entries } = parseCamt052(xml, parseXml);

  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.amount_cents, -8420);
  assert.equal(entries[1]!.amount_cents, 284000);
});

// --- Gegenpartei und Zweck -------------------------------------------------

test('Gegenpartei ist bei Ausgaben der Empfaenger, bei Einnahmen der Zahler', () => {
  const xml = camt(
    entry(
      '<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>' +
        '<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Ich Selbst</Nm></Dbtr><Cdtr><Nm>REWE Markt</Nm></Cdtr></RltdPties>' +
        '<RmtInf><Ustrd>Einkauf</Ustrd></RmtInf></TxDtls></NtryDtls>',
    ) +
      entry(
        '<Amt Ccy="EUR">2840.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-08-01</Dt></BookgDt>' +
          '<NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Arbeitgeber GmbH</Nm></Dbtr><Cdtr><Nm>Ich Selbst</Nm></Cdtr></RltdPties>' +
          '<RmtInf><Ustrd>Gehalt August</Ustrd></RmtInf></TxDtls></NtryDtls>',
      ),
  );
  const { entries } = parseCamt052(xml, parseXml);

  assert.equal(entries[0]!.payee, 'REWE Markt');
  assert.equal(entries[0]!.note, 'Einkauf');
  assert.equal(entries[1]!.payee, 'Arbeitgeber GmbH');
  assert.equal(entries[1]!.note, 'Gehalt August');
});

test('Mehrzeiliger Verwendungszweck wird zusammengefasst', () => {
  const xml = camt(
    entry(
      '<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>' +
        '<NtryDtls><TxDtls><RmtInf><Ustrd>Rechnung 123</Ustrd><Ustrd>Kundennr 456</Ustrd></RmtInf></TxDtls></NtryDtls>',
    ),
  );
  assert.equal(parseCamt052(xml, parseXml).entries[0]!.note, 'Rechnung 123 Kundennr 456');
});

// --- Datum -----------------------------------------------------------------

test('Buchungsdatum schlaegt Wertstellung', () => {
  const xml = camt(
    entry(
      '<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>' +
        '<BookgDt><Dt>2026-08-14</Dt></BookgDt><ValDt><Dt>2026-08-16</Dt></ValDt>',
    ),
  );
  assert.equal(parseCamt052(xml, parseXml).entries[0]!.date, '2026-08-14');
});

test('Ohne BookgDt wird die Wertstellung genommen, DtTm auf das Datum gekuerzt', () => {
  const xml = camt(
    entry('<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><ValDt><DtTm>2026-08-16T09:31:00</DtTm></ValDt>'),
  );
  assert.equal(parseCamt052(xml, parseXml).entries[0]!.date, '2026-08-16');
});

// --- Status ----------------------------------------------------------------

test('Vorgemerkte Eintraege werden uebersprungen und gezaehlt', () => {
  const xml = camt(
    entry('<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt><Sts>BOOK</Sts>') +
      entry('<Amt Ccy="EUR">20.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-15</Dt></BookgDt><Sts>PDNG</Sts>') +
      entry(
        '<Amt Ccy="EUR">30.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-15</Dt></BookgDt>' +
          '<Sts><Cd>PDNG</Cd></Sts>',
      ),
  );
  const result = parseCamt052(xml, parseXml);

  assert.equal(result.entries.length, 1);
  assert.equal(result.skippedPending, 2);
});

test('Status als verschachtelter Code wird als gebucht erkannt', () => {
  const xml = camt(
    entry(
      '<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>' +
        '<Sts><Cd>BOOK</Cd></Sts>',
    ),
  );
  const result = parseCamt052(xml, parseXml);
  assert.equal(result.entries.length, 1);
  assert.equal(result.skippedPending, 0);
});

// --- Referenzen und Hash ---------------------------------------------------

test('Bank-Referenz wird als source_hash genommen', () => {
  const xml = camt(
    entry(
      '<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>' +
        '<NtryDtls><TxDtls><Refs><TxId>BANK-TX-4711</TxId></Refs></TxDtls></NtryDtls>',
    ),
  );
  const e = parseCamt052(xml, parseXml).entries[0]!;
  assert.equal(e.bank_ref, 'BANK-TX-4711');
  assert.equal(e.source_hash, 'BANK-TX-4711');
});

// NOTPROVIDED steht in unzaehligen SEPA-Auszuegen an jeder Buchung — als
// Referenz genommen waeren alle Buchungen "dieselbe".
test('NOTPROVIDED gilt nicht als Referenz, es wird gehasht', () => {
  const xml = camt(
    entry(
      '<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>' +
        '<NtryDtls><TxDtls><Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs></TxDtls></NtryDtls>',
    ),
  );
  const e = parseCamt052(xml, parseXml).entries[0]!;
  assert.equal(e.bank_ref, null);
  assert.match(e.source_hash, /^f[0-9a-f]{8}$/);
});

test('Ohne Referenz ist der Hash stabil und unterscheidet verschiedene Buchungen', () => {
  const build = (amount: string, payee: string) =>
    camt(
      entry(
        `<Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>` +
          `<NtryDtls><TxDtls><RltdPties><Cdtr><Nm>${payee}</Nm></Cdtr></RltdPties></TxDtls></NtryDtls>`,
      ),
    );

  const a = parseCamt052(build('10.00', 'REWE'), parseXml).entries[0]!.source_hash;
  const b = parseCamt052(build('10.00', 'REWE'), parseXml).entries[0]!.source_hash;
  const c = parseCamt052(build('10.01', 'REWE'), parseXml).entries[0]!.source_hash;
  const d = parseCamt052(build('10.00', 'ALDI'), parseXml).entries[0]!.source_hash;

  assert.equal(a, b, 'derselbe Eintrag ergibt denselben Hash');
  assert.notEqual(a, c, 'anderer Betrag, anderer Hash');
  assert.notEqual(a, d, 'andere Gegenpartei, anderer Hash');
});

test('fingerprint unterscheidet null von leerem String nicht — bewusst', () => {
  assert.equal(fingerprint(['a', null]), fingerprint(['a', '']));
});

// --- Sammelbuchung ---------------------------------------------------------

test('Sammelbuchung wird in ihre Einzeltransaktionen zerlegt', () => {
  const xml = camt(
    entry(
      '<Amt Ccy="EUR">30.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>' +
        '<AcctSvcrRef>SAMMEL-1</AcctSvcrRef>' +
        '<NtryDtls>' +
        '<TxDtls><Amt Ccy="EUR">10.00</Amt><RltdPties><Cdtr><Nm>A</Nm></Cdtr></RltdPties></TxDtls>' +
        '<TxDtls><Amt Ccy="EUR">20.00</Amt><RltdPties><Cdtr><Nm>B</Nm></Cdtr></RltdPties></TxDtls>' +
        '</NtryDtls>',
    ),
  );
  const { entries } = parseCamt052(xml, parseXml);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.amount_cents), [-1000, -2000]);
  assert.deepEqual(entries.map((e) => e.payee), ['A', 'B']);
  // AcctSvcrRef steht am Sammel-Eintrag und waere fuer beide Teile gleich.
  assert.deepEqual(entries.map((e) => e.bank_ref), [null, null]);
  assert.notEqual(entries[0]!.source_hash, entries[1]!.source_hash);
});

// --- Kopfdaten und Fehler --------------------------------------------------

test('IBAN wird aus dem Report-Kopf gelesen', () => {
  const xml = camt(entry('<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>'));
  assert.equal(parseCamt052(xml, parseXml).iban, 'DE02120300000000202051');
});

test('Fehlende IBAN ist kein Fehler', () => {
  const xml = camt(
    entry('<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>'),
    { iban: null },
  );
  assert.equal(parseCamt052(xml, parseXml).iban, null);
});

// Praefix statt Default-Namespace: getElementsByTagName('Ntry') findet das
// nicht, deshalb sucht der Parser ueber den lokalen Namen.
test('Datei mit Namespace-Praefix wird genauso gelesen', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ns2:Document xmlns:ns2="urn:iso:std:iso:20022:tech:xsd:camt.052.001.02">
  <ns2:BkToCstmrAcctRpt><ns2:Rpt>
    <ns2:Acct><ns2:Id><ns2:IBAN>DE99</ns2:IBAN></ns2:Id></ns2:Acct>
    <ns2:Ntry>
      <ns2:Amt Ccy="EUR">10.00</ns2:Amt>
      <ns2:CdtDbtInd>DBIT</ns2:CdtDbtInd>
      <ns2:BookgDt><ns2:Dt>2026-08-14</ns2:Dt></ns2:BookgDt>
    </ns2:Ntry>
  </ns2:Rpt></ns2:BkToCstmrAcctRpt>
</ns2:Document>`;
  const result = parseCamt052(xml, parseXml);

  assert.equal(result.iban, 'DE99');
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]!.amount_cents, -1000);
});

test('Fremdwaehrung wird abgelehnt', () => {
  const xml = camt(entry('<Amt Ccy="CHF">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-08-14</Dt></BookgDt>'));
  assert.throws(() => parseCamt052(xml, parseXml), /Nur EUR/);
});

test('Datei ohne BkToCstmrAcctRpt wird abgelehnt', () => {
  assert.throws(() => parseCamt052('<Document><Foo/></Document>', parseXml), /Keine CAMT.052-Datei/);
});

test('Fehlender Credit-Debit-Indikator wirft', () => {
  const xml = camt(entry('<Amt Ccy="EUR">10.00</Amt><BookgDt><Dt>2026-08-14</Dt></BookgDt>'));
  assert.throws(() => parseCamt052(xml, parseXml), /Credit-Debit-Indikator/);
});

test('Fehlendes Buchungsdatum wirft', () => {
  const xml = camt(entry('<Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>'));
  assert.throws(() => parseCamt052(xml, parseXml), /Buchungsdatum/);
});
