import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { normalizeName } from '@/lib/matching'

export const dynamic = 'force-dynamic'

// GET /api/auto-tralascia → tutte le regole
export async function GET() {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('auto_tralascia_rules')
    .select('*')
    .order('applicazioni', { ascending: false })
  if (error) {
    // Tabella inesistente: torno lista vuota (fallback)
    return NextResponse.json({ rules: [], available: false })
  }
  return NextResponse.json({ rules: data || [], available: true })
}

// POST { controparte: string, motivo: string } → crea/aggiorna regola
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }
  if (!body?.controparte || !body?.motivo) {
    return NextResponse.json({ error: 'controparte e motivo richiesti' }, { status: 400 })
  }
  const display = String(body.controparte).trim()
  const norm = normalizeName(display)
  if (!norm) return NextResponse.json({ error: 'controparte normalizzata vuota' }, { status: 400 })

  const { data, error } = await supabase
    .from('auto_tralascia_rules')
    .upsert(
      {
        controparte_normalizzata: norm,
        controparte_display: display,
        motivo: String(body.motivo).trim(),
        source: 'wizard',
      },
      { onConflict: 'controparte_normalizzata' },
    )
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ rule: data, success: true })
}

// DELETE ?norm=…  rimuove una regola
export async function DELETE(request: NextRequest) {
  const supabase = createServerClient()
  const norm = new URL(request.url).searchParams.get('norm')
  if (!norm) return NextResponse.json({ error: 'norm richiesto' }, { status: 400 })
  const { error } = await supabase
    .from('auto_tralascia_rules')
    .delete()
    .eq('controparte_normalizzata', norm)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
