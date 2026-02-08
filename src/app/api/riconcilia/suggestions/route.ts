import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { normalizeSubject } from '@/lib/normalize'

export const dynamic = 'force-dynamic'

interface Candidato {
  transazione_id: string
  controparte: string
  importo: number
  data: string
  diff_importo: number
  diff_giorni: number
  score: number
}

interface Suggestion {
  fattura: {
    id: string
    numero: string
    soggetto: string
    importo: number
    data: string
    tipo: string
  }
  candidati: Candidato[]
}

/**
 * GET /api/riconcilia/suggestions
 * Genera suggerimenti 🟡 per fatture non ancora riconciliate
 * 
 * Criteri:
 * - Soggetto normalizzato IDENTICO
 * - Importo: diff > 2€ ma ≤ 5% O ≤ 50€
 * - Data transazione tra -30 e +120 giorni dalla fattura
 * - Score: importo più vicino = score più alto
 */
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  
  // Prendi fatture da riconciliare
  const { data: fatture, error: errFatture } = await supabase
    .from('fatture')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .order('data_emissione', { ascending: false })
    .range(0, 9999)
  
  if (errFatture) {
    return NextResponse.json({ error: errFatture.message }, { status: 500 })
  }
  
  // Prendi transazioni da riconciliare
  const { data: transazioni, error: errTrans } = await supabase
    .from('transazioni')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .range(0, 9999)
  
  if (errTrans) {
    return NextResponse.json({ error: errTrans.message }, { status: 500 })
  }
  
  // Pre-calcola normalizzazioni transazioni
  const transazioniNormalized = (transazioni || []).map(t => ({
    ...t,
    controparte_normalized: normalizeSubject(t.controparte)
  }))
  
  const suggestions: Suggestion[] = []
  
  for (const fattura of fatture || []) {
    const fatturaTotal = fattura.totale || ((fattura.imponibile || 0) + (fattura.imposta || 0))
    const fatturaSoggetto = fattura.tipo === 'emessa' 
      ? fattura.denominazione_cliente 
      : fattura.denominazione_fornitore
    const fatturaDate = new Date(fattura.data_emissione)
    const expectedTipo = fattura.tipo === 'emessa' ? 'entrata' : 'uscita'
    
    const soggettoNormalized = normalizeSubject(fatturaSoggetto)
    if (!soggettoNormalized) continue
    
    const candidati: Candidato[] = []
    
    for (const trans of transazioniNormalized) {
      // Tipo deve corrispondere (emessa -> entrata, ricevuta -> uscita)
      if (trans.tipo !== expectedTipo) continue
      
      // Soggetto normalizzato IDENTICO
      if (trans.controparte_normalized !== soggettoNormalized) continue
      
      // Calcola differenza importo
      const diffImporto = Math.abs(fatturaTotal - trans.importo)
      
      // Criterio importo: diff > 2€ ma ≤ 5% O ≤ 50€
      // (se diff ≤ 2€ sarebbe auto-match, non suggestion)
      if (diffImporto <= 2) continue // Questo è un auto-match, non un suggestion
      
      const maxDiff5Percent = fatturaTotal * 0.05
      if (diffImporto > maxDiff5Percent && diffImporto > 50) continue // Troppo diverso
      
      // Calcola differenza giorni
      const transDate = new Date(trans.data)
      const diffMs = transDate.getTime() - fatturaDate.getTime()
      const diffGiorni = Math.round(diffMs / (1000 * 60 * 60 * 24))
      
      // Data transazione tra -30 e +120 giorni dalla fattura
      if (diffGiorni < -30 || diffGiorni > 120) continue
      
      // Calcola score (importo più vicino = score più alto)
      // Score 100 = differenza 0, score 0 = differenza max (50€)
      const maxDiff = Math.max(maxDiff5Percent, 50)
      const score = Math.round(Math.max(0, 100 - (diffImporto / maxDiff * 100)))
      
      candidati.push({
        transazione_id: trans.id,
        controparte: trans.controparte,
        importo: trans.importo,
        data: trans.data,
        diff_importo: Math.round(diffImporto * 100) / 100,
        diff_giorni: diffGiorni,
        score
      })
    }
    
    // Ordina per score (più alto = meglio)
    candidati.sort((a, b) => b.score - a.score)
    
    // Solo fatture con candidati
    if (candidati.length > 0) {
      suggestions.push({
        fattura: {
          id: fattura.id,
          numero: fattura.numero,
          soggetto: fatturaSoggetto,
          importo: fatturaTotal,
          data: fattura.data_emissione,
          tipo: fattura.tipo
        },
        candidati
      })
    }
  }
  
  return NextResponse.json({ 
    suggestions,
    count: suggestions.length
  })
}
