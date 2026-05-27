import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * POST /api/fatture/ignora
 * Marca una o più fatture come "tralasciate" (stato_riconciliazione='non_trovata')
 * con motivazione obbligatoria registrata nelle note: '[Tralasciata: <motivo>]'.
 *
 * Body: { fattura_ids: string[], motivo: string }
 *
 * DELETE ids=...: annulla il flag e rimette a 'da_riconciliare' (senza toccare le note).
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient()

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { fattura_ids, motivo } = body
  if (!Array.isArray(fattura_ids) || fattura_ids.length === 0) {
    return NextResponse.json({ error: 'fattura_ids is required (non-empty array)' }, { status: 400 })
  }
  if (!motivo || typeof motivo !== 'string' || !motivo.trim()) {
    return NextResponse.json({ error: 'motivo è obbligatorio' }, { status: 400 })
  }
  const motivoClean = motivo.trim()

  const { data: existing } = await supabase
    .from('fatture')
    .select('id, note')
    .in('id', fattura_ids)
  const noteMap = new Map<string, string | null>()
  for (const r of existing || []) noteMap.set(r.id, r.note)

  for (const id of fattura_ids) {
    const prev = noteMap.get(id)
    const tag = `[Tralasciata: ${motivoClean}]`
    const note = prev && prev.trim() ? `${tag}\n${prev}` : tag
    const { error: errRow } = await supabase
      .from('fatture')
      .update({
        stato_riconciliazione: 'non_trovata',
        note,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (errRow) {
      return NextResponse.json({ error: errRow.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true, updated: fattura_ids.length })
}

export async function DELETE(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const idsParam = searchParams.get('ids')
  if (!idsParam) {
    return NextResponse.json({ error: 'ids query param required' }, { status: 400 })
  }
  const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!ids.length) return NextResponse.json({ error: 'no ids' }, { status: 400 })

  const { error } = await supabase
    .from('fatture')
    .update({
      stato_riconciliazione: 'da_riconciliare',
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, updated: ids.length })
}
