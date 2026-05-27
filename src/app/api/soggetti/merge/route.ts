import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(srl|spa|snc|sas|srls|sapa|ltd|inc|gmbh|sarl|s r l|s p a)\b/g, '')
    .trim()
}

/**
 * POST /api/soggetti/merge
 * Accorpa due soggetti: tutte le fatture/transazioni del soggetto sorgente
 * vengono spostate sotto il soggetto target.
 *
 * Body: { from_key: string, to: string }
 *   - from_key: chiave normalizzata del soggetto sorgente (per gestire display ambigui)
 *   - to: denominazione del soggetto target (display)
 *
 * Compat: accetta anche { from: string, to: string } usando from come display.
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient()

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { from_key, from, to } = body
  if (!to || typeof to !== 'string') {
    return NextResponse.json({ error: 'to is required (display name del target)' }, { status: 400 })
  }
  const toClean = to.trim()
  const toNorm = normalizeName(toClean)
  if (!toNorm) {
    return NextResponse.json({ error: 'to non valido' }, { status: 400 })
  }

  // Determina la chiave sorgente
  const fromKey: string = typeof from_key === 'string' && from_key.trim()
    ? from_key.trim()
    : typeof from === 'string'
    ? normalizeName(from)
    : ''
  if (!fromKey) {
    return NextResponse.json({ error: 'from_key (o from) è obbligatorio' }, { status: 400 })
  }
  if (fromKey === toNorm) {
    return NextResponse.json({ error: 'sorgente e destinazione coincidono' }, { status: 400 })
  }

  // 1. Aggiorna denominazione su fatture (sia cliente sia fornitore) dove normalize == fromKey
  const { data: allFatture } = await supabase
    .from('fatture')
    .select('id, denominazione_cliente, denominazione_fornitore')
    .range(0, 9999)

  let fattureMerged = 0
  for (const f of allFatture || []) {
    const updates: Record<string, string> = {}
    if (f.denominazione_cliente && normalizeName(f.denominazione_cliente) === fromKey) {
      updates.denominazione_cliente = toClean
    }
    if (f.denominazione_fornitore && normalizeName(f.denominazione_fornitore) === fromKey) {
      updates.denominazione_fornitore = toClean
    }
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('fatture').update(updates).eq('id', f.id)
      if (!error) fattureMerged++
    }
  }

  // 2. Aggiorna controparte su transazioni dove normalize == fromKey
  const { data: allTrans } = await supabase
    .from('transazioni')
    .select('id, controparte')
    .range(0, 9999)

  let transMerged = 0
  for (const t of allTrans || []) {
    if (t.controparte && normalizeName(t.controparte) === fromKey) {
      const { error } = await supabase
        .from('transazioni')
        .update({ controparte: toClean })
        .eq('id', t.id)
      if (!error) transMerged++
    }
  }

  // 3. Aggiorna soggetti_cluster: rimuovi entry "from" e assicura entry "to"
  await supabase.from('soggetti_cluster').delete().eq('nome_normalizzato', fromKey)
  await supabase
    .from('soggetti_cluster')
    .upsert({ nome_normalizzato: toNorm, varianti: [toClean] }, { onConflict: 'nome_normalizzato' })

  return NextResponse.json({
    success: true,
    fatture_aggiornate: fattureMerged,
    transazioni_aggiornate: transMerged,
  })
}
