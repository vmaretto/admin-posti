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
 * POST /api/transazioni/assign-soggetto
 * Assegna una o più transazioni orfane a un soggetto (esistente o nuovo).
 *
 * Body:
 *  - { transazione_ids: string[], soggetto: string, createNew?: boolean }
 *  - oppure (compat): { transazione_id: string, soggetto: string }
 *
 * Se `createNew: true`, registra il nome in `soggetti_cluster` così la vista
 * Soggetti lo mostrerà come soggetto a sé anche senza fatture collegate.
 */
export async function POST(request: NextRequest) {
  const supabase = createServerClient()

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { transazione_ids, transazione_id, soggetto, createNew } = body

  const ids: string[] = Array.isArray(transazione_ids)
    ? transazione_ids
    : transazione_id
    ? [transazione_id]
    : []

  if (!ids.length) {
    return NextResponse.json({ error: 'transazione_ids is required (non-empty array)' }, { status: 400 })
  }
  if (!soggetto || typeof soggetto !== 'string' || !soggetto.trim()) {
    return NextResponse.json({ error: 'soggetto is required' }, { status: 400 })
  }
  const soggettoClean = soggetto.trim()

  // If creating a new soggetto, register in soggetti_cluster (idempotent)
  if (createNew) {
    const nomeNorm = normalizeName(soggettoClean)
    if (nomeNorm) {
      // Upsert by nome_normalizzato (unique)
      const { error: errCluster } = await supabase
        .from('soggetti_cluster')
        .upsert({ nome_normalizzato: nomeNorm, varianti: [soggettoClean] }, { onConflict: 'nome_normalizzato' })
      if (errCluster) {
        return NextResponse.json({ error: `Errore creazione soggetto: ${errCluster.message}` }, { status: 500 })
      }
    }
  }

  // Batch update controparte for all selected transactions
  const { error: errUpdate } = await supabase
    .from('transazioni')
    .update({
      controparte: soggettoClean,
      updated_at: new Date().toISOString(),
    })
    .in('id', ids)

  if (errUpdate) {
    return NextResponse.json({ error: errUpdate.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, updated: ids.length, soggetto: soggettoClean })
}
