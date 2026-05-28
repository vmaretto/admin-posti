import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { normalizeSubject } from '@/lib/normalize'
import type { Fattura, Transazione } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface MatchDetail {
  fattura_ids: string[]
  transazione_id: string
  importo_fatture: number
  importo_transazione: number
  soggetto: string
  differenza: number
}

interface MatchResult {
  matched: number
  details: MatchDetail[]
}

// -------- helpers --------

// Calcola se la data transazione è nel range valido rispetto alla fattura
function isDateInRange(dataFattura: string, dataTransazione: string): boolean {
  const fattura = new Date(dataFattura)
  const transazione = new Date(dataTransazione)
  const diffDays = (transazione.getTime() - fattura.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays >= -30 && diffDays <= 120
}

// Estrae il soggetto dalla fattura (fornitore per ricevute, cliente per emesse)
function getSoggetto(fattura: Fattura): string {
  if (fattura.tipo === 'ricevuta') {
    return fattura.denominazione_fornitore || ''
  }
  return fattura.denominazione_cliente || ''
}

// Verifica se a è un "alias" di b (uno contiene l'altro come sottostringa o
// hanno ≥80% di parole significative in comune). Stessa logica usata in
// /api/soggetti per accoppiare es. "LA PECORA NERA EDITORE DI CARGIANI SIMON"
// con "La Pecora Nera Editore".
function isAliasName(a: string, b: string): boolean {
  const na = normalizeSubject(a)
  const nb = normalizeSubject(b)
  if (!na || !nb) return false
  if (na === nb) return true

  // Sottostringa: il più lungo contiene il più corto (se gap ≥ 8 chars).
  const [shortStr, longStr] = na.length <= nb.length ? [na, nb] : [nb, na]
  if (longStr.includes(shortStr) && longStr.length - shortStr.length >= 8) {
    return true
  }

  // Overlap parole significative ≥ 80%
  const wordsA = new Set(na.split(' ').filter(w => w.length > 2))
  const wordsB = new Set(nb.split(' ').filter(w => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return false
  const small = wordsA.size <= wordsB.size ? wordsA : wordsB
  const big = small === wordsA ? wordsB : wordsA
  let common = 0
  small.forEach(w => { if (big.has(w)) common++ })
  return common / small.size >= 0.8
}

// Fetch paginato per superare il limite Supabase di 1000 righe per query.
// `builder` deve restituire, ogni volta che viene chiamato, una nuova query
// pronta per ricevere `.range(from, to)`.
async function fetchAllPaginated<T = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: () => any,
): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  let from = 0
  for (let safety = 0; safety < 100; safety++) {
    const q = builder()
    const { data, error } = await q.range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...(data as T[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

// -------- core logic --------

// Trova tutti i match automatici, opzionalmente filtrando per periodo
// (le trans devono cadere nel range; le fatture sono volutamente prese
// senza filtro perché un pagamento può riferirsi a una fattura più vecchia,
// e il range date-fattura↔data-trans di −30/+120gg è già una guardia naturale).
async function findAutoMatches(
  supabase: ReturnType<typeof createServerClient>,
  range?: { from: string; to: string },
): Promise<MatchDetail[]> {
  // Carica TUTTE le fatture da riconciliare (paginate per superare i 1000)
  const fatture: Fattura[] = await fetchAllPaginated<Fattura>(() =>
    supabase
      .from('fatture')
      .select('*')
      .eq('stato_riconciliazione', 'da_riconciliare')
      .is('transazione_id', null)
      .order('created_at', { ascending: true }),
  )

  // Carica le transazioni da riconciliare. Se c'è un periodo, filtro sulle
  // trans (è il "campo di azione" del wizard).
  const transazioni: Transazione[] = await fetchAllPaginated<Transazione>(() => {
    let q = supabase
      .from('transazioni')
      .select('*')
      .eq('stato_riconciliazione', 'da_riconciliare')
      .order('created_at', { ascending: true })
    if (range) {
      q = q.gte('data', range.from).lte('data', range.to)
    }
    return q
  })

  if (!fatture.length || !transazioni.length) {
    return []
  }

  const matches: MatchDetail[] = []
  const usedTransazioni = new Set<string>()
  const usedFatture = new Set<string>()

  // Raggruppa fatture per soggetto normalizzato (per il match esatto rapido).
  const fattureBySubject = new Map<string, Fattura[]>()
  for (const f of fatture) {
    const soggetto = getSoggetto(f)
    if (!soggetto) continue
    const normalized = normalizeSubject(soggetto)
    if (!normalized) continue
    const list = fattureBySubject.get(normalized) || []
    list.push(f)
    fattureBySubject.set(normalized, list)
  }

  // Per ogni transazione, cerca match (esatto + alias come fallback).
  for (const trans of transazioni) {
    if (usedTransazioni.has(trans.id)) continue
    if (!trans.controparte) continue

    const normalizedControparte = normalizeSubject(trans.controparte)
    if (!normalizedControparte) continue

    // 1) Match esatto sul nome normalizzato
    let fattureCandidate: Fattura[] = fattureBySubject.get(normalizedControparte) || []

    // 2) Fallback alias: scorri le chiavi del map e prendi quelle "alias" della
    //    controparte. Unisci tutto in un unico pool di candidate.
    if (fattureCandidate.length === 0) {
      const aliasPool: Fattura[] = []
      for (const [key, list] of fattureBySubject.entries()) {
        if (key === normalizedControparte) continue
        // Controlla l'alias sul nome del soggetto della prima fattura (display
        // originale) per coerenza con la logica di /api/soggetti.
        const sampleSoggetto = getSoggetto(list[0])
        if (isAliasName(trans.controparte, sampleSoggetto)) {
          aliasPool.push(...list)
        }
      }
      fattureCandidate = aliasPool
    }

    if (!fattureCandidate.length) continue

    // Filtra fatture non ancora usate, con data e tipo compatibili.
    const fattureValide = fattureCandidate.filter(
      f =>
        !usedFatture.has(f.id) &&
        isDateInRange(f.data_emissione, trans.data) &&
        ((f.tipo === 'ricevuta' && trans.tipo === 'uscita') ||
          (f.tipo === 'emessa' && trans.tipo === 'entrata')),
    )

    if (!fattureValide.length) continue

    // Match 1:1 (unico candidato compatibile sull'importo)
    const candidatiImporto = fattureValide.filter(
      f => Math.abs(f.totale - Math.abs(trans.importo)) <= 2,
    )

    if (candidatiImporto.length === 1) {
      const match1to1 = candidatiImporto[0]
      matches.push({
        fattura_ids: [match1to1.id],
        transazione_id: trans.id,
        importo_fatture: match1to1.totale,
        importo_transazione: Math.abs(trans.importo),
        soggetto: getSoggetto(match1to1),
        differenza: Math.abs(match1to1.totale - Math.abs(trans.importo)),
      })
      usedTransazioni.add(trans.id)
      usedFatture.add(match1to1.id)
      continue
    }

    // Match N:1 — combinazioni di fatture la cui somma ≈ importo transazione.
    const sorted = [...fattureValide].sort(
      (a, b) => new Date(a.data_emissione).getTime() - new Date(b.data_emissione).getTime(),
    )

    const maxFatture = Math.min(sorted.length, 10)
    let found = false

    for (let mask = 1; mask < 1 << maxFatture && !found; mask++) {
      const combo: Fattura[] = []
      for (let i = 0; i < maxFatture; i++) {
        if (mask & (1 << i)) combo.push(sorted[i])
      }
      if (combo.length < 2) continue

      const somma = combo.reduce((acc, f) => acc + f.totale, 0)
      if (Math.abs(somma - Math.abs(trans.importo)) <= 2) {
        matches.push({
          fattura_ids: combo.map(f => f.id),
          transazione_id: trans.id,
          importo_fatture: somma,
          importo_transazione: Math.abs(trans.importo),
          soggetto: getSoggetto(combo[0]),
          differenza: Math.abs(somma - Math.abs(trans.importo)),
        })
        usedTransazioni.add(trans.id)
        combo.forEach(f => usedFatture.add(f.id))
        found = true
      }
    }
  }

  return matches
}

// -------- HTTP handlers --------

function parseRange(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  return from && to ? { from, to } : undefined
}

// GET: Preview dei match automatici
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const matches = await findAutoMatches(supabase, parseRange(request))

    return NextResponse.json({
      matched: matches.length,
      details: matches.map(m => ({
        fattura_ids: m.fattura_ids,
        transazione_id: m.transazione_id,
        importo_fatture: m.importo_fatture,
        importo_transazione: m.importo_transazione,
        soggetto: m.soggetto,
        differenza: m.differenza,
      })),
    } as MatchResult)
  } catch (error) {
    console.error('Errore auto-match preview:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Errore sconosciuto' },
      { status: 500 },
    )
  }
}

// POST: Esegue i match automatici
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const matches = await findAutoMatches(supabase, parseRange(request))

    if (!matches.length) {
      return NextResponse.json({ matched: 0, details: [] })
    }

    for (const match of matches) {
      // Update fatture: tutte le N fatture del match puntano alla stessa transazione
      const { error: errFatture } = await supabase
        .from('fatture')
        .update({
          transazione_id: match.transazione_id,
          stato_riconciliazione: 'riconciliata',
        })
        .in('id', match.fattura_ids)

      if (errFatture) {
        console.error(`Errore update fatture ${match.fattura_ids}:`, errFatture)
        continue
      }

      // Inserisci in riconciliazioni (una riga per fattura, transazione condivisa).
      // Usa upsert per essere idempotente in caso di rilancio.
      const rows = match.fattura_ids.map(fid => ({
        fattura_id: fid,
        transazione_id: match.transazione_id,
      }))
      const { error: errRic } = await supabase
        .from('riconciliazioni')
        .upsert(rows, { onConflict: 'fattura_id' })
      if (errRic) {
        console.error(`Errore upsert riconciliazioni ${match.fattura_ids}:`, errRic)
      }

      // Update transazione
      const { error: errTrans } = await supabase
        .from('transazioni')
        .update({ stato_riconciliazione: 'riconciliata' })
        .eq('id', match.transazione_id)

      if (errTrans) {
        console.error(`Errore update transazione ${match.transazione_id}:`, errTrans)
      }
    }

    return NextResponse.json({
      matched: matches.length,
      details: matches.map(m => ({
        fattura_ids: m.fattura_ids,
        transazione_id: m.transazione_id,
        importo_fatture: m.importo_fatture,
        importo_transazione: m.importo_transazione,
        soggetto: m.soggetto,
        differenza: m.differenza,
      })),
    } as MatchResult)
  } catch (error) {
    console.error('Errore auto-match:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Errore sconosciuto' },
      { status: 500 },
    )
  }
}
