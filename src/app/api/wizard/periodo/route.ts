import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Coordinate periodo:
//   { tipo: 'annuale',     anno: 2026 }
//   { tipo: 'trimestrale', anno: 2026, trimestre: 1 }
//   { tipo: 'mensile',     anno: 2026, mese: 5 }

type Tipo = 'annuale' | 'trimestrale' | 'mensile'

function parseCoord(searchParams: URLSearchParams) {
  const tipo = searchParams.get('tipo') as Tipo | null
  const anno = searchParams.get('anno')
  const trimestre = searchParams.get('trimestre')
  const mese = searchParams.get('mese')
  if (!tipo || !anno) return null
  return {
    tipo,
    anno: parseInt(anno),
    trimestre: trimestre ? parseInt(trimestre) : null,
    mese: mese ? parseInt(mese) : null,
  }
}

// GET ?tipo=&anno=&trimestre=&mese= → row se esiste, altrimenti 404
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const coord = parseCoord(new URL(request.url).searchParams)
  if (!coord) {
    return NextResponse.json({ error: 'parametri tipo/anno mancanti' }, { status: 400 })
  }

  let q = supabase
    .from('wizard_periodi')
    .select('*')
    .eq('tipo', coord.tipo)
    .eq('anno', coord.anno)
  // Match esatto su trimestre/mese (NULL o valore)
  q = coord.trimestre != null ? q.eq('trimestre', coord.trimestre) : q.is('trimestre', null)
  q = coord.mese != null ? q.eq('mese', coord.mese) : q.is('mese', null)

  const { data, error } = await q.maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Anche se la riga non esiste, torno 200 per evitare rumore nella console.
  // Il client distingue via il flag `found`.
  if (!data) return NextResponse.json({ found: false })
  return NextResponse.json({ found: true, periodo: data })
}

// POST: crea o riapre la riga periodo (idempotente). Body: stesso shape di GET.
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }
  if (!body?.tipo || !body?.anno) {
    return NextResponse.json({ error: 'tipo/anno richiesti' }, { status: 400 })
  }

  // Cerca esistente
  let q = supabase
    .from('wizard_periodi')
    .select('*')
    .eq('tipo', body.tipo)
    .eq('anno', body.anno)
  q = body.trimestre != null ? q.eq('trimestre', body.trimestre) : q.is('trimestre', null)
  q = body.mese != null ? q.eq('mese', body.mese) : q.is('mese', null)
  const { data: existing } = await q.maybeSingle()
  if (existing) {
    return NextResponse.json({ created: false, periodo: existing })
  }

  // Crea
  const { data: inserted, error } = await supabase
    .from('wizard_periodi')
    .insert({
      tipo: body.tipo,
      anno: body.anno,
      trimestre: body.trimestre ?? null,
      mese: body.mese ?? null,
      step_corrente: 0,
      completato: false,
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ created: true, periodo: inserted })
}

// PATCH: aggiorna step_corrente / completato / trans_estere_queue di un periodo esistente.
// Body: { id: UUID, step_corrente?: number, completato?: boolean, trans_estere_queue?: string[] }
export async function PATCH(request: NextRequest) {
  const supabase = createServerClient()
  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }
  if (!body?.id) return NextResponse.json({ error: 'id richiesto' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (typeof body.step_corrente === 'number') updates.step_corrente = body.step_corrente
  if (typeof body.completato === 'boolean') updates.completato = body.completato
  if (Array.isArray(body.trans_estere_queue)) updates.trans_estere_queue = body.trans_estere_queue
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nessun campo da aggiornare' }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('wizard_periodi')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ periodo: data })
}

// DELETE ?id=… : rimuove la riga (utile per "ricomincia da capo")
export async function DELETE(request: NextRequest) {
  const supabase = createServerClient()
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id richiesto' }, { status: 400 })
  const { error } = await supabase.from('wizard_periodi').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
