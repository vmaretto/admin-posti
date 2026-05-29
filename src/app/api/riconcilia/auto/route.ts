import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import type { Fattura, Transazione } from '@/lib/types'
import {
  MapAliasResolver,
  computeMatchScore,
  getSoggetto,
  tipoCoherent,
  adaptiveAmountTolerance,
  SCORE_AUTO_THRESHOLD,
  SCORE_SUGGEST_THRESHOLD,
  ScoreBreakdown,
  FatturaForMatch,
  TransForMatch,
  normalizeName,
} from '@/lib/matching'

export const dynamic = 'force-dynamic'

interface MatchDetail {
  fattura_ids: string[]
  transazione_id: string
  importo_fatture: number
  importo_transazione: number
  soggetto: string
  differenza: number
  score?: number
  scoreBreakdown?: ScoreBreakdown
}

interface SuggestionDetail extends MatchDetail {
  fatture_label?: string[]
}

interface MatchResult {
  matched: number
  suggested: number
  details: MatchDetail[]
  suggestions: SuggestionDetail[]
}

// ----- Fetch paginato -----
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

function parseRange(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  return from && to ? { from, to } : undefined
}

// ============================================================================
// Core: trova match con il nuovo scoring system
// ============================================================================
async function findAutoMatches(
  supabase: ReturnType<typeof createServerClient>,
  range?: { from: string; to: string },
): Promise<{ matches: MatchDetail[]; suggestions: SuggestionDetail[] }> {
  // 1) Carica fatture e trans da riconciliare
  const fatture: Fattura[] = await fetchAllPaginated<Fattura>(() =>
    supabase
      .from('fatture')
      .select('*')
      .eq('stato_riconciliazione', 'da_riconciliare')
      .is('transazione_id', null)
      .order('created_at', { ascending: true }),
  )

  const transazioni: Transazione[] = await fetchAllPaginated<Transazione>(() => {
    let q = supabase
      .from('transazioni')
      .select('*')
      .eq('stato_riconciliazione', 'da_riconciliare')
      .order('created_at', { ascending: true })
    if (range) q = q.gte('data', range.from).lte('data', range.to)
    return q
  })

  if (!fatture.length || !transazioni.length) {
    return { matches: [], suggestions: [] }
  }

  // 2) Carica alias table (con fallback se non esiste ancora)
  const { data: aliasRows } = await supabase
    .from('soggetti_alias')
    .select('variant_normalizzata, soggetto_canonico')
  const aliasResolver = new MapAliasResolver(aliasRows || [])

  // 3) Pass 1 — 1:1 con scoring
  const matches: MatchDetail[] = []
  const suggestions: SuggestionDetail[] = []
  const usedFatture = new Set<string>()
  const usedTransazioni = new Set<string>()

  // Per ogni transazione, calcola lo score con tutte le fatture compatibili
  // sul tipo, e prendi la migliore.
  for (const trans of transazioni) {
    if (usedTransazioni.has(trans.id)) continue
    if (!trans.controparte && !trans.descrizione) continue

    let bestFat: Fattura | null = null
    let bestScore: ScoreBreakdown | null = null

    for (const f of fatture) {
      if (usedFatture.has(f.id)) continue
      if (!tipoCoherent(f as FatturaForMatch, trans as TransForMatch)) continue
      // Skip se la trans è chiaramente fuori range data per questa fattura
      const days = (new Date(trans.data).getTime() - new Date(f.data_emissione).getTime()) / (1000 * 60 * 60 * 24)
      if (days < -60 || days > 240) continue // pre-filter generoso

      const breakdown = computeMatchScore(f as FatturaForMatch, trans as TransForMatch, aliasResolver)
      if (!bestScore || breakdown.totalScore > bestScore.totalScore) {
        bestScore = breakdown
        bestFat = f
      }
    }

    if (!bestFat || !bestScore) continue

    if (bestScore.totalScore >= SCORE_AUTO_THRESHOLD) {
      matches.push({
        fattura_ids: [bestFat.id],
        transazione_id: trans.id,
        importo_fatture: bestFat.totale,
        importo_transazione: Math.abs(trans.importo),
        soggetto: getSoggetto(bestFat as FatturaForMatch),
        differenza: Math.abs(bestFat.totale - Math.abs(trans.importo)),
        score: Math.round(bestScore.totalScore),
        scoreBreakdown: bestScore,
      })
      usedFatture.add(bestFat.id)
      usedTransazioni.add(trans.id)
    } else if (bestScore.totalScore >= SCORE_SUGGEST_THRESHOLD) {
      // Salva come suggerimento — NON modifica DB
      suggestions.push({
        fattura_ids: [bestFat.id],
        transazione_id: trans.id,
        importo_fatture: bestFat.totale,
        importo_transazione: Math.abs(trans.importo),
        soggetto: getSoggetto(bestFat as FatturaForMatch),
        differenza: Math.abs(bestFat.totale - Math.abs(trans.importo)),
        score: Math.round(bestScore.totalScore),
        scoreBreakdown: bestScore,
        fatture_label: [bestFat.numero],
      })
    }
  }

  // 4) Pass 2 — N:1 sui residui (riusa la logica precedente con tolleranza adattiva)
  const fattureBySubject = new Map<string, Fattura[]>()
  for (const f of fatture) {
    if (usedFatture.has(f.id)) continue
    const soggetto = getSoggetto(f as FatturaForMatch)
    if (!soggetto) continue
    const key = normalizeName(soggetto)
    if (!key) continue
    const list = fattureBySubject.get(key) || []
    list.push(f)
    fattureBySubject.set(key, list)
  }

  for (const trans of transazioni) {
    if (usedTransazioni.has(trans.id)) continue
    if (!trans.controparte) continue
    const normalizedControparte = normalizeName(trans.controparte)
    if (!normalizedControparte) continue

    let pool: Fattura[] = fattureBySubject.get(normalizedControparte) || []
    if (pool.length < 2) {
      // Prova alias resolver per trovare il soggetto canonico
      const canonical = aliasResolver.resolve(trans.controparte)
      if (canonical) {
        const canonKey = normalizeName(canonical)
        const poolCanonical = fattureBySubject.get(canonKey) || []
        if (poolCanonical.length >= 2) pool = poolCanonical
      }
    }
    if (pool.length < 2) continue

    // Filtra per tipo + finestra date generosa
    const fattureValide = pool.filter(f => {
      if (usedFatture.has(f.id)) return false
      if (!tipoCoherent(f as FatturaForMatch, trans as TransForMatch)) return false
      const days = (new Date(trans.data).getTime() - new Date(f.data_emissione).getTime()) / (1000 * 60 * 60 * 24)
      return days >= -30 && days <= 120
    })
    if (fattureValide.length < 2) continue

    // Cerca combinazione che somma ~ importo trans (tolleranza adattiva sulla somma totale)
    const sorted = [...fattureValide].sort(
      (a, b) => new Date(a.data_emissione).getTime() - new Date(b.data_emissione).getTime(),
    )
    const maxFatture = Math.min(sorted.length, 10)
    let found = false
    for (let mask = 1; mask < (1 << maxFatture) && !found; mask++) {
      const combo: Fattura[] = []
      for (let i = 0; i < maxFatture; i++) {
        if (mask & (1 << i)) combo.push(sorted[i])
      }
      if (combo.length < 2) continue
      const somma = combo.reduce((acc, f) => acc + f.totale, 0)
      const tolerance = adaptiveAmountTolerance(somma)
      if (Math.abs(somma - Math.abs(trans.importo)) <= tolerance) {
        matches.push({
          fattura_ids: combo.map(f => f.id),
          transazione_id: trans.id,
          importo_fatture: somma,
          importo_transazione: Math.abs(trans.importo),
          soggetto: getSoggetto(combo[0] as FatturaForMatch),
          differenza: Math.abs(somma - Math.abs(trans.importo)),
        })
        usedTransazioni.add(trans.id)
        combo.forEach(f => usedFatture.add(f.id))
        found = true
      }
    }
  }

  return { matches, suggestions }
}

// ============================================================================
// HTTP handlers
// ============================================================================

// GET: Preview match auto e suggerimenti (non scrive DB)
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { matches, suggestions } = await findAutoMatches(supabase, parseRange(request))
    return NextResponse.json({
      matched: matches.length,
      suggested: suggestions.length,
      details: matches,
      suggestions,
    } as MatchResult)
  } catch (error) {
    console.error('Errore auto-match preview:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Errore sconosciuto' },
      { status: 500 },
    )
  }
}

// POST: Esegue match >= SCORE_AUTO_THRESHOLD. Restituisce anche i suggestions.
export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { matches, suggestions } = await findAutoMatches(supabase, parseRange(request))

    if (!matches.length) {
      return NextResponse.json({ matched: 0, suggested: suggestions.length, details: [], suggestions })
    }

    for (const match of matches) {
      // Aggiorna fatture: tutte le N fatture puntano alla stessa trans
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

      // Inserisci righe riconciliazioni (idempotente)
      const rows = match.fattura_ids.map(fid => ({
        fattura_id: fid,
        transazione_id: match.transazione_id,
      }))
      const { error: errRic } = await supabase
        .from('riconciliazioni')
        .upsert(rows, { onConflict: 'fattura_id' })
      if (errRic) console.error(`Errore upsert riconciliazioni:`, errRic)

      // Update trans
      await supabase
        .from('transazioni')
        .update({ stato_riconciliazione: 'riconciliata' })
        .eq('id', match.transazione_id)

      // Log match_history (per push 2 learning)
      try {
        await supabase.from('match_history').insert(
          match.fattura_ids.map(fid => ({
            fattura_id: fid,
            transazione_id: match.transazione_id,
            soggetto_canonico: match.soggetto,
            importo_diff: match.differenza,
            score: match.score || null,
            source: 'auto',
          })),
        )
      } catch (e) {
        // tabella potrebbe non esistere ancora, ignoro
      }
    }

    return NextResponse.json({
      matched: matches.length,
      suggested: suggestions.length,
      details: matches,
      suggestions,
    } as MatchResult)
  } catch (error) {
    console.error('Errore auto-match:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Errore sconosciuto' },
      { status: 500 },
    )
  }
}
