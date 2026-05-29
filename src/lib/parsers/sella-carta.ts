// Parser estratto Sella carta di credito (Visa Business).
//
// Formato osservato dopo pdf-parse v1:
//   21: "Le riportiamo di seguito i movimenti di spesa relativi alla Sua Carta di Credito ricevuti entro il  30/04/2026."
//   31: "SPESE VIAGGIO1,50"           ← totale per categoria
//   32: "ALTRI1.808,99"
//   33: "TOTALE1.810,49"
//   61: "RIEPILOGO OPERAZIONI SPESE VIAGGIO"
//   62: "DATAIMPORTO IN EURODESCRIZIONEDIVISAIMP. DIVISA"
//   63: "05/04/20261,50ATAC TAP&GO ROMAEuro"
//   64: "TOTALE1,50"
//   65: "RIEPILOGO OPERAZIONI ALTRI"
//   66: "DATAIMPORTO IN EURODESCRIZIONEDIVISAIMP. DIVISA"
//   67: "20/04/20261.808,99MEDIAWORLD - ROMA 4 ROMAEuro"
//   68: "TOTALE1.808,99"
//
// Pattern transazione: DDMMYYYY + importo IT + descrizione + DIVISA(testo)
//   "05/04/20261,50ATAC TAP&GO ROMAEuro"
// Tutte le righe sono USCITE (è una carta di credito).
// La DIVISA può essere: Euro, USD, GBP, ... per acquisti esteri.

export interface SellaCartaTransaction {
  data: string
  importo: number // sempre negativo (sono spese)
  importo_abs: number
  tipo: 'uscita'
  controparte: string
  descrizione: string
  categoria: string | null
  valuta_originale: string | null
  importo_originale: number | null
  carta: string | null
  raw: string
}

export interface SellaCartaParseResult {
  periodoFrom: string | null
  periodoTo: string | null
  totaleUscite: number | null
  cartaNumero: string | null
  utilizzatore: string | null
  categorie: Record<string, number>
  transactions: SellaCartaTransaction[]
  warnings: string[]
}

const DATA_RIFERIMENTO_RE = /ricevuti entro il\s+(\d{2})\/(\d{2})\/(\d{4})/i
const CARTA_NUMERO_RE = /Carta Secondaria(\d+X+\d+)/i
const UTILIZZATORE_RE = /Utilizzatore([A-Z\s]+?)(?:Carta|Limite|$)/
const TOTALE_GLOBALE_RE = /^TOTALE([\d.,]+)$/i

const CATEGORIA_HEADER_RE = /^RIEPILOGO OPERAZIONI\s+(.+?)$/i

// Riga transazione: data DD/MM/YYYY + importo IT + descrizione + divisa testuale
const TRANS_LINE_RE = /^(\d{2})\/(\d{2})\/(\d{4})([\d]{1,3}(?:\.\d{3})*,\d{2})(.+?)(Euro|USD|GBP|CHF|JPY)$/i

function parseItalianAmount(raw: string): number {
  const cleaned = raw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

function ddMmYyyyToIso(dd: string, mm: string, yyyy: string): string {
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

function valutaToCode(t: string): string {
  const m = t.toUpperCase()
  if (m === 'EURO') return 'EUR'
  return m
}

export function parseSellaCartaStatement(text: string): SellaCartaParseResult {
  const result: SellaCartaParseResult = {
    periodoFrom: null,
    periodoTo: null,
    totaleUscite: null,
    cartaNumero: null,
    utilizzatore: null,
    categorie: {},
    transactions: [],
    warnings: [],
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // 1) Metadati generali
  for (const line of lines.slice(0, 60)) {
    const m = DATA_RIFERIMENTO_RE.exec(line)
    if (m) {
      const [, dd, mm, yyyy] = m
      // periodo = mese di riferimento (1° → DD/MM/YYYY)
      result.periodoFrom = `${yyyy}-${mm.padStart(2, '0')}-01`
      result.periodoTo = ddMmYyyyToIso(dd, mm, yyyy)
    }
    const c = CARTA_NUMERO_RE.exec(line)
    if (c) result.cartaNumero = c[1]
    const u = UTILIZZATORE_RE.exec(line)
    if (u && !result.utilizzatore) result.utilizzatore = u[1].trim()
  }

  // 2) Categorie totali dalla sezione RIEPILOGO PER CATEGORIE
  // Cerco righe tipo "SPESE VIAGGIO1,50" prima della sezione dettaglio
  let inRiepilogoCat = false
  for (const line of lines.slice(0, 70)) {
    if (/^RIEPILOGO PER CATEGORIE/i.test(line)) {
      inRiepilogoCat = true
      continue
    }
    if (!inRiepilogoCat) continue
    if (/^Si allegano/i.test(line)) break
    if (/^TOTALE([\d.,]+)$/i.test(line)) {
      const tm = TOTALE_GLOBALE_RE.exec(line)
      if (tm) result.totaleUscite = parseItalianAmount(tm[1])
      break
    }
    // Riga categoria: "<NOME>1,50" o "<NOME>1.808,99"
    const m = /^(.+?)([\d]{1,3}(?:\.\d{3})*,\d{2})$/.exec(line)
    if (m) {
      const [, nome, amt] = m
      result.categorie[nome.trim()] = parseItalianAmount(amt)
    }
  }

  // 3) Transazioni dalle sezioni "RIEPILOGO OPERAZIONI <CATEGORIA>"
  let categoriaCorrente: string | null = null
  for (const line of lines) {
    const catH = CATEGORIA_HEADER_RE.exec(line)
    if (catH) {
      categoriaCorrente = catH[1].trim()
      continue
    }
    if (!categoriaCorrente) continue
    if (/^TOTALE/i.test(line)) {
      // Fine sezione categoria — non resetto subito perché può esserci la successiva subito dopo
      continue
    }
    if (/^DATAIMPORTO/i.test(line)) continue
    if (/^DATI DELLA CARTA/i.test(line)) {
      categoriaCorrente = null
      continue
    }

    const m = TRANS_LINE_RE.exec(line)
    if (!m) continue
    const [, dd, mm, yyyy, amt, desc, valuta] = m
    const importoAbs = parseItalianAmount(amt)
    if (!isFinite(importoAbs) || importoAbs <= 0) continue
    const descClean = desc.trim()
    result.transactions.push({
      data: ddMmYyyyToIso(dd, mm, yyyy),
      importo: -importoAbs, // sempre uscita
      importo_abs: importoAbs,
      tipo: 'uscita',
      controparte: descClean.split(/\s+-\s+/)[0].trim() || descClean,
      descrizione: descClean,
      categoria: categoriaCorrente,
      valuta_originale: valutaToCode(valuta) !== 'EUR' ? valutaToCode(valuta) : null,
      importo_originale: null,
      carta: result.cartaNumero,
      raw: line,
    })
  }

  // 4) Validazione totale
  const sum = result.transactions.reduce((s, t) => s + t.importo_abs, 0)
  if (result.totaleUscite !== null && Math.abs(sum - result.totaleUscite) > 0.5) {
    result.warnings.push(`Totale calcolato (${sum.toFixed(2)}) ≠ TOTALE header (${result.totaleUscite.toFixed(2)})`)
  }

  return result
}
