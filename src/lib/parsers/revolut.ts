// Parser estratto conto Revolut Business (PDF italiano).
//
// Formato osservato dopo pdf-parse v1:
//   32: "Saldo iniziale€277.69"
//   33: "Fondi in entrata€10.00"
//   34: "Fondi in uscita- €37.67"
//   35: "Saldo finale€250.02"
//   37: "Transazionidal1 aprile 2026al30 aprile 2026"
//   39: "24 apr 2026CARMicrosoft-g154394489€27.67€250.02"
//   40-42: multi-riga
//     "19 apr 2026MORCommissione Revolut Business • Refund for"
//     "plan suspension"
//     "€10.00€277.69"
//   43-45:
//     "19 apr 2026FEECommissione Revolut Business •"
//     "Commissione piano Basic"
//     "€10.00€267.69"
//
// Tipi (3 lettere): CAR (carta) MOS (out) MOR (in) MOA (added) FEE ATM EXO EXI
// Convenzione: CAR/MOS/FEE/ATM/EXO = uscita; MOR/MOA/EXI = entrata.
// Importi formato europeo americano: "€27.67" (punto decimale, no separatore migliaia).

const MESI_IT_ABBR = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

export interface RevolutTransaction {
  data: string
  importo: number
  importo_abs: number
  tipo: 'entrata' | 'uscita'
  tipoCodice: string // CAR, MOR, FEE, ...
  controparte: string
  descrizione: string
  saldoDopo: number | null
  raw: string
}

export interface RevolutParseResult {
  periodoFrom: string | null
  periodoTo: string | null
  saldoIniziale: number | null
  saldoFinale: number | null
  totaleEntrate: number | null
  totaleUscite: number | null
  valuta: string
  transactions: RevolutTransaction[]
  warnings: string[]
}

const PERIODO_RE = /Transazioni\s*dal\s*(\d{1,2})\s+(\w+)\s+(\d{4})\s*al\s*(\d{1,2})\s+(\w+)\s+(\d{4})/i
const SALDO_INI_RE = /Saldo iniziale[€£$]([\d,.-]+)/i
const SALDO_FIN_RE = /Saldo finale[€£$]([\d,.-]+)/i
const FONDI_IN_RE = /Fondi in entrata[€£$]([\d,.-]+)/i
const FONDI_OUT_RE = /Fondi in uscita\s*[-]?\s*[€£$]([\d,.-]+)/i

// Riga data+tipo+inizio descrizione: "24 apr 2026CARMicrosoft-g154394489..."
const DATE_LINE_RE = /^(\d{1,2})\s+([a-zA-Z]{3})\s+(\d{4})([A-Z]{3})(.*)$/

// Riga importo: "€27.67€250.02" o "€10.00€277.69" (uscita€saldo o entrata€saldo)
// In alcuni casi solo €X.XX
const AMOUNTS_LINE_RE = /^€([\d,.]+)€([\d,.]+)$/
const SINGLE_AMOUNT_RE = /^€([\d,.]+)$/

// Tipi uscita
const TIPI_USCITA = new Set(['CAR', 'MOS', 'FEE', 'ATM', 'EXO'])
const TIPI_ENTRATA = new Set(['MOR', 'MOA', 'EXI'])

function parseRevolutAmount(raw: string): number {
  // Es. "27.67" oppure "1,234.56" (formato US). Rimuovi virgole.
  const cleaned = raw.replace(/\s/g, '').replace(/,/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function mesiIta(abbr: string): number {
  const i = MESI_IT_ABBR.indexOf(abbr.toLowerCase().slice(0, 3))
  return i >= 0 ? i + 1 : 0
}

function meseToIso(dd: number, mese: number, yyyy: number): string {
  return `${yyyy}-${String(mese).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

function isSkipLine(t: string): boolean {
  if (!t) return true
  if (/^Tipi di transazione/i.test(t)) return true
  if (/^Pagamenti con carta/i.test(t)) return true
  if (/^Fondi inviati/i.test(t)) return true
  if (/^Fondi ricevuti/i.test(t)) return true
  if (/^Fondi aggiunti/i.test(t)) return true
  if (/^Prelievi di contanti/i.test(t)) return true
  if (/^Cambi/i.test(t)) return true
  if (/^Commissioni Revolut/i.test(t)) return true
  if (/^Segnala carta/i.test(t)) return true
  if (/^Otteni aiuto/i.test(t)) return true
  if (/^Scansiona/i.test(t)) return true
  if (/^Revolut Bank UAB/i.test(t)) return true
  if (/^trova all'indirizzo Konstitucijos/i.test(t)) return true
  if (/^domanda, contattaci/i.test(t)) return true
  if (/^depositi fornita/i.test(t)) return true
  if (/^tale impresa pubblica/i.test(t)) return true
  if (/^©\s+\d+\s*Revolut/i.test(t)) return true
  if (/^\d+\/\d+$/.test(t)) return true // "1/4"
  if (/^Data \(UTC\)/i.test(t)) return true
  if (/^IBAN/i.test(t)) return true
  if (/^BIC/i.test(t)) return true
  if (/^Nome del conto/i.test(t)) return true
  if (/^Riepilogo saldo/i.test(t)) return true
  if (/^Estratto conto/i.test(t)) return true
  if (/^Generato in data/i.test(t)) return true
  if (/^Valuta(EUR|GBP|USD|CHF)/i.test(t)) return true
  if (/^Tipo$/i.test(t)) return true
  if (/^Locale$/i.test(t)) return true
  if (/^Internazionale$/i.test(t)) return true
  return false
}

export function parseRevolutStatement(text: string): RevolutParseResult {
  const result: RevolutParseResult = {
    periodoFrom: null,
    periodoTo: null,
    saldoIniziale: null,
    saldoFinale: null,
    totaleEntrate: null,
    totaleUscite: null,
    valuta: 'EUR',
    transactions: [],
    warnings: [],
  }

  const lines = text.split('\n').map(l => l.trim())

  // 1) Metadati
  for (const line of lines) {
    let m = PERIODO_RE.exec(line)
    if (m) {
      const [, d1, mes1, y1, d2, mes2, y2] = m
      const mm1 = mesiIta(mes1)
      const mm2 = mesiIta(mes2)
      if (mm1) result.periodoFrom = meseToIso(parseInt(d1), mm1, parseInt(y1))
      if (mm2) result.periodoTo = meseToIso(parseInt(d2), mm2, parseInt(y2))
      continue
    }
    m = SALDO_INI_RE.exec(line)
    if (m && result.saldoIniziale === null) result.saldoIniziale = parseRevolutAmount(m[1])
    m = SALDO_FIN_RE.exec(line)
    if (m && result.saldoFinale === null) result.saldoFinale = parseRevolutAmount(m[1])
    m = FONDI_IN_RE.exec(line)
    if (m && result.totaleEntrate === null) result.totaleEntrate = parseRevolutAmount(m[1])
    m = FONDI_OUT_RE.exec(line)
    if (m && result.totaleUscite === null) result.totaleUscite = parseRevolutAmount(m[1])
  }

  // 2) Scansione transazioni: ogni blocco inizia con DATE_LINE_RE.
  // Il blocco contiene una o più righe di descrizione, e termina con una
  // riga AMOUNTS_LINE_RE (importo + saldo) o SINGLE_AMOUNT_RE (importo solo).
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isSkipLine(line)) { i++; continue }
    const m = DATE_LINE_RE.exec(line)
    if (!m) { i++; continue }
    const [, dd, mesAbbr, yyyy, tipoCod, restoFirstLine] = m
    const mm = mesiIta(mesAbbr)
    if (!mm) { i++; continue }

    const dataIso = meseToIso(parseInt(dd), mm, parseInt(yyyy))
    const descParts: string[] = []
    if (restoFirstLine) descParts.push(restoFirstLine.trim())

    let importoVal: number | null = null
    let saldoDopo: number | null = null

    // Cerca le righe successive finché non trovo una riga importo
    let j = i + 1
    while (j < lines.length) {
      const next = lines[j]
      if (isSkipLine(next)) { j++; continue }
      if (DATE_LINE_RE.test(next)) break // inizio prossima trans senza importo trovato → skip
      const am = AMOUNTS_LINE_RE.exec(next)
      if (am) {
        importoVal = parseRevolutAmount(am[1])
        saldoDopo = parseRevolutAmount(am[2])
        j++
        break
      }
      const sa = SINGLE_AMOUNT_RE.exec(next)
      if (sa) {
        importoVal = parseRevolutAmount(sa[1])
        j++
        break
      }
      // Verifico se la riga ha tre €€€ attaccati (a volte succede)
      const triple = /^€([\d,.]+)€([\d,.]+)€([\d,.]+)$/.exec(next)
      if (triple) {
        // Primo è importo, ultimo è saldo
        importoVal = parseRevolutAmount(triple[1])
        saldoDopo = parseRevolutAmount(triple[3])
        j++
        break
      }
      // È una riga di descrizione (continuazione)
      descParts.push(next)
      j++
    }

    // Se la prima riga conteneva già un importo inline (es. "24 apr 2026CARMicrosoft-g154394489€27.67€250.02"),
    // proviamo a estrarlo dalla descrizione raw.
    if (importoVal === null) {
      const all = (restoFirstLine || '') + ' ' + descParts.join(' ')
      const inlineAm = /€([\d,.]+)€([\d,.]+)/.exec(all)
      if (inlineAm) {
        importoVal = parseRevolutAmount(inlineAm[1])
        saldoDopo = parseRevolutAmount(inlineAm[2])
        // Rimuovi dalla descrizione
        descParts[0] = (descParts[0] || '').replace(/€[\d,.]+€[\d,.]+.*$/, '').trim()
      }
    }

    if (importoVal !== null && importoVal > 0) {
      const tipo: 'entrata' | 'uscita' = TIPI_ENTRATA.has(tipoCod) ? 'entrata' : TIPI_USCITA.has(tipoCod) ? 'uscita' : 'uscita'
      const sign = tipo === 'entrata' ? 1 : -1
      const descrizione = descParts.filter(Boolean).join(' ').trim()
      result.transactions.push({
        data: dataIso,
        importo: importoVal * sign,
        importo_abs: importoVal,
        tipo,
        tipoCodice: tipoCod,
        controparte: descrizione.split(/\s*•\s*/)[0].trim() || descrizione,
        descrizione,
        saldoDopo,
        raw: lines.slice(i, j).join('\n'),
      })
    }
    i = j
  }

  // 3) Validazione
  const sumU = result.transactions.filter(t => t.tipo === 'uscita').reduce((s, t) => s + t.importo_abs, 0)
  const sumE = result.transactions.filter(t => t.tipo === 'entrata').reduce((s, t) => s + t.importo_abs, 0)
  if (result.totaleUscite !== null && Math.abs(sumU - result.totaleUscite) > 0.5) {
    result.warnings.push(`Totale uscite (${sumU.toFixed(2)}) ≠ header (${result.totaleUscite.toFixed(2)})`)
  }
  if (result.totaleEntrate !== null && Math.abs(sumE - result.totaleEntrate) > 0.5) {
    result.warnings.push(`Totale entrate (${sumE.toFixed(2)}) ≠ header (${result.totaleEntrate.toFixed(2)})`)
  }

  return result
}
