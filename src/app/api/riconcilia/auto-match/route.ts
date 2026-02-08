import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { normalizeSubject } from '@/lib/normalize'

export const dynamic = 'force-dynamic'

/**
 * POST /api/riconcilia/auto-match
 * Riconcilia automaticamente fatture con match perfetti:
 * - Soggetto normalizzato IDENTICO
 * - Importo: diff ≤ 2€
 * - Data transazione tra -30 e +120 giorni dalla fattura
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  
  // Prendi fatture da riconciliare
  const { data: fatture, error: errFatture } = await supabase
    .from('fatture')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .order('data_emissione', { ascending: true })
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
  
  // Pre-calcola normalizzazioni
  const transazioniNormalized = (transazioni || []).map(t => ({
    ...t,
    controparte_normalized: normalizeSubject(t.controparte)
  }))
  
  const matches: { fattura_id: string; transazione_id: string; fattura_numero: string; transazione_controparte: string }[] = []
  const usedTransazioni = new Set<string>()
  
  for (const fattura of fatture || []) {
    const fatturaTotal = fattura.totale || ((fattura.imponibile || 0) + (fattura.imposta || 0))
    const fatturaSoggetto = fattura.tipo === 'emessa' 
      ? fattura.denominazione_cliente 
      : fattura.denominazione_fornitore
    const fatturaDate = new Date(fattura.data_emissione)
    const expectedTipo = fattura.tipo === 'emessa' ? 'entrata' : 'uscita'
    
    const soggettoNormalized = normalizeSubject(fatturaSoggetto)
    if (!soggettoNormalized) continue
    
    // Trova match perfetto
    let bestMatch: typeof transazioniNormalized[0] | null = null
    let bestDiffGiorni = Infinity
    
    for (const trans of transazioniNormalized) {
      // Skip già usate
      if (usedTransazioni.has(trans.id)) continue
      
      // Tipo deve corrispondere
      if (trans.tipo !== expectedTipo) continue
      
      // Soggetto normalizzato IDENTICO
      if (trans.controparte_normalized !== soggettoNormalized) continue
      
      // Importo: diff ≤ 2€ (match perfetto)
      const diffImporto = Math.abs(fatturaTotal - trans.importo)
      if (diffImporto > 2) continue
      
      // Data transazione tra -30 e +120 giorni dalla fattura
      const transDate = new Date(trans.data)
      const diffMs = transDate.getTime() - fatturaDate.getTime()
      const diffGiorni = diffMs / (1000 * 60 * 60 * 24)
      if (diffGiorni < -30 || diffGiorni > 120) continue
      
      // Preferisci transazione più vicina nel tempo
      if (Math.abs(diffGiorni) < Math.abs(bestDiffGiorni)) {
        bestMatch = trans
        bestDiffGiorni = diffGiorni
      }
    }
    
    if (bestMatch) {
      matches.push({
        fattura_id: fattura.id,
        transazione_id: bestMatch.id,
        fattura_numero: fattura.numero,
        transazione_controparte: bestMatch.controparte
      })
      usedTransazioni.add(bestMatch.id)
    }
  }
  
  // Esegui riconciliazioni
  if (matches.length > 0) {
    // Inserisci riconciliazioni
    const riconciliazioni = matches.map(m => ({
      fattura_id: m.fattura_id,
      transazione_id: m.transazione_id
    }))
    
    const { error: errUpsert } = await supabase
      .from('riconciliazioni')
      .upsert(riconciliazioni, { onConflict: 'fattura_id' })
    
    if (errUpsert) {
      return NextResponse.json({ error: errUpsert.message }, { status: 500 })
    }
    
    // Aggiorna stato fatture
    const fatturaIds = matches.map(m => m.fattura_id)
    await supabase
      .from('fatture')
      .update({ stato_riconciliazione: 'riconciliata' })
      .in('id', fatturaIds)
    
    // Aggiorna stato transazioni
    const transazioneIds = matches.map(m => m.transazione_id)
    await supabase
      .from('transazioni')
      .update({ stato_riconciliazione: 'riconciliata' })
      .in('id', transazioneIds)
  }
  
  return NextResponse.json({
    matched: matches.length,
    details: matches.map(m => ({
      fattura: m.fattura_numero,
      transazione: m.transazione_controparte
    }))
  })
}
