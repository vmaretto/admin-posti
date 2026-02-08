import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  
  const conto = searchParams.get('conto')
  const tipo = searchParams.get('tipo')
  const stato = searchParams.get('stato')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  
  // N:1 - una transazione può avere più fatture collegate via fatture.transazione_id
  let query = supabase
    .from('transazioni')
    .select('*, fatture(id, numero, data_emissione, totale, imponibile, imposta, tipo)')
    .order('data', { ascending: false })
    .range(0, 9999)
  
  if (conto) query = query.eq('conto', conto)
  if (tipo) query = query.eq('tipo', tipo)
  if (stato) query = query.eq('stato_riconciliazione', stato)
  if (from) query = query.gte('data', from)
  if (to) query = query.lte('data', to)
  
  const { data, error } = await query
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest) {
  const supabase = createServerClient()
  const body = await request.json()
  
  const { id, stato_riconciliazione, note } = body
  
  if (!id) {
    return NextResponse.json({ error: 'ID required' }, { status: 400 })
  }
  
  const updateData: Record<string, any> = {}
  if (stato_riconciliazione !== undefined) updateData.stato_riconciliazione = stato_riconciliazione
  if (note !== undefined) updateData.note = note
  updateData.updated_at = new Date().toISOString()
  
  // Se stato diventa "da_riconciliare", scollega TUTTE le fatture collegate (N:1)
  if (stato_riconciliazione === 'da_riconciliare') {
    // Trova tutte le fatture collegate a questa transazione via transazione_id
    const { data: fattureCollegate } = await supabase
      .from('fatture')
      .select('id')
      .eq('transazione_id', id)
      .range(0, 9999)
    
    if (fattureCollegate && fattureCollegate.length > 0) {
      // Scollega tutte le fatture e mettile in stato da_riconciliare
      for (const f of fattureCollegate) {
        await supabase
          .from('fatture')
          .update({ 
            transazione_id: null,
            stato_riconciliazione: 'da_riconciliare',
            updated_at: new Date().toISOString() 
          })
          .eq('id', f.id)
      }
    }
    
    // Per retrocompatibilità, pulisci anche fattura_id (vecchio sistema 1:1)
    updateData.fattura_id = null
  }
  
  const { error } = await supabase
    .from('transazioni')
    .update(updateData)
    .eq('id', id)
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  
  if (!id) {
    // Delete all
    const { error } = await supabase.from('transazioni').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }
  
  const { error } = await supabase.from('transazioni').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  
  return NextResponse.json({ success: true })
}
