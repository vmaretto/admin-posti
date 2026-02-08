import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * POST /api/riconcilia/confirm
 * Collega fatture a una transazione e aggiorna stati
 * 
 * Body: { fattura_ids: string[], transazione_id: string }
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  
  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  
  const { fattura_ids, transazione_id } = body
  
  if (!fattura_ids || !Array.isArray(fattura_ids) || fattura_ids.length === 0) {
    return NextResponse.json({ error: 'fattura_ids must be a non-empty array' }, { status: 400 })
  }
  
  if (!transazione_id || typeof transazione_id !== 'string') {
    return NextResponse.json({ error: 'transazione_id is required' }, { status: 400 })
  }
  
  // Verifica che la transazione esista e sia da_riconciliare
  const { data: transazione, error: errTrans } = await supabase
    .from('transazioni')
    .select('id, stato_riconciliazione')
    .eq('id', transazione_id)
    .single()
  
  if (errTrans || !transazione) {
    return NextResponse.json({ error: 'Transazione not found' }, { status: 404 })
  }
  
  if (transazione.stato_riconciliazione === 'riconciliata') {
    return NextResponse.json({ error: 'Transazione già riconciliata' }, { status: 400 })
  }
  
  // Verifica che tutte le fatture esistano e siano da_riconciliare
  const { data: fatture, error: errFatture } = await supabase
    .from('fatture')
    .select('id, numero, stato_riconciliazione')
    .in('id', fattura_ids)
  
  if (errFatture) {
    return NextResponse.json({ error: errFatture.message }, { status: 500 })
  }
  
  if (!fatture || fatture.length !== fattura_ids.length) {
    return NextResponse.json({ error: 'Some fatture not found' }, { status: 404 })
  }
  
  const fattureGiaRiconciliate = fatture.filter(f => f.stato_riconciliazione === 'riconciliata')
  if (fattureGiaRiconciliate.length > 0) {
    return NextResponse.json({ 
      error: `Fatture già riconciliate: ${fattureGiaRiconciliate.map(f => f.numero).join(', ')}` 
    }, { status: 400 })
  }
  
  // Inserisci riconciliazioni (N:1 supportato - più fatture -> 1 transazione)
  const riconciliazioni = fattura_ids.map(fattura_id => ({
    fattura_id,
    transazione_id
  }))
  
  const { error: errUpsert } = await supabase
    .from('riconciliazioni')
    .upsert(riconciliazioni, { onConflict: 'fattura_id' })
  
  if (errUpsert) {
    return NextResponse.json({ error: errUpsert.message }, { status: 500 })
  }
  
  // Aggiorna stato fatture
  const { error: errUpdateFatture } = await supabase
    .from('fatture')
    .update({ stato_riconciliazione: 'riconciliata' })
    .in('id', fattura_ids)
  
  if (errUpdateFatture) {
    return NextResponse.json({ error: errUpdateFatture.message }, { status: 500 })
  }
  
  // Aggiorna stato transazione
  const { error: errUpdateTrans } = await supabase
    .from('transazioni')
    .update({ stato_riconciliazione: 'riconciliata' })
    .eq('id', transazione_id)
  
  if (errUpdateTrans) {
    return NextResponse.json({ error: errUpdateTrans.message }, { status: 500 })
  }
  
  return NextResponse.json({ 
    success: true,
    fatture_collegate: fattura_ids.length,
    transazione_id
  })
}
