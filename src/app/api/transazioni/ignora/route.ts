import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

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
    .select('id, note')
    .in('id', transazione_ids)

  const noteMap = new Map<string, string | null>()
  for (const r of existing || []) noteMap.set(r.id, r.note)

  // Eseguiamo gli update uno per uno per preservare le note pre-esistenti.
  for (const id of transazione_ids) {
    const prev = noteMap.get(id)
    const tag = `[Tralasciata: ${motivoClean}]`
    const note = prev && prev.trim() ? `${tag}\n${prev}` : tag
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

  return NextResponse.json({ success: true, updated: transazione_ids.length })
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

  const { error } = await supabase
    .from('transazioni')
    .update({
      stato_riconciliazione: 'da_riconciliare',
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, updated: ids.length })
}
