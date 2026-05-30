import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { normalizeName } from '@/lib/matching'

export const dynamic = 'force-dynamic'

function withTralasciataTag(note: string | null | undefined, motivo: string): string {
  const tag = `[Tralasciata: ${motivo}]`
  const cleaned = (note || '')
    .replace(/^\[Tralasciata:\s*.+?\]\n*/g, '')
    .trim()
  return cleaned ? `${tag}\n${cleaned}` : tag
}

// POST /api/auto-tralascia/apply?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Per il periodo indicato, scorre tutte le trans `da_riconciliare`, verifica
// se la loro controparte normalizzata combacia con una regola in
// auto_tralascia_rules, e in tal caso applica il tralascio con quel motivo.
//
// Risposta: { applied: N, perRegola: [{motivo, count}] }
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  // Carica regole
  const { data: rules, error: errRules } = await supabase
    .from('auto_tralascia_rules')
    .select('*')
  if (errRules) {
    return NextResponse.json({
      applied: 0,
      hint: 'Tabella auto_tralascia_rules non esiste (esegui la migration).',
      available: false,
    })
  }
  if (!rules || rules.length === 0) {
    return NextResponse.json({ applied: 0, perRegola: [], available: true })
  }
  // Mappa norm → motivo
  const ruleMap = new Map<string, { motivo: string; controparte_normalizzata: string }>()
  for (const r of rules) ruleMap.set(r.controparte_normalizzata, r)

  // Carica trans del periodo da_riconciliare
  let q = supabase
    .from('transazioni')
    .select('id, controparte, note')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .neq('conto', 'paypal')
  if (from) q = q.gte('data', from)
  if (to) q = q.lte('data', to)
  const { data: trans, error: errT } = await q.range(0, 9999)
  if (errT) return NextResponse.json({ error: errT.message }, { status: 500 })

  const perRegola = new Map<string, number>()
  const updates: { id: string; motivo: string; note: string | null }[] = []
  for (const t of trans || []) {
    if (!t.controparte) continue
    const norm = normalizeName(t.controparte)
    if (!norm) continue
    const rule = ruleMap.get(norm)
    if (!rule) continue
    perRegola.set(rule.motivo, (perRegola.get(rule.motivo) || 0) + 1)
    const newNote = withTralasciataTag(t.note, rule.motivo)
    updates.push({ id: t.id, motivo: rule.motivo, note: newNote })
  }

  // Applica gli update in batch
  let applied = 0
  for (const u of updates) {
    const { error } = await supabase
      .from('transazioni')
      .update({
        stato_riconciliazione: 'non_trovata',
        note: u.note,
        updated_at: new Date().toISOString(),
      })
      .eq('id', u.id)
    if (!error) applied++
  }

  // Incrementa contatori regole
  for (const [motivo, count] of perRegola.entries()) {
    // Trovo le regole con questo motivo nel set applicato (per incrementare il counter)
    const rulesWithMotivo = rules.filter(r => r.motivo === motivo)
    for (const r of rulesWithMotivo) {
      await supabase
        .from('auto_tralascia_rules')
        .update({
          applicazioni: (r.applicazioni || 0) + count,
          last_applied_at: new Date().toISOString(),
        })
        .eq('controparte_normalizzata', r.controparte_normalizzata)
    }
  }

  return NextResponse.json({
    applied,
    perRegola: Array.from(perRegola.entries()).map(([motivo, count]) => ({ motivo, count })),
    available: true,
  })
}
