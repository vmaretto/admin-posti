// Parser per estratti conto Qonto (PDF estratto in testo).
//
// Formato osservato:
//   Header:
//     "Dal giorno DD/MM/YYYY al giorno DD/MM/YYYY"
//     ...
//     "Saldo al giorno DD/MM             + N.NN EUR"
//     "Entrate                                + N.NN EUR"
//     "Uscite                              - N.NN EUR"
//     "Saldo al giorno DD/MM               + N.NN EUR"
//
//   Riga transazione:
//     "DD/MM                  CONTROPARTE                              - N.NN EUR"
//     "                       Dettaglio (riferimento / canone / IBAN…)"
//     [opzionale per multi-valuta]:
//     "                       X.YYYYY USD = 1.00 EUR                   - N.NN USD"
//     [opzionale]:
//     "                       Carta **1783"
//
// Le transazioni sono separate da una riga vuota.
// Header e footer si ripetono a metà documento — vanno skippati.

export interface QontoTransaction {
  data: string // YYYY-MM-DD
  importo: number // segnato: negativo per uscite, positivo per entrate
  importo_abs: number
  tipo: 'entrata' | 'uscita'
  controparte: string
  descrizione: string | null
  riferimento: string | null
  valuta_originale: string | null
  importo_originale: number | null
  carta: string | null // es. "**1783"
  raw: string // blocco grezzo per debug
}

export interface QontoParseResult {
  periodoFrom: string | null // YYYY-MM-DD
  periodoTo: string | null
  saldoIniziale: number | null
  saldoFinale: number | null
  totaleEntrate: number | null
  totaleUscite: number | null
  transactions: QontoTransaction[]
  warnings: string[]
}

const ITALIAN_NUMBER_RE = /([+-])\s*([\d.,]+)\s*EUR/i
const HEADER_PERIODO_RE = /Dal giorno (\d{2})\/(\d{2})\/(\d{4})\s+al giorno (\d{2})\/(\d{2})\/(\d{4})/i
const DATE_LINE_RE = /^(\d{2})\/(\d{2})\s+(.*)$/
const CARTA_RE = /Carta\s+(\*+\d+)/i
const CURRENCY_CONVERSION_RE = /(\d+[.,]\d+)\s+([A-Z]{3})\s*=\s*1[.,]00\s+EUR/i
const SECONDARY_AMOUNT_RE = /([+-])\s*([\d.,]+)\s+([A-Z]{3})\s*$/

function parseQontoAmount(raw: string): number {
  // Es. "1.234,56" -> 1234.56 (formato italiano)
  // Es. "11.34" -> 11.34 (formato anglosassone in alcuni casi)
  // Qonto usa principalmente formato anglosassone "11.34" ma può capitare
  // di vedere virgole. Strategia: ultimo separatore = decimale.
  const cleaned = raw.replace(/\s/g, '')
  const lastDot = cleaned.lastIndexOf('.')
  const lastComma = cleaned.lastIndexOf(',')
  if (lastDot < 0 && lastComma < 0) return parseFloat(cleaned)
  const decimalSep = lastDot > lastComma ? '.' : ','
  const thousandSep = decimalSep === '.' ? ',' : '.'
  const normalized = cleaned.replace(new RegExp('\\' + thousandSep, 'g'), '').replace(decimalSep, '.')
  const n = parseFloat(normalized)
  return isNaN(n) ? 0 : n
}

function ddMmToIso(dd: string, mm: string, anno: number): string {
  return `${anno}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

// Pattern di riferimento comuni da estrarre dalla descrizione/dettaglio:
//   "FT 278 26" / "FT278/26"
//   "INV-12345"
//   "CINV/F2606430546"
//   "1049367371456/PAYPAL" / "1049500161252 PAYPAL"
//   "APR0005563,"
function extractRiferimento(text: string): string | null {
  if (!text) return null
  const t = text.trim()
  // Pattern noti in ordine di priorità
  const patterns = [
    /\b(F[TE]\s*\d+[\/\s\-]?\d+)\b/i,         // "FT 278 26" / "FE-2025/123"
    /\b(INV[-\s]?\d+)\b/i,                     // "INV-12345"
    /\b(CINV\/[A-Z0-9]+)\b/i,                  // "CINV/F2606430546"
    /\b(\d{10,})\s*[\/\s]?\s*PAYPAL\b/i,       // "1049367371456/PAYPAL"
    /\b([A-Z]{3}\d{6,})\b/,                    // "APR0005563"
  ]
  for (const re of patterns) {
    const m = re.exec(t)
    if (m) return m[1].trim()
  }
  // Fallback: se l'intero testo è breve e contiene cifre, usalo
  if (t.length <= 30 && /\d/.test(t)) return t
  return null
}

// Linee da skippare (header/footer ripetuti, intestazioni colonne)
function isHeaderOrFooterLine(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (/^Dal giorno \d/.test(t)) return true
  if (/^POSTI\s+S\.R\.L\./i.test(t)) return true
  if (/^Data di valuta\s+Transazioni/i.test(t)) return true
  if (/^\d+\/\d+\s*$/.test(t)) return true // numero pagina "1/4"
  if (/^Estratti conto/i.test(t)) return true
  if (/^Saldo al giorno/i.test(t)) return true
  if (/^Entrate\s+[+\-]/i.test(t)) return true
  if (/^Uscite\s+[+\-]/i.test(t)) return true
  if (/^Tutte le tue carte Qonto/i.test(t)) return true
  if (/^Qonto SA,/i.test(t)) return true
  if (/^IBAN:/i.test(t)) return true
  if (/^BIC:/i.test(t)) return true
  if (/^VIA\s+/i.test(t)) return true
  if (/^\d{5},\s+/.test(t)) return true // CAP città es. "00161, ROMA"
  if (/numero\s+\d+\s+e d/i.test(t)) return true
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

  // 1) Header con periodo (per inferire l'anno delle DD/MM)
  const periodoMatch = HEADER_PERIODO_RE.exec(text)
  let anno = new Date().getFullYear()
  if (periodoMatch) {
    const [, fd, fm, fy, td, tm, ty] = periodoMatch
    result.periodoFrom = ddMmToIso(fd, fm, parseInt(fy))
    result.periodoTo = ddMmToIso(td, tm, parseInt(ty))
    anno = parseInt(fy)
    if (fy !== ty) {
      result.warnings.push('Periodo a cavallo di anni: uso l\'anno di inizio per le date DD/MM.')
    }
  } else {
    result.warnings.push('Header periodo non trovato — anno corrente come fallback.')
  }

  // 2) Saldo iniziale / finale / entrate / uscite
  const saldoLines = text.split('\n').slice(0, 30) // sono nelle prime righe
  for (const line of saldoLines) {
    if (/Saldo al giorno \d{2}\/\d{2}\s+[+\-]/.test(line)) {
      const m = ITALIAN_NUMBER_RE.exec(line)
      if (m) {
        const val = parseQontoAmount(m[2]) * (m[1] === '-' ? -1 : 1)
        if (result.saldoIniziale === null) result.saldoIniziale = val
        else result.saldoFinale = val
      }
    } else if (/^\s*Entrate/i.test(line)) {
      const m = ITALIAN_NUMBER_RE.exec(line)
      if (m) result.totaleEntrate = parseQontoAmount(m[2]) * (m[1] === '-' ? -1 : 1)
    } else if (/^\s*Uscite/i.test(line)) {
      const m = ITALIAN_NUMBER_RE.exec(line)
      if (m) result.totaleUscite = parseQontoAmount(m[2]) * (m[1] === '-' ? -1 : 1)
    }
  }

  // 3) Parsing transazioni — divido in blocchi separati da righe vuote
  const lines = text.split('\n')
  const blocks: string[][] = []
  let cur: string[] = []
  for (const rawLine of lines) {
    if (isHeaderOrFooterLine(rawLine)) {
      if (cur.length) { blocks.push(cur); cur = [] }
      continue
    }
    if (rawLine.trim() === '') {
      if (cur.length) { blocks.push(cur); cur = [] }
    } else {
      cur.push(rawLine)
    }
  }
  if (cur.length) blocks.push(cur)

  for (const block of blocks) {
    // Una trans valida ha una riga che inizia con DD/MM e contiene un importo EUR.
    const first = block[0]
    const dateMatch = DATE_LINE_RE.exec(first)
    if (!dateMatch) continue
    const [, dd, mm, rest] = dateMatch
    // Estrai importo EUR dalla prima riga
    const amountMatch = ITALIAN_NUMBER_RE.exec(rest)
    if (!amountMatch) continue
    const sign = amountMatch[1] === '-' ? -1 : 1
    const importoAbs = parseQontoAmount(amountMatch[2])
    if (!isFinite(importoAbs) || importoAbs <= 0) continue

    // La descrizione/controparte è quello che sta tra l'inizio di `rest`
    // e l'inizio dell'importo (rimuoviamo spazi finali multipli)
    const amtIdx = rest.indexOf(amountMatch[0])
    const controparte = (amtIdx > 0 ? rest.slice(0, amtIdx) : rest).trim()

    // Righe successive del blocco: dettagli vari
    const detailLines = block.slice(1).map(l => l.trim()).filter(Boolean)
    let valutaOriginale: string | null = null
    let importoOriginale: number | null = null
    let carta: string | null = null
    const descriptionParts: string[] = []
    for (const dl of detailLines) {
      const ccMatch = CURRENCY_CONVERSION_RE.exec(dl)
      if (ccMatch) {
        valutaOriginale = ccMatch[2]
        // L'importo originale è (di solito) nella linea successiva con SECONDARY_AMOUNT_RE
        const secMatch = SECONDARY_AMOUNT_RE.exec(dl)
        if (secMatch) {
          importoOriginale = parseQontoAmount(secMatch[2]) * (secMatch[1] === '-' ? -1 : 1)
        }
        continue
      }
      // Solo "- 251.52 USD" senza la conversione (raro)
      const secOnly = SECONDARY_AMOUNT_RE.exec(dl)
      if (secOnly && valutaOriginale === secOnly[3]) {
        importoOriginale = parseQontoAmount(secOnly[2]) * (secOnly[1] === '-' ? -1 : 1)
        continue
      }
      const cartaM = CARTA_RE.exec(dl)
      if (cartaM) {
        carta = cartaM[1]
        continue
      }
      descriptionParts.push(dl)
    }
    const descrizione = descriptionParts.join(' · ') || null
    const riferimento = extractRiferimento(descrizione || '') || extractRiferimento(controparte)

    result.transactions.push({
      data: ddMmToIso(dd, mm, anno),
      importo: importoAbs * sign,
      importo_abs: importoAbs,
      tipo: sign < 0 ? 'uscita' : 'entrata',
      controparte,
      descrizione,
      riferimento,
      valuta_originale: valutaOriginale,
      importo_originale: importoOriginale,
      carta,
      raw: block.join('\n'),
    })
  }

  return result
}
