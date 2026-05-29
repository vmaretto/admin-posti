// Parser CSV fatture SDI (cassetto fiscale Agenzia delle Entrate).
// Formato osservato:
//   - Separatore: ;
//   - Line endings: \r\n (Windows)
//   - Valori in apici doppi, alcuni con apici singoli interni:
//     "'F-2026-20'", "'14791521009'"
//   - Importi formato SDI con zero-padding: "000000015000,00" -> 15000.00
//   - Date: DD/MM/YYYY
//   - Tipo documento: "Fattura", "Nota di credito"
//
// Header reale (emesse + ricevute hanno lo stesso schema, l'unica
// differenza pratica e' che "Data consegna/Presa visione" diventa
// "Data ricezione" per le ricevute):
//   Tipo fattura; Tipo documento; Numero fattura / Documento;
//   Data emissione; Data trasmissione; Codice fiscale fornitore;
//   Partita IVA fornitore; Denominazione fornitore;
//   Codice fiscale cliente; Partita IVA cliente; Denominazione cliente;
//   Imponibile/Importo (totale in euro); Imposta (totale in euro);
//   Sdi/file; Fatture consegnate; Data consegna/Presa visione [|Data ricezione];
//   Bollo virtuale

export type SdiTipo = 'emessa' | 'ricevuta'

export interface SdiFattura {
  tipo: SdiTipo
  tipo_documento: 'fattura' | 'nota_credito'
  numero: string
  data_emissione: string // YYYY-MM-DD
  data_ricezione: string | null
  piva_fornitore: string | null
  denominazione_fornitore: string | null
  piva_cliente: string | null
  denominazione_cliente: string | null
  imponibile: number
  imposta: number
  totale: number
  sdi_file: string | null
  raw: string
}

export interface SdiParseResult {
  periodoFrom: string | null
  periodoTo: string | null
  totale: number | null
  fatture: SdiFattura[]
  warnings: string[]
}

function stripQuotes(s: string): string {
  // Rimuove doppi apici esterni e (se presente) apici singoli interni.
  // Es. "'F-2026-20'" -> F-2026-20
  let t = (s || '').trim()
  if (t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1)
  if (t.startsWith("'") && t.endsWith("'")) t = t.slice(1, -1)
  return t.trim()
}

function parseSDIAmount(raw: string): number {
  // "000000015000,00" -> 15000.00
  // "000000000968,00" -> 968.00
  const cleaned = stripQuotes(raw).replace(/^0+/, '') || '0'
  // Italian decimal comma
  const n = parseFloat(cleaned.replace(',', '.'))
  return isNaN(n) ? 0 : n
}

function parseSDIDate(raw: string): string | null {
  const cleaned = stripQuotes(raw)
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cleaned)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

// Parsing CSV line con separatore ';' (i valori SDI non contengono ; quotato,
// e gli apici doppi non si dovrebbero ripetere — splittare con ';' va bene)
function splitSDILine(line: string): string[] {
  return line.split(';')
}

export function parseSdiCSV(csv: string, tipo: SdiTipo): SdiParseResult {
  const result: SdiParseResult = {
    periodoFrom: null,
    periodoTo: null,
    totale: null,
    fatture: [],
    warnings: [],
  }

  // Normalizza line endings + rimuovi BOM se presente
  const clean = csv.replace(/^﻿/, '').replace(/\r/g, '')
  const lines = clean.split('\n').filter(l => l.trim())
  if (lines.length < 2) {
    result.warnings.push('CSV vuoto o solo header.')
    return result
  }

  const headers = splitSDILine(lines[0]).map(h => stripQuotes(h).toLowerCase())
  const idxOf = (predicate: (h: string) => boolean) => headers.findIndex(predicate)

  const iTipoDoc = idxOf(h => h.includes('tipo documento'))
  const iNumero = idxOf(h => h.includes('numero') && (h.includes('fattura') || h.includes('documento')))
  const iDataEm = idxOf(h => h.includes('data emissione'))
  const iDataRic = idxOf(h => h.includes('data consegna') || h.includes('data ricezione'))
  const iPivaForn = idxOf(h => h.includes('partita iva fornitore'))
  const iDenForn = idxOf(h => h.includes('denominazione fornitore'))
  const iPivaCli = idxOf(h => h.includes('partita iva cliente'))
  const iDenCli = idxOf(h => h.includes('denominazione cliente'))
  const iImponibile = idxOf(h => h.includes('imponibile'))
  const iImposta = idxOf(h => h.includes('imposta'))
  const iSdiFile = idxOf(h => h.includes('sdi/file'))

  if (iNumero < 0 || iDataEm < 0) {
    result.warnings.push('Header non riconosciuto: mancano "Numero fattura" o "Data emissione".')
    return result
  }

  const datesIso: string[] = []
  let totaleSum = 0
  for (let i = 1; i < lines.length; i++) {
    try {
      const v = splitSDILine(lines[i])
      const tipoDoc = stripQuotes(v[iTipoDoc] || '').toLowerCase()
      const isNotaCredito = tipoDoc.includes('credito')
      const numero = stripQuotes(v[iNumero] || '')
      const dataEm = parseSDIDate(v[iDataEm] || '')
      if (!numero || !dataEm) continue

      const imponibile = parseSDIAmount(v[iImponibile] || '0')
      const imposta = parseSDIAmount(v[iImposta] || '0')
      // Arrotonda al centesimo per evitare problemi floating point (es. 273.21999...)
      const totaleRiga = Math.round((imponibile + imposta) * 100) / 100
      // Per le note di credito segno negativo del totale (riducono il credito/debito)
      const signedTot = isNotaCredito ? -Math.abs(totaleRiga) : Math.abs(totaleRiga)
      totaleSum += signedTot

      const fatt: SdiFattura = {
        tipo,
        tipo_documento: isNotaCredito ? 'nota_credito' : 'fattura',
        numero,
        data_emissione: dataEm,
        data_ricezione: parseSDIDate(v[iDataRic] || ''),
        piva_fornitore: stripQuotes(v[iPivaForn] || '') || null,
        denominazione_fornitore: stripQuotes(v[iDenForn] || '') || null,
        piva_cliente: stripQuotes(v[iPivaCli] || '') || null,
        denominazione_cliente: stripQuotes(v[iDenCli] || '') || null,
        imponibile,
        imposta,
        totale: totaleRiga,
        sdi_file: stripQuotes(v[iSdiFile] || '') || null,
        raw: lines[i],
      }
      result.fatture.push(fatt)
      datesIso.push(dataEm)
    } catch (e) {
      result.warnings.push(`Riga ${i + 1} non parsata: ${e instanceof Error ? e.message : 'errore'}`)
    }
  }

  if (datesIso.length > 0) {
    const sorted = [...datesIso].sort()
    result.periodoFrom = sorted[0]
    result.periodoTo = sorted[sorted.length - 1]
  }
  result.totale = totaleSum

  return result
}
