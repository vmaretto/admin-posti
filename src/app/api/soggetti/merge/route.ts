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
 * Accorpa/rinomina un soggetto: tutte le fatture/transazioni indicate vengono
 * spostate sotto il soggetto target.
 *
 * Body (preferito): {
 *   to: string,
 *   fattura_ids?: string[],
 *   transazione_ids?: string[]
 * }
 *
 * Body (legacy, fallback matching per chiave normalizzata):
 *   { to: string, from_key?: string, from?: string }
 *
 * Se vengono passati fattura_ids/transazione_ids, l'endpoint aggiorna SOLO quelle
 * righe (più robusto: nessuna ambiguità con varianti di normalizzazione).
 * Se non vengono passate, il merge ricade sul matching legacy via normalize().
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient()

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { from_key, from, to, fattura_ids, transazione_ids } = body
  if (!to || typeof to !== 'string') {
    return NextResponse.json({ error: 'to is required' }, { status: 400 })
  }
  const toClean = to.trim()
  const toNorm = normalizeName(toClean)
  if (!toNorm) {
    return NextResponse.json({ error: 'to non valido dopo normalizzazione' }, { status: 400 })
  }

  let fattureMerged = 0
  let transMerged = 0

  // -------- PATH 1: ID espliciti (preferito, robusto) --------
  const hasExplicitFatture = Array.isArray(fattura_ids) && fattura_ids.length > 0
  const hasExplicitTrans = Array.isArray(transazione_ids) && transazione_ids.length > 0

  if (hasExplicitFatture) {
    // Suddividi per tipo per aggiornare il campo corretto (cliente / fornitore)
    const { data: rows } = await supabase
      .from('fatture')
      .select('id, tipo')
      .in('id', fattura_ids)
    const emesseIds = (rows || []).filter(r => r.tipo === 'emessa').map(r => r.id)
    const ricevuteIds = (rows || []).filter(r => r.tipo === 'ricevuta').map(r => r.id)
    if (emesseIds.length > 0) {
      const { error } = await supabase
        .from('fatture')
        .update({ denominazione_cliente: toClean, updated_at: new Date().toISOString() })
        .in('id', emesseIds)
      if (!error) fattureMerged += emesseIds.length
    }
    if (ricevuteIds.length > 0) {
      const { error } = await supabase
        .from('fatture')
        .update({ denominazione_fornitore: toClean, updated_at: new Date().toISOString() })
        .in('id', ricevuteIds)
      if (!error) fattureMerged += ricevuteIds.length
    }
  }

  if (hasExplicitTrans) {
    const { error } = await supabase
      .from('transazioni')
      .update({ controparte: toClean, updated_at: new Date().toISOString() })
      .in('id', transazione_ids)
    if (!error) transMerged += transazione_ids.length
  }

  // -------- PATH 2: legacy fallback via normalize() --------
  if (!hasExplicitFatture && !hasExplicitTrans) {
    const fromKey: string = typeof from_key === 'string' && from_key.trim()
      ? from_key.trim()
      : typeof from === 'string'
      ? normalizeName(from)
      : ''
    if (!fromKey) {
      return NextResponse.json({ error: 'fornisci fattura_ids/transazione_ids oppure from_key/from' }, { status: 400 })
    }

    // Per la rinomina (from === to), il match deve poter essere "fuzzy" sul display:
    // qui ci basiamo sul normalize che è già abbastanza permissivo.
    const fromDisplayLower = typeof from === 'string' ? from.toLowerCase().trim() : ''

    function matchesFrom(value: string | null | undefined): boolean {
      if (!value) return false
      if (normalizeName(value) === fromKey) return true
      if (fromDisplayLower && value.toLowerCase().trim() === fromDisplayLower) return true
      return false
    }

    // Aggiorna fatture
    const { data: allFatture } = await supabase
      .from('fatture')
      .select('id, denominazione_cliente, denominazione_fornitore')
      .range(0, 9999)
    for (const f of allFatture || []) {
      const updates: Record<string, string> = {}
      if (matchesFrom(f.denominazione_cliente)) updates.denominazione_cliente = toClean
      if (matchesFrom(f.denominazione_fornitore)) updates.denominazione_fornitore = toClean
      if (Object.keys(updates).length > 0) {
        const { error } = await supabase.from('fatture').update(updates).eq('id', f.id)
        if (!error) fattureMerged++
      }
    }

    // Aggiorna transazioni
    const { data: allTrans } = await supabase
      .from('transazioni')
      .select('id, controparte')
      .range(0, 9999)
    for (const t of allTrans || []) {
      if (matchesFrom(t.controparte)) {
        const { error } = await supabase
          .from('transazioni')
          .update({ controparte: toClean })
          .eq('id', t.id)
        if (!error) transMerged++
      }
    }
  }

  // Aggiorna soggetti_cluster: assicura presenza del nuovo soggetto.
  // Se conosciamo la chiave sorgente, rimuoviamo anche quella.
  if (typeof from_key === 'string' && from_key.trim() && from_key.trim() !== toNorm) {
    await supabase.from('soggetti_cluster').delete().eq('nome_normalizzato', from_key.trim())
  }
  await supabase
    .from('soggetti_cluster')
    .upsert({ nome_normalizzato: toNorm, varianti: [toClean] }, { onConflict: 'nome_normalizzato' })

  return NextResponse.json({
    success: true,
    fatture_aggiornate: fattureMerged,
    transazioni_aggiornate: transMerged,
  })
}
