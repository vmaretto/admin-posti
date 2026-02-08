import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { normalizeSubject } from '@/lib/normalize'
import type { Fattura, Transazione } from '@/lib/types'

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

// Trova tutti i match automatici
async function findAutoMatches(supabase: ReturnType<typeof createServerClient>): Promise<MatchDetail[]> {
  // Carica fatture da riconciliare
  const { data: fatture, error: errFatture } = await supabase
    .from('fatture')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .is('transazione_id', null)
    .range(0, 9999)

  if (errFatture) throw new Error(`Errore fatture: ${errFatture.message}`)

  // Carica transazioni da riconciliare
  const { data: transazioni, error: errTrans } = await supabase
    .from('transazioni')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .range(0, 9999)

  if (errTrans) throw new Error(`Errore transazioni: ${errTrans.message}`)

  if (!fatture?.length || !transazioni?.length) {
    return []
  }

  const matches: MatchDetail[] = []
  const usedTransazioni = new Set<string>()
  const usedFatture = new Set<string>()

  // Raggruppa fatture per soggetto normalizzato
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

  // Per ogni transazione, cerca match
  for (const trans of transazioni) {
    if (usedTransazioni.has(trans.id)) continue
    if (!trans.controparte) continue

    const normalizedControparte = normalizeSubject(trans.controparte)
    if (!normalizedControparte) continue

    // Cerca fatture con stesso soggetto normalizzato
    const fattureCandidate = fattureBySubject.get(normalizedControparte)
    if (!fattureCandidate) continue

    // Filtra fatture non ancora usate e con data compatibile
    const fattureValide = fattureCandidate.filter(f => 
      !usedFatture.has(f.id) && 
      isDateInRange(f.data_emissione, trans.data) &&
      // Verifica coerenza tipo: fattura ricevuta = uscita, emessa = entrata
      ((f.tipo === 'ricevuta' && trans.tipo === 'uscita') || 
       (f.tipo === 'emessa' && trans.tipo === 'entrata'))
    )

    if (!fattureValide.length) continue

    // Prova match 1:1
    const match1to1 = fattureValide.find(f => 
      Math.abs(f.totale - Math.abs(trans.importo)) <= 2
    )

    if (match1to1 && fattureValide.filter(f => Math.abs(f.totale - Math.abs(trans.importo)) <= 2).length === 1) {
      // Match unico 1:1
      matches.push({
        fattura_ids: [match1to1.id],
        transazione_id: trans.id,
        importo_fatture: match1to1.totale,
        importo_transazione: Math.abs(trans.importo),
        soggetto: getSoggetto(match1to1),
        differenza: Math.abs(match1to1.totale - Math.abs(trans.importo))
      })
      usedTransazioni.add(trans.id)
      usedFatture.add(match1to1.id)
      continue
    }

    // Prova match N:1 (somma di N fatture = 1 transazione)
    // Ordina per data per prendere le più vecchie prima
    const sorted = [...fattureValide].sort((a, b) => 
      new Date(a.data_emissione).getTime() - new Date(b.data_emissione).getTime()
    )

    // Prova combinazioni (max 10 fatture per performance)
    const maxFatture = Math.min(sorted.length, 10)
    let found = false

    // Prova tutte le combinazioni possibili (2^n) fino a 10 fatture
    for (let mask = 1; mask < (1 << maxFatture) && !found; mask++) {
      const combo: Fattura[] = []
      for (let i = 0; i < maxFatture; i++) {
        if (mask & (1 << i)) {
          combo.push(sorted[i])
        }
      }
      
      if (combo.length < 2) continue // 1:1 già gestito sopra

      const somma = combo.reduce((acc, f) => acc + f.totale, 0)
      if (Math.abs(somma - Math.abs(trans.importo)) <= 2) {
        matches.push({
          fattura_ids: combo.map(f => f.id),
          transazione_id: trans.id,
          importo_fatture: somma,
          importo_transazione: Math.abs(trans.importo),
          soggetto: getSoggetto(combo[0]),
          differenza: Math.abs(somma - Math.abs(trans.importo))
        })
        usedTransazioni.add(trans.id)
        combo.forEach(f => usedFatture.add(f.id))
        found = true
      }
    }
  }

  return matches
}

// GET: Preview dei match automatici
export async function GET() {
  try {
    const supabase = createServerClient()
    const matches = await findAutoMatches(supabase)

    return NextResponse.json({
      matched: matches.length,
      details: matches.map(m => ({
        fattura_ids: m.fattura_ids,
        transazione_id: m.transazione_id,
        importo_fatture: m.importo_fatture,
        importo_transazione: m.importo_transazione,
        soggetto: m.soggetto,
        differenza: m.differenza
      }))
    } as MatchResult)
  } catch (error) {
    console.error('Errore auto-match preview:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Errore sconosciuto' },
      { status: 500 }
    )
  }
}

// POST: Esegue i match automatici
export async function POST() {
  try {
    const supabase = createServerClient()
    const matches = await findAutoMatches(supabase)

    if (!matches.length) {
      return NextResponse.json({ matched: 0, details: [] })
    }

    // Esegui gli update per ogni match
    for (const match of matches) {
      // Update fatture
      const { error: errFatture } = await supabase
        .from('fatture')
        .update({
          transazione_id: match.transazione_id,
          stato_riconciliazione: 'riconciliata'
        })
        .in('id', match.fattura_ids)

      if (errFatture) {
        console.error(`Errore update fatture ${match.fattura_ids}:`, errFatture)
        continue
      }

      // Update transazione
      const { error: errTrans } = await supabase
        .from('transazioni')
        .update({
          stato_riconciliazione: 'riconciliata'
        })
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
        differenza: m.differenza
      }))
    } as MatchResult)
  } catch (error) {
    console.error('Errore auto-match:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Errore sconosciuto' },
      { status: 500 }
    )
  }
}
