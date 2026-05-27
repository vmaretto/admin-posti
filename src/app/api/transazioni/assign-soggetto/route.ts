import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * POST /api/transazioni/assign-soggetto
 * Assegna una transazione orfana a un soggetto esistente aggiornando il campo controparte.
 *
 * Body: { transazione_id: string, soggetto: string }
 *
 * Il valore di "soggetto" deve essere la denominazione originale di un soggetto già esistente
 * (denominazione_cliente o denominazione_fornitore di una fattura), così che la
 * normalizzazione lato server riconcili la transazione al gruppo giusto.
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient()

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { transazione_id, soggetto } = body

  if (!transazione_id || typeof transazione_id !== 'string') {
    return NextResponse.json({ error: 'transazione_id is required' }, { status: 400 })
  }
  if (!soggetto || typeof soggetto !== 'string' || !soggetto.trim()) {
    return NextResponse.json({ error: 'soggetto is required' }, { status: 400 })
  }

  // Verifica che la transazione esista
  const { data: trans, error: errTrans } = await supabase
    .from('transazioni')
    .select('id, stato_riconciliazione')
    .eq('id', transazione_id)
    .single()

  if (errTrans || !trans) {
    return NextResponse.json({ error: 'Transazione not found' }, { status: 404 })
  }

  // Aggiorna la controparte. La vista soggetti raggrupperà automaticamente
  // grazie alla normalizzazione del nome.
  const { error: errUpdate } = await supabase
    .from('transazioni')
    .update({
      controparte: soggetto.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', transazione_id)

  if (errUpdate) {
    return NextResponse.json({ error: errUpdate.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
