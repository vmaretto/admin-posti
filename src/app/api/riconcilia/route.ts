import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { fatturaId, transazioneId } = await request.json()
  
  if (!fatturaId || !transazioneId) {
    return NextResponse.json({ error: 'Missing fatturaId or transazioneId' }, { status: 400 })
  }
  
  // Update fattura
  const { error: errFattura } = await supabase
    .from('fatture')
    .update({ 
      transazione_id: transazioneId,
      stato_riconciliazione: 'riconciliata'
    })
    .eq('id', fatturaId)
  
  if (errFattura) {
    return NextResponse.json({ error: errFattura.message }, { status: 500 })
  }
  
  // Update transazione
  const { error: errTrans } = await supabase
    .from('transazioni')
    .update({ 
      fattura_id: fatturaId,
      stato_riconciliazione: 'riconciliata'
    })
    .eq('id', transazioneId)
  
  if (errTrans) {
    return NextResponse.json({ error: errTrans.message }, { status: 500 })
  }
  
  return NextResponse.json({ success: true })
}

// Auto-match endpoint
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === 'true'
  const toleranceDays = parseInt(searchParams.get('toleranceDays') || '30')
  
  // Get unmatched fatture
  const { data: fatture, error: errF } = await supabase
    .from('fatture')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
  
  if (errF) {
    return NextResponse.json({ error: errF.message }, { status: 500 })
  }
  
  // Get unmatched transazioni
  const { data: transazioni, error: errT } = await supabase
    .from('transazioni')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
  
  if (errT) {
    return NextResponse.json({ error: errT.message }, { status: 500 })
  }
  
  const matches = []
  const usedTransazioni = new Set<string>()
  
  for (const fattura of fatture || []) {
    // For emesse, look for entrate; for ricevute, look for uscite
    const expectedTipo = fattura.tipo === 'emessa' ? 'entrata' : 'uscita'
    
    for (const trans of transazioni || []) {
      if (usedTransazioni.has(trans.id)) continue
      if (trans.tipo !== expectedTipo) continue
      
      // Check amount match (within 2% or 5 EUR)
      const fatturaTotal = fattura.totale || (fattura.imponibile + fattura.imposta)
      const tolerance = Math.max(fatturaTotal * 0.02, 5)
      const amountMatch = Math.abs(fatturaTotal - trans.importo) <= tolerance
      
      if (!amountMatch) continue
      
      // Check date within tolerance
      const fatturaDate = new Date(fattura.data_emissione)
      const transDate = new Date(trans.data)
      const daysDiff = Math.abs((transDate.getTime() - fatturaDate.getTime()) / (1000 * 60 * 60 * 24))
      
      if (daysDiff > toleranceDays) continue
      
      // Match found!
      matches.push({
        fattura: {
          id: fattura.id,
          numero: fattura.numero,
          totale: fatturaTotal,
          data: fattura.data_emissione,
          denominazione: fattura.tipo === 'emessa' ? fattura.denominazione_cliente : fattura.denominazione_fornitore
        },
        transazione: {
          id: trans.id,
          importo: trans.importo,
          data: trans.data,
          controparte: trans.controparte,
          conto: trans.conto
        },
        daysDiff: Math.round(daysDiff)
      })
      
      usedTransazioni.add(trans.id)
      break
    }
  }
  
  if (!dryRun && matches.length > 0) {
    // Apply matches
    for (const match of matches) {
      await supabase
        .from('fatture')
        .update({ 
          transazione_id: match.transazione.id,
          stato_riconciliazione: 'riconciliata'
        })
        .eq('id', match.fattura.id)
      
      await supabase
        .from('transazioni')
        .update({ 
          fattura_id: match.fattura.id,
          stato_riconciliazione: 'riconciliata'
        })
        .eq('id', match.transazione.id)
    }
  }
  
  return NextResponse.json({ 
    matches,
    count: matches.length,
    dryRun
  })
}
