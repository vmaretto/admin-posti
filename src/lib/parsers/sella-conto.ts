// Parser estratto conto Banca Sella (conto corrente, PDF).
//
// Formato osservato dopo pdf-parse v1 (no layout):
//   2: "ESTRATTO CONTO N. 4/2026 DEL 30 04 26"
//  23: "SALDO INIZIALE AL 31 03 261.134,83"
//  24: "ENTRATE COMPLESSIVE DEL PERIODO18.300,00"
//  25: "USCITE  COMPLESSIVE DEL PERIODO-41,77"
//  26: "SALDO FINALE AL 30 04 2619.393,06"
//  35: "31 03 26SALDO INIZIALE A VS. CREDITO  1.134,83"   ← skip
//  36: "02 04 2631 03 26VALORI BOLLATI C/C M35227053279010,02"
//  37: "03 04 2631 03 26SPESE TENUTA DEL CONTO CANONE DEL CONTO31,75"
//  38: "30 04 2630 04 26BONIFICO DA MIDA SOCIETA A RESP...DA BCI18.300,00"
//  39: "30 04 26SALDO FINALE A VS. CREDITO 19.393,06"    ← skip
//
// Importi in formato italiano: punto migliaia, virgola decimale.
// Distinzione uscite/entrate: il PDF originale usa 2 colonne (Uscite/Entrate).
// Nel testo no-layout questa info si perde, ma:
//   - le keyword nella descrizione sono affidabili (BONIFICO DA, ACCREDITO,
//     INTERESSI A CREDITO, RIMBORSO → entrata; il resto → uscita)
//   - se i totali del periodo (ENTRATE/USCITE COMPLESSIVE) non quadrano,
//     emettiamo un warning ma manteniamo l'euristica

export interface SellaContoTransaction {
  data: string // YYYY-MM-DD (data contabile)
  dataValuta: string | null
  importo: number // segnato
  importo_abs: number
  tipo: 'entrata' | 'uscita'
  controparte: string // estratta dalla descrizione (parola dopo "DA"/"A" se BONIFICO)
  descrizione: string
  raw: string
}

export interface SellaContoParseResult {
  periodoFrom: string | null
  periodoTo: string | null
  saldoIniziale: number | null
  saldoFinale: number | null
  totaleEntrate: number | null
  totaleUscite: number | null
  transactions: SellaContoTransaction[]
  warnings: string[]
}

// Regex helpers
const ESTRATTO_RE = /ESTRATTO CONTO N\.\s*(\d+)\/(\d{4})\s+DEL\s+(\d{2})\s+(\d{2})\s+(\d{2})/i
const SALDO_INIZIALE_HDR = /SALDO INIZIALE AL\s+(\d{2})\s+(\d{2})\s+(\d{2})([\d.,]+)/i
const SALDO_FINALE_HDR = /SALDO FINALE AL\s+(\d{2})\s+(\d{2})\s+(\d{2})([\d.,]+)/i
const ENTRATE_TOT_RE = /ENTRATE\s+COMPLESSIVE\s+DEL\s+PERIODO\s*([\d.,-]+)/i
const USCITE_TOT_RE = /USCITE\s+COMPLESSIVE\s+DEL\s+PERIODO\s*([\d.,-]+)/i

// Riga transazione: 'DD MM YY' + opzionale 'DD MM YY' + descrizione + importo finale
const TRANS_LINE_RE = /^(\d{2})\s(\d{2})\s(\d{2})(?:(\d{2})\s(\d{2})\s(\d{2}))?(.+?)([\d]{1,3}(?:\.\d{3})*,\d{2})$/

// Parole chiave che suggeriscono ENTRATA (per default = uscita)
const ENTRATA_KEYWORDS = [
  /\bBONIFICO\s+DA\b/i,
  /\bACCREDITO\b/i,
  /\bVERSAMENTO\b/i,
  /\bINTERESSI A CREDITO\b/i,
  /\bRIMBORSO\b/i,
  /\bA VS\.?\s+FAVORE\b/i,
  /\bGIROCONTO\s+DA\b/i,
]

function parseItalianAmount(raw: string): number {
  const cleaned = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function ddMmYyToIso(dd: string, mm: string, yy: string): string {
  const anno = 2000 + parseInt(yy)
  return `${anno}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function extractControparte(desc: string): string {
  // "BONIFICO DA XXXXX DA BCI" -> "XXXXX"
  let m = /BONIFICO\s+DA\s+(.+?)(?:\s+DA\s+BCI|\s+CRO\b|\s+TRN\b|$)/i.exec(desc)
  if (m) return m[1].trim()
  m = /BONIFICO\s+A\s+(.+?)(?:\s+CRO\b|\s+TRN\b|$)/i.exec(desc)
  if (m) return m[1].trim()
  // Fallback: prime 60 chars
  return desc.slice(0, 60).trim()
}

function isSkipLine(t: string): boolean {
  if (!t) return true
  if (/SALDO\s+INIZIALE\s+A\s+VS/i.test(t)) return true
  if (/SALDO\s+FINALE\s+A\s+VS/i.test(t)) return true
  return false
}

export function parseSellaContoStatement(text: string): SellaContoParseResult {
  const result: SellaContoParseResult = {
    periodoFrom: null,
    periodoTo: null,
    saldoIniziale: null,
    saldoFinale: null,
    totaleEntrate: null,
    totaleUscite: null,
    transactions: [],
    warnings: [],
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // 1) Saldi e periodo dal blocco "ESTRATTO CONTO IN SINTESI"
  for (const line of lines.slice(0, 50)) {
    let m = SALDO_INIZIALE_HDR.exec(line)
    if (m) {
      const [, dd, mm, yy, amt] = m
      result.saldoIniziale = parseItalianAmount(amt)
      // periodo from = saldo iniziale + 1 giorno (saldoIniziale è del giorno PRECEDENTE)
      const dt = new Date(ddMmYyToIso(dd, mm, yy))
      dt.setDate(dt.getDate() + 1)
      result.periodoFrom = dt.toISOString().slice(0, 10)
      continue
    }
    m = SALDO_FINALE_HDR.exec(line)
    if (m) {
      const [, dd, mm, yy, amt] = m
      result.saldoFinale = parseItalianAmount(amt)
      result.periodoTo = ddMmYyToIso(dd, mm, yy)
      continue
    }
    m = ENTRATE_TOT_RE.exec(line)
    if (m) {
      result.totaleEntrate = parseItalianAmount(m[1])
      continue
    }
    m = USCITE_TOT_RE.exec(line)
    if (m) {
      result.totaleUscite = parseItalianAmount(m[1])
    }
  }

  // 2) Estrai transazioni dal blocco "RIEPILOGO MOVIMENTI"
  let inMovimenti = false
  for (const line of lines) {
    if (/^RIEPILOGO MOVIMENTI/i.test(line)) {
      inMovimenti = true
      continue
    }
    if (!inMovimenti) continue
    if (/^COMUNICAZIONI INFORMATIVE/i.test(line)) break
    if (/^FONDO INTERBANCARIO/i.test(line)) break
    if (/^L.importo iniziale/i.test(line)) continue
    if (isSkipLine(line)) continue

    const m = TRANS_LINE_RE.exec(line)
    if (!m) continue

    const [, dd1, mm1, yy1, dd2, mm2, yy2, desc, amtStr] = m
    const dataContabile = ddMmYyToIso(dd1, mm1, yy1)
    const dataValuta = dd2 && mm2 && yy2 ? ddMmYyToIso(dd2, mm2, yy2) : null
    const importoAbs = parseItalianAmount(amtStr)
    if (!isFinite(importoAbs) || importoAbs <= 0) continue
    const descClean = desc.trim()

    // Euristica entrata/uscita
    const isEntrata = ENTRATA_KEYWORDS.some(re => re.test(descClean))
    const tipo = isEntrata ? 'entrata' : 'uscita'
    const importoSign = isEntrata ? 1 : -1

    result.transactions.push({
      data: dataContabile,
      dataValuta,
      importo: importoAbs * importoSign,
      importo_abs: importoAbs,
      tipo,
      controparte: extractControparte(descClean),
      descrizione: descClean,
      raw: line,
    })
  }

  // 3) Validazione: totali calcolati vs header
  const sumU = result.transactions.filter(t => t.tipo === 'uscita').reduce((s, t) => s + t.importo_abs, 0)
  const sumE = result.transactions.filter(t => t.tipo === 'entrata').reduce((s, t) => s + t.importo_abs, 0)
  if (result.totaleUscite !== null) {
    const headerU = Math.abs(result.totaleUscite)
    if (Math.abs(sumU - headerU) > 0.5) {
      result.warnings.push(`Totale uscite calcolato (${sumU.toFixed(2)}) ≠ header (${headerU.toFixed(2)}). Verifica euristica entrata/uscita.`)
    }
  }
  if (result.totaleEntrate !== null) {
    const headerE = Math.abs(result.totaleEntrate)
    if (Math.abs(sumE - headerE) > 0.5) {
      result.warnings.push(`Totale entrate calcolato (${sumE.toFixed(2)}) ≠ header (${headerE.toFixed(2)}).`)
    }
  }

  return result
}
