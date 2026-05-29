// Sistema di match intelligente per /api/riconcilia/auto.
//
// Score 0-100 per ogni coppia (fattura, transazione):
//   subject:   max 40  - match nome (esatto / alias DB / alias detect / Levenshtein)
//   reference: max 30  - numero fattura trovato nella causale/riferimento trans
//   amount:    max 20  - importo entro tolleranza adattiva (max(2€, 0.5% totale))
//   date:      max 10  - giorni transazione vs fattura (finestra default -30/+120)
//
// Soglie:
//   AUTO     >= 80  - applica match automaticamente
//   SUGGEST  >= 50  - mostra come suggerimento (necessita LLM o conferma utente)
//   ignora   < 50

import { distance } from 'fastest-levenshtein'

// ============================================================================
// Normalizzazione + alias detection (riutilizzo helper esistenti)
// ============================================================================

export function normalizeName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(srl|spa|snc|sas|srls|sapa|ltd|inc|gmbh|sarl|emea|s r l|s p a)\b/g, '')
    .trim()
}

export function isAliasName(a: string, b: string): boolean {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na]
  if (longer.includes(shorter) && longer.length - shorter.length >= 8) return true
  const wordsA = new Set(na.split(' ').filter(w => w.length > 2))
  const wordsB = new Set(nb.split(' ').filter(w => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return false
  const small = wordsA.size <= wordsB.size ? wordsA : wordsB
  const big = small === wordsA ? wordsB : wordsA
  let common = 0
  small.forEach(w => { if (big.has(w)) common++ })
  return common / small.size >= 0.8
}

export function levenshteinSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const aa = a.toLowerCase().trim()
  const bb = b.toLowerCase().trim()
  if (aa === bb) return 1
  const maxLen = Math.max(aa.length, bb.length)
  if (maxLen === 0) return 1
  return 1 - distance(aa, bb) / maxLen
}

// ============================================================================
// Alias resolver — cerca tra le mappature persistenti in soggetti_alias
// ============================================================================

export interface AliasResolver {
  // Restituisce il soggetto canonico (originalName) per una variant, se nota.
  // Lookup tramite normalize -> canonical.
  resolve(variant: string): string | null
}

export class MapAliasResolver implements AliasResolver {
  // Map normalize(variant) -> canonical denomination
  private map: Map<string, string>
  constructor(entries: Array<{ variant_normalizzata: string; soggetto_canonico: string }>) {
    this.map = new Map()
    for (const e of entries) {
      const key = e.variant_normalizzata.trim().toLowerCase()
      if (!this.map.has(key)) this.map.set(key, e.soggetto_canonico)
    }
  }
  resolve(variant: string): string | null {
    const n = normalizeName(variant)
    return n ? this.map.get(n) ?? null : null
  }
}

// ============================================================================
// Scoring per dimensione
// ============================================================================

// 4.0: numero fattura nella causale/riferimento/note della transazione.
// Es. fattura "FE-2025/00123" e trans con descrizione "BONIFICO RIF 2025/00123".
export function referenceMatchScore(
  fatturaNumero: string | null | undefined,
  transTexts: (string | null | undefined)[],
): number {
  if (!fatturaNumero) return 0
  const num = String(fatturaNumero).trim().toUpperCase()
  if (!num) return 0
  const text = transTexts.filter(Boolean).join(' | ').toUpperCase()
  if (!text) return 0

  // 1) Match esatto del numero completo nella causale
  if (num.length >= 3 && text.includes(num)) return 1.0

  // 2) Run di 4+ cifre del numero
  const digitRuns = num.match(/\d{4,}/g) || []
  for (const d of digitRuns) {
    if (text.includes(d)) return 0.85
  }

  // 3) Ultime 4 cifre del numero (evitando "0000" / "9999" e simili banali)
  const allDigits = num.replace(/\D/g, '')
  if (allDigits.length >= 4) {
    const last4 = allDigits.slice(-4)
    if (!/^(.)\1+$/.test(last4) && text.includes(last4)) return 0.5
  }

  return 0
}

// 4.1: importo con tolleranza adattiva.
// Tolleranza = max(2€, 0.5% del totale fattura). Score graduale dentro.
export function adaptiveAmountTolerance(fatturaTotale: number): number {
  return Math.max(2, Math.abs(fatturaTotale) * 0.005)
}

export function amountMatchScore(fatturaTotale: number, transImporto: number): number {
  const diff = Math.abs(Math.abs(fatturaTotale) - Math.abs(transImporto))
  const tolerance = adaptiveAmountTolerance(fatturaTotale)
  if (diff <= tolerance) {
    // 1.0 al match perfetto, 0.9 al limite della tolleranza
    return 1.0 - (diff / tolerance) * 0.1
  }
  if (diff <= tolerance * 3) {
    // Decremento lineare da 0.7 a 0.2
    return 0.7 - 0.5 * ((diff - tolerance) / (tolerance * 2))
  }
  if (diff <= tolerance * 6) return 0.2
  return 0
}

// 4.2: data — quanti giorni separa la trans dalla fattura (asimmetrico).
export function dateMatchScore(
  fatturaData: string,
  transData: string,
  options?: { minDays?: number; maxDays?: number },
): number {
  const minDays = options?.minDays ?? -30
  const maxDays = options?.maxDays ?? 120
  const days = (new Date(transData).getTime() - new Date(fatturaData).getTime()) / (1000 * 60 * 60 * 24)
  if (days < minDays || days > maxDays) return 0
  // Score: massimo al centro della finestra, decresce ai bordi (min 0.3)
  const center = (minDays + maxDays) / 2
  const half = (maxDays - minDays) / 2
  const dist = Math.abs(days - center) / half
  return Math.max(0.3, 1 - dist * 0.7)
}

// 4.3: soggetto — combinazione di alias resolver + detection + Levenshtein.
export function subjectMatchScore(
  fatturaSoggetto: string,
  transControparte: string,
  aliasResolver?: AliasResolver,
): { score: number; reason: string } {
  if (!fatturaSoggetto || !transControparte) return { score: 0, reason: 'mancante' }
  const fNorm = normalizeName(fatturaSoggetto)
  const tNorm = normalizeName(transControparte)

  // 1) Esatto normalizzato
  if (fNorm && fNorm === tNorm) return { score: 1.0, reason: 'esatto' }

  // 2) Alias persistente in DB
  if (aliasResolver) {
    const tCanonical = aliasResolver.resolve(transControparte)
    if (tCanonical && normalizeName(tCanonical) === fNorm) return { score: 0.95, reason: 'alias DB' }
    const fCanonical = aliasResolver.resolve(fatturaSoggetto)
    if (fCanonical && normalizeName(fCanonical) === tNorm) return { score: 0.95, reason: 'alias DB' }
  }

  // 3) Alias detection (substring lunga / 80% parole)
  if (isAliasName(fatturaSoggetto, transControparte)) return { score: 0.85, reason: 'alias auto' }

  // 4) Levenshtein
  const sim = levenshteinSimilarity(fatturaSoggetto, transControparte)
  if (sim >= 0.85) return { score: sim * 0.9, reason: `lev ${Math.round(sim * 100)}%` }
  if (sim >= 0.75) return { score: 0.65, reason: `lev ${Math.round(sim * 100)}%` }
  if (sim >= 0.5) return { score: 0.35, reason: `lev ${Math.round(sim * 100)}%` }

  return { score: 0, reason: 'no match' }
}

// ============================================================================
// Score combinato
// ============================================================================

export const SCORE_WEIGHTS = { subject: 40, reference: 30, amount: 20, date: 10 } as const
export const SCORE_AUTO_THRESHOLD = 80
export const SCORE_SUGGEST_THRESHOLD = 50

export interface FatturaForMatch {
  id: string
  numero: string | null
  tipo: string
  totale: number
  data_emissione: string
  denominazione_fornitore?: string | null
  denominazione_cliente?: string | null
}

export interface TransForMatch {
  id: string
  tipo: string
  importo: number
  data: string
  controparte: string | null
  descrizione: string | null
  riferimento?: string | null
  note?: string | null
}

export interface ScoreBreakdown {
  subjectScore: number
  subjectReason: string
  referenceScore: number
  amountScore: number
  dateScore: number
  totalScore: number
}

export function getSoggetto(fattura: FatturaForMatch): string {
  if (fattura.tipo === 'ricevuta') return fattura.denominazione_fornitore || ''
  return fattura.denominazione_cliente || ''
}

export function tipoCoherent(fattura: FatturaForMatch, trans: TransForMatch): boolean {
  return (
    (fattura.tipo === 'ricevuta' && trans.tipo === 'uscita') ||
    (fattura.tipo === 'emessa' && trans.tipo === 'entrata')
  )
}

export interface MatchOptions {
  aliasResolver?: AliasResolver
  // Finestra date personalizzata per il soggetto (da match_history).
  // Se assente, usa la finestra default -30/+120.
  dateWindow?: { minDays: number; maxDays: number }
}

export function computeMatchScore(
  fattura: FatturaForMatch,
  trans: TransForMatch,
  opts?: MatchOptions,
): ScoreBreakdown {
  if (!tipoCoherent(fattura, trans)) {
    return { subjectScore: 0, subjectReason: 'tipo incoerente', referenceScore: 0, amountScore: 0, dateScore: 0, totalScore: 0 }
  }
  const soggetto = getSoggetto(fattura)
  const { score: subjectScore, reason: subjectReason } = subjectMatchScore(soggetto, trans.controparte || '', opts?.aliasResolver)
  const referenceScore = referenceMatchScore(fattura.numero, [trans.descrizione, trans.riferimento, trans.note])
  const amountScore = amountMatchScore(fattura.totale, trans.importo)
  const dateScore = dateMatchScore(fattura.data_emissione, trans.data, opts?.dateWindow)
  const totalScore =
    SCORE_WEIGHTS.subject * subjectScore +
    SCORE_WEIGHTS.reference * referenceScore +
    SCORE_WEIGHTS.amount * amountScore +
    SCORE_WEIGHTS.date * dateScore
  return { subjectScore, subjectReason, referenceScore, amountScore, dateScore, totalScore }
}
