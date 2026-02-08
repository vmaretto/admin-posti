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
  
  let query = supabase
    .from('transazioni')
    .select('*, fattura:fatture(id, numero, data_emissione, totale, imponibile, imposta, tipo)')
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
  
  // Se stato diventa "da_riconciliare", scollega anche la fattura
  if (stato_riconciliazione === 'da_riconciliare') {
    // Prima trova la fattura collegata per aggiornarla
    const { data: trans } = await supabase
      .from('transazioni')
      .select('fattura_id')
      .eq('id', id)
      .single()
    
    if (trans?.fattura_id) {
      // Aggiorna la fattura collegata
      await supabase
        .from('fatture')
        .update({ 
          stato_riconciliazione: 'da_riconciliare',
          updated_at: new Date().toISOString() 
        })
        .eq('id', trans.fattura_id)
    }
    
    // Scollega la fattura dalla transazione
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
