// Parser per estratti conto Qonto (PDF estratto via pdf-parse).
//
// pdf-parse v1.1.1 non preserva il layout a colonne — il testo arriva come
// righe sequenziali. Una transazione Qonto occupa quindi 2-5 righe:
//
//   "01/04FREE2MOVE* NR000141945"   ← data DDMM + controparte (attaccate)
//   "Carta **1783"                  ← dettaglio (opzionale)
//   "- 11.34 EUR"                   ← importo EUR
//
// Multi-valuta:
//   "02/04AWS EMEA"
//   "1.15127935185609 USD = 1.00 EUR"
//   "Carta **1783"
//   "- 218.47 EUR"
//   "- 251.52 USD"
//
// Con riferimento fattura nelle note:
//   "02/04PTS CONSILIUM SRL"
//   "FT 278 26"
//   "- 577.06 EUR"

export interface QontoTransaction {
  data: string // YYYY-MM-DD
  importo: number // segnato
  importo_abs: number
  tipo: 'entrata' | 'uscita'
  controparte: string
  descrizione: string | null
  riferimento: string | null
  valuta_originale: string | null
  importo_originale: number | null
  carta: string | null
  raw: string
}

export interface QontoParseResult {
  periodoFrom: string | null
  periodoTo: string | null
  saldoIniziale: number | null
  saldoFinale: number | null
  totaleEntrate: number | null
  totaleUscite: number | null
  transactions: QontoTransaction[]
  warnings: string[]
}

// --- Regex ---
// Header periodo (può comparire come "Dal giorno 01/04/2026 al giorno 30/04/2026")
const HEADER_PERIODO_RE = /Dal giorno (\d{2})\/(\d{2})\/(\d{4})\s+al giorno (\d{2})\/(\d{2})\/(\d{4})/i

// Riga che inizia con DD/MM (data senza anno). Il resto della riga è la controparte
// attaccata o separata da spazi.
const DATE_PREFIX_RE = /^(\d{2})\/(\d{2})(.+)$/

// "- 11.34 EUR" o "+ 11.34 EUR" — importo EUR, riga isolata
const EUR_AMOUNT_RE = /^([+-])\s*([\d.,]+)\s+EUR\s*$/i

// Importo EUR INLINE alla fine di una riga (es. trans senza dettagli:
// "21/04Agenzia delle Entrate- 295.87 EUR"). Solo per estrarre importo
// dalla riga della data.
const EUR_AMOUNT_INLINE_END_RE = /([+-])\s*([\d.,]+)\s+EUR\s*$/i

// "- 251.52 USD" — importo in valuta originale (con segno)
const CURRENCY_AMOUNT_RE = /^([+-])\s*([\d.,]+)\s+([A-Z]{3})\s*$/i

// "1.15127935185609 USD = 1.00 EUR" — riga di tasso cambio
const CURRENCY_CONVERSION_RE = /^(\d+[.,]\d+)\s+([A-Z]{3})\s*=\s*1[.,]00\s+EUR\s*$/i

// "Carta **1783" — dettaglio carta usata
const CARTA_RE = /^Carta\s+(\*+\d+)/i

// "Saldo al giorno 01/04+ 29939.47 EUR" (no layout) — estrae il valore
const SALDO_RE = /Saldo al giorno \d{2}\/\d{2}([+-])\s*([\d.,]+)\s+EUR/i
// "Entrate+ 0.00 EUR" oppure "Uscite- 21937.63 EUR"
const ENTRATE_RE = /Entrate([+-])\s*([\d.,]+)\s+EUR/i
const USCITE_RE = /Uscite([+-])\s*([\d.,]+)\s+EUR/i

function parseQontoAmount(raw: string): number {
  const cleaned = raw.replace(/\s/g, '')
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')
  if (lastDot < 0 && lastComma < 0) return parseFloat(cleaned) || 0
  const decimalSep = lastDot > lastComma ? '.' : ','
  const thousandSep = decimalSep === '.' ? ',' : '.'
  const normalized = cleaned.replace(new RegExp('\\' + thousandSep, 'g'), '').replace(decimalSep, '.')
  const n = parseFloat(normalized)
  return isNaN(n) ? 0 : n
}

function ddMmToIso(dd: string, mm: string, anno: number): string {
  return `${anno}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function extractRiferimento(text: string): string | null {
  if (!text) return null
  const t = text.trim()
  const patterns = [
    /\b(F[TE]\s*\d+[\/\s\-]?\d+)\b/i, // "FT 278 26" / "FE-2025/123"
    /\b(INV[-\s]?\d+)\b/i,
    /\b(CINV\/[A-Z0-9]+)\b/i,
    /\b(\d{10,})\s*[\/\s]?\s*PAYPAL\b/i,
    /\b([A-Z]{3}\d{6,})\b/,
  ]
  for (const re of patterns) {
    const m = re.exec(t)
    if (m) return m[1].trim()
  }
  if (t.length <= 30 && /\d/.test(t)) return t
  return null
}

function isHeaderOrFooterLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (/^Dal giorno \d/.test(t)) return true
  if (/^POSTI\s+S\.R\.L\./i.test(t)) return true
  if (/^Data di valuta/i.test(t)) return true
  if (/^\d+\/\d+\s*$/.test(t)) return true // "1/4"
  if (/^Estratti conto/i.test(t)) return true
  if (/^Saldo al giorno/i.test(t)) return true
  if (/^Entrate[+\-]/i.test(t)) return true
  if (/^Uscite[+\-]/i.test(t)) return true
  if (/^Tutte le tue carte Qonto/i.test(t)) return true
  if (/^Qonto SA,/i.test(t)) return true
  if (/^IBAN:/i.test(t)) return true
  if (/^BIC:/i.test(t)) return true
  if (/^VIA\s+/i.test(t)) return true
  if (/^\d{5},\s+/.test(t)) return true // CAP città
  if (/numero\s+\d+\s+e\s+è\s+stata/i.test(t)) return true
  return false
}

export function parseQontoStatement(text: string): QontoParseResult {
  const result: QontoParseResult = {
    periodoFrom: null,
    periodoTo: null,
    saldoIniziale: null,
    saldoFinale: null,
    totaleEntrate: null,
    totaleUscite: null,
    transactions: [],
    warnings: [],
  }

  // 1) Periodo (per inferire l'anno)
  const periodoMatch = HEADER_PERIODO_RE.exec(text)
  let anno = new Date().getFullYear()
  if (periodoMatch) {
    const [, fd, fm, fy, td, tm, ty] = periodoMatch
    result.periodoFrom = ddMmToIso(fd, fm, parseInt(fy))
    result.periodoTo = ddMmToIso(td, tm, parseInt(ty))
    anno = parseInt(fy)
    if (fy !== ty) result.warnings.push("Periodo a cavallo di anni — uso l'anno di inizio per DD/MM")
  } else {
    result.warnings.push('Header periodo non trovato — anno corrente come fallback.')
  }

  // 2) Saldi e totali — scansiona le prime ~30 righe
  const lines = text.split('\n').map(l => l.trim())
  const headerLines = lines.slice(0, 40)
  let saldoCount = 0
  for (const line of headerLines) {
    let m = SALDO_RE.exec(line)
    if (m) {
      const val = parseQontoAmount(m[2]) * (m[1] === '-' ? -1 : 1)
      if (saldoCount === 0) result.saldoIniziale = val
      else if (saldoCount === 1) result.saldoFinale = val
      saldoCount++
      continue
    }
    m = ENTRATE_RE.exec(line)
    if (m) {
      result.totaleEntrate = parseQontoAmount(m[2]) * (m[1] === '-' ? -1 : 1)
      continue
    }
    m = USCITE_RE.exec(line)
    if (m) {
      result.totaleUscite = parseQontoAmount(m[2]) * (m[1] === '-' ? -1 : 1)
    }
  }

  // 3) Parsing transazioni: scansione lineare.
  // Quando trovo una riga "DD/MM<resto>" inizio un blocco e raccolgo le
  // righe successive fino al prossimo DD/MM (saltando header/footer).
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isHeaderOrFooterLine(line)) { i++; continue }
    const m = DATE_PREFIX_RE.exec(line)
    if (!m) { i++; continue }
    const dd = m[1]
    const mm = m[2]
    let restControparte = m[3].trim()
    if (!restControparte) { i++; continue }

    let importoEur: number | null = null
    let importoSign = -1
    let valutaOriginale: string | null = null
    let importoOriginale: number | null = null
    let carta: string | null = null
    const dettagli: string[] = []
    const rawBlock: string[] = [line]

    // Caso speciale: la riga della data contiene già l'importo EUR inline
    // (trans senza riga dettagli). Es. "21/04Agenzia delle Entrate- 295.87 EUR"
    const inlineAmt = EUR_AMOUNT_INLINE_END_RE.exec(restControparte)
    if (inlineAmt) {
      importoSign = inlineAmt[1] === '-' ? -1 : 1
      importoEur = parseQontoAmount(inlineAmt[2])
      // Rimuovi l'importo dalla controparte
      restControparte = restControparte.slice(0, inlineAmt.index).trim().replace(/[-+]$/, '').trim()
    }

    let j = i + 1
    while (j < lines.length) {
      const next = lines[j]
      if (DATE_PREFIX_RE.test(next) && !isHeaderOrFooterLine(next)) break
      if (isHeaderOrFooterLine(next)) { j++; continue }
      rawBlock.push(next)

      const eurM = EUR_AMOUNT_RE.exec(next)
      if (eurM && importoEur === null) {
        importoSign = eurM[1] === '-' ? -1 : 1
        importoEur = parseQontoAmount(eurM[2])
        j++; continue
      }
      const ccM = CURRENCY_CONVERSION_RE.exec(next)
      if (ccM) {
        valutaOriginale = ccM[2]
        j++; continue
      }
      const caM = CURRENCY_AMOUNT_RE.exec(next)
      if (caM && importoOriginale === null) {
        // Solo se la valuta combacia con quella nella conversione
        if (!valutaOriginale || valutaOriginale === caM[3]) {
          valutaOriginale = valutaOriginale || caM[3]
          importoOriginale = parseQontoAmount(caM[2]) * (caM[1] === '-' ? -1 : 1)
          j++; continue
        }
      }
      const cartaM = CARTA_RE.exec(next)
      if (cartaM) {
        carta = cartaM[1]
        j++; continue
      }
      dettagli.push(next)
      j++
    }

    if (importoEur !== null && restControparte) {
      const descrizione = dettagli.join(' · ') || null
      result.transactions.push({
        data: ddMmToIso(dd, mm, anno),
        importo: importoEur * importoSign,
        importo_abs: importoEur,
        tipo: importoSign < 0 ? 'uscita' : 'entrata',
        controparte: restControparte,
        descrizione,
        riferimento: extractRiferimento(descrizione || '') || extractRiferimento(restControparte),
        valuta_originale: valutaOriginale,
        importo_originale: importoOriginale,
        carta,
        raw: rawBlock.join('\n'),
      })
    }
    i = j
  }

  return result
}
