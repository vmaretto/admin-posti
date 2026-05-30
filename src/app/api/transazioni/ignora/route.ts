import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function withTralasciataTag(note: string | null | undefined, motivo: string): string {
  const tag = `[Tralasciata: ${motivo}]`
  const cleaned = (note || '')
    .replace(/^\[Tralasciata:\s*.+?\]\n*/g, '')
    .trim()
  return cleaned ? `${tag}\n${cleaned}` : tag
}

function withoutTralasciataTag(note: string | null | undefined): string | null {
  const cleaned = (note || '')
    .replace(/^\[Tralasciata:\s*.+?\]\n*/g, '')
    .trim()
  return cleaned || null
}

/**
 * POST /api/transazioni/ignora
 * Marca una o più transazioni come "tralasciate" — non verranno più mostrate
 * nella sezione orfani. Internamente impostiamo stato_riconciliazione = 'non_trovata'.
 *
 * Body: { transazione_ids: string[] }
 *
 * DELETE riconcilia=true (via query): annulla il flag e rimette a 'da_riconciliare'.
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient()

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { transazione_ids, motivo } = body
  if (!Array.isArray(transazione_ids) || transazione_ids.length === 0) {
    return NextResponse.json({ error: 'transazione_ids is required (non-empty array)' }, { status: 400 })
  }
  if (!motivo || typeof motivo !== 'string' || !motivo.trim()) {
    return NextResponse.json({ error: 'motivo è obbligatorio' }, { status: 400 })
  }
  const motivoClean = motivo.trim()

  // Prefisso standard "[Tralasciata: motivo]" per essere facile da identificare
  // poi nelle note. Se la transazione aveva già note, le concateniamo.
  const { data: existing } = await supabase
    .from('transazioni')
    .select('id, note, conto')
    .in('id', transazione_ids)

  const noteMap = new Map<string, string | null>()
  const ignorableIds: string[] = []
  for (const r of existing || []) {
    if (r.conto === 'paypal') continue
    noteMap.set(r.id, r.note)
    ignorableIds.push(r.id)
  }

  // Eseguiamo gli update uno per uno per preservare le note pre-esistenti.
  for (const id of ignorableIds) {
    const prev = noteMap.get(id)
    const note = withTralasciataTag(prev, motivoClean)
    const { error: errRow } = await supabase
      .from('transazioni')
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

  return NextResponse.json({ success: true, updated: ignorableIds.length, skippedPaypal: transazione_ids.length - ignorableIds.length })
}

export async function DELETE(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const idsParam = searchParams.get('ids')
  if (!idsParam) {
    return NextResponse.json({ error: 'ids query param required (comma separated)' }, { status: 400 })
  }
  const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)
  if (!ids.length) {
    return NextResponse.json({ error: 'no ids provided' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('transazioni')
    .select('id, note')
    .in('id', ids)

  const noteMap = new Map<string, string | null>()
  for (const r of existing || []) noteMap.set(r.id, r.note)

  for (const id of ids) {
    const { error } = await supabase
      .from('transazioni')
      .update({
        stato_riconciliazione: 'da_riconciliare',
        note: withoutTralasciataTag(noteMap.get(id)),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true, updated: ids.length })
}
