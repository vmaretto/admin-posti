// Parser CSV PayPal Business (export Italian locale).
//
// Esempio header reale (con BOM UTF-8 davanti):
//   "Data","Orario","Fuso orario","Nome","Tipo","Stato","Valuta","Lordo",
//   "Tariffa","Netto","Indirizzo email mittente","Indirizzo email destinatario",
//   "Codice transazione","Titolo oggetto","Codice transazione di riferimento",
//   ...
//
// Note:
//   - Encoding: BOM UTF-8 all'inizio del file (﻿). Va rimosso.
//   - Importi: formato italiano "19,00" / "-19,00".
//   - Per ogni pagamento ci sono spesso 2 righe (movimento + "Bonifico bancario
//     sul conto PayPal" in stato "In sospeso") — quest'ultima è solo un riflesso
//     del trasferimento al conto bancario, va skippata altrimenti contiamo
//     l'importo due volte.

export interface PayPalRow {
  data: string // YYYY-MM-DD
  importo: number // segnato
  importo_abs: number
  tipo: 'entrata' | 'uscita'
  controparte: string
  descrizione: string
  riferimento: string | null // codice transazione PayPal
  riferimentoOrig: string | null // codice transazione di riferimento
  emailContraente: string | null
  raw: string
}

export interface PayPalParseResult {
  periodoFrom: string | null
  periodoTo: string | null
  totaleEntrate: number | null
  totaleUscite: number | null
  transactions: PayPalRow[]
  warnings: string[]
}

function parsePaypalAmount(raw: string): number {
  const cleaned = raw.replace(/['"]/g, '').replace(/\s/g, '')
  // PayPal usa formato italiano: "19,00", "-1.234,56"
  // Rimuovi i punti (migliaia) e sostituisci virgola con punto
  const norm = cleaned.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(norm)
  return isNaN(n) ? 0 : n
}

function ddMmYyyyToIso(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim())
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

// Rimuove BOM UTF-8 se presente
function stripBOM(s: string): string {
  return s.replace(/^﻿/, '')
}

// Parsing di una riga CSV con quote (gestisce "" come escape della quote)
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQ = !inQ
      }
    } else if (ch === ',' && !inQ) {
      result.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result
}

function cleanString(s: string): string {
  return (s || '').replace(/^['"]|['"]$/g, '').trim()
}

export function parsePayPalCSV(csv: string): PayPalParseResult {
  const result: PayPalParseResult = {
    periodoFrom: null,
    periodoTo: null,
    totaleEntrate: null,
    totaleUscite: null,
    transactions: [],
    warnings: [],
  }

  const cleaned = stripBOM(csv)
  const lines = cleaned.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) {
    result.warnings.push('CSV vuoto o solo header.')
    return result
  }

  const headers = parseCSVLine(lines[0]).map(h => cleanString(h).toLowerCase())
  const idx = (name: string) => headers.findIndex(h => h === name.toLowerCase())
  const idxLike = (predicate: (h: string) => boolean) => headers.findIndex(predicate)

  const iData = idx('data')
  const iNome = idx('nome')
  const iTipo = idx('tipo')
  const iStato = idx('stato')
  const iNetto = idx('netto')
  const iLordo = idx('lordo')
  const iCodice = idxLike(h => h.includes('codice transazione') && !h.includes('riferimento'))
  const iCodiceRif = idxLike(h => h.includes('codice transazione') && h.includes('riferimento'))
  const iTitolo = idxLike(h => h.includes('titolo oggetto'))
  const iEmailMittente = idxLike(h => h.includes('email mittente'))
  const iEmailDest = idxLike(h => h.includes('email destinatario'))

  if (iData < 0) {
    result.warnings.push('Colonna "Data" non trovata — header forse non standard.')
    return result
  }

  const datesIso: string[] = []
  let sumEntrate = 0
  let sumUscite = 0

  for (let i = 1; i < lines.length; i++) {
    try {
      const v = parseCSVLine(lines[i])
      const stato = cleanString(v[iStato] || '').toLowerCase()
      const tipo = cleanString(v[iTipo] || '').toLowerCase()

      // Skippa:
      //  - righe "In sospeso" (in attesa)
      //  - righe "Bonifico bancario sul conto PayPal" (è solo il riflesso
      //    interno del movimento già contato dalla riga del pagamento)
      if (stato.includes('sospeso')) continue
      if (tipo.includes('bonifico bancario')) continue

      const dataIso = ddMmYyyyToIso(cleanString(v[iData] || ''))
      if (!dataIso) continue

      const nettoStr = cleanString(v[iNetto] || v[iLordo] || '0')
      const importo = parsePaypalAmount(nettoStr)
      if (importo === 0) continue

      const importoAbs = Math.abs(importo)
      const isEntrata = importo > 0
      if (isEntrata) sumEntrate += importoAbs
      else sumUscite += importoAbs

      const controparte = cleanString(v[iNome] || '') || (iEmailMittente >= 0 && importo > 0
        ? cleanString(v[iEmailMittente] || '')
        : iEmailDest >= 0 ? cleanString(v[iEmailDest] || '') : '')

      result.transactions.push({
        data: dataIso,
        importo,
        importo_abs: importoAbs,
        tipo: isEntrata ? 'entrata' : 'uscita',
        controparte: controparte || cleanString(v[iTipo] || '') || 'PayPal',
        descrizione: cleanString(v[iTitolo] || v[iTipo] || ''),
        riferimento: cleanString(v[iCodice] || '') || null,
        riferimentoOrig: cleanString(v[iCodiceRif] || '') || null,
        emailContraente: importo > 0
          ? cleanString(v[iEmailMittente] || '') || null
          : cleanString(v[iEmailDest] || '') || null,
        raw: lines[i],
      })
      datesIso.push(dataIso)
    } catch (e) {
      result.warnings.push(`Riga ${i + 1} non parsata: ${e instanceof Error ? e.message : 'errore'}`)
    }
  }

  if (datesIso.length > 0) {
    const sorted = [...datesIso].sort()
    result.periodoFrom = sorted[0]
    result.periodoTo = sorted[sorted.length - 1]
  }
  result.totaleEntrate = sumEntrate
  result.totaleUscite = sumUscite

  return result
}
