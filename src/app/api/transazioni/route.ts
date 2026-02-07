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
    .select('*')
    .order('data', { ascending: false })
  
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
