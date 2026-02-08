import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  
  const tipo = searchParams.get('tipo')
  const stato = searchParams.get('stato')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  
  let query = supabase
    .from('fatture')
    .select('*, transazione:transazioni(id, data, importo, conto, controparte)')
    .order('data_emissione', { ascending: false })
    .range(0, 9999)
  
  if (tipo) query = query.eq('tipo', tipo)
  if (stato) query = query.eq('stato_riconciliazione', stato)
  if (from) query = query.gte('data_emissione', from)
  if (to) query = query.lte('data_emissione', to)
  
  const { data, error } = await query
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest) {
  const supabase = createServerClient()
  const body = await request.json()
  
  const { id, stato_riconciliazione, note, transazione_id } = body
  
  if (!id) {
    return NextResponse.json({ error: 'ID required' }, { status: 400 })
  }
  
  const updateData: Record<string, any> = {}
  if (stato_riconciliazione !== undefined) updateData.stato_riconciliazione = stato_riconciliazione
  if (note !== undefined) updateData.note = note
  if (transazione_id !== undefined) updateData.transazione_id = transazione_id
  updateData.updated_at = new Date().toISOString()
  
  // Se stato diventa "da_riconciliare", scollega la transazione
  if (stato_riconciliazione === 'da_riconciliare') {
    updateData.transazione_id = null
  }
  
  const { error } = await supabase
    .from('fatture')
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
    const { error } = await supabase.from('fatture').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }
  
  const { error } = await supabase.from('fatture').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  
  return NextResponse.json({ success: true })
}
