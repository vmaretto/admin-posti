import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('fatture')
    .select('*')
    .eq('fonte', 'estero')
    .order('data_emissione', { ascending: false })

  if (from) query = query.gte('data_emissione', from)
  if (to) query = query.lte('data_emissione', to)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
