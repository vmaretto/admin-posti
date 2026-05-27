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
 * Accorpa due soggetti: tutte le fatture/transazioni di `from` vengono spostate
 * sotto la denominazione di `to`.
 *
 * Body: { from: string, to: string }
 *  - from: denominazione del soggetto da accorpare (sorgente)
 *  - to: denominazione del soggetto target (destinazione)
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient()

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { from, to } = body
  if (!from || !to || typeof from !== 'string' || typeof to !== 'string') {
    return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
  }
  if (from.trim() === to.trim()) {
    return NextResponse.json({ error: 'from e to devono essere diversi' }, { status: 400 })
  }
  const fromClean = from.trim()
  const toClean = to.trim()
  const fromNorm = normalizeName(fromClean)
  const toNorm = normalizeName(toClean)

  // 1. Aggiorna denominazione_cliente sulle fatture emesse del soggetto sorgente
  // Trovo tutte le fatture e filtro lato server con un confronto normalizzato.
  const { data: allFatture } = await supabase
    .from('fatture')
    .select('id, tipo, denominazione_cliente, denominazione_fornitore')
    .range(0, 9999)

  let fattureMerged = 0
  for (const f of allFatture || []) {
    const denomCli = f.denominazione_cliente
    const denomForn = f.denominazione_fornitore
    const updates: Record<string, string> = {}
    if (denomCli && normalizeName(denomCli) === fromNorm) updates.denominazione_cliente = toClean
    if (denomForn && normalizeName(denomForn) === fromNorm) updates.denominazione_fornitore = toClean
    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('fatture').update(updates).eq('id', f.id)
      if (!error) fattureMerged++
    }
  }

  // 2. Aggiorna controparte sulle transazioni del soggetto sorgente
  const { data: allTrans } = await supabase
    .from('transazioni')
    .select('id, controparte')
    .range(0, 9999)

  let transMerged = 0
  for (const t of allTrans || []) {
    if (t.controparte && normalizeName(t.controparte) === fromNorm) {
      const { error } = await supabase
        .from('transazioni')
        .update({ controparte: toClean })
        .eq('id', t.id)
      if (!error) transMerged++
    }
  }

  // 3. Aggiorna soggetti_cluster: rimuovi entry "from" e assicura entry "to" esista
  await supabase.from('soggetti_cluster').delete().eq('nome_normalizzato', fromNorm)
  if (toNorm) {
    await supabase
      .from('soggetti_cluster')
      .upsert({ nome_normalizzato: toNorm, varianti: [toClean] }, { onConflict: 'nome_normalizzato' })
  }

  return NextResponse.json({
    success: true,
    fatture_aggiornate: fattureMerged,
    transazioni_aggiornate: transMerged,
  })
}
