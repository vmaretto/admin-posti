import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/transazioni/dedup-paypal?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Identifica le trans bancarie (Qonto, Sella, ecc.) che sono giroconti al
// wallet PayPal (controparte "PayPal Europe" + codice transazione nella
// causale che combacia con una trans PayPal in DB). Le tralascia con motivo
// "Spostamento tra conti" arricchendo le note col vero fornitore (Vimeo,
// Stripe, ecc.).
//
// In questo modo le trans bancarie spariscono dalle "scoperte" e solo le
// trans PayPal restano come candidate per il match con le fatture.
//
// Risposta: { deduped: N, details: [...] }
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  // 1) Trans bancarie con "PayPal" nella controparte e da_riconciliare
  let qBank = supabase
    .from('transazioni')
    .select('id, conto, importo, data, controparte, descrizione, note, riferimento, stato_riconciliazione')
    .neq('conto', 'paypal')
    .ilike('controparte', '%paypal%')
    .eq('stato_riconciliazione', 'da_riconciliare')
  if (from) qBank = qBank.gte('data', from)
  if (to) qBank = qBank.lte('data', to)
  const { data: bank } = await qBank.range(0, 9999)
  if (!bank || bank.length === 0) {
    return NextResponse.json({ deduped: 0, details: [] })
  }

  // 2) Estrai codici PayPal dalle causali
  function extractCode(...texts: (string | null | undefined)[]): string | null {
    const blob = texts.filter(Boolean).join(' ')
    const m = /\b(\d{10,})\b/.exec(blob)
    return m ? m[1] : null
  }
  const bankByCode = new Map<string, typeof bank[number]>()
  const codes: string[] = []
  for (const t of bank) {
    const c = extractCode(t.descrizione, t.note, t.riferimento)
    if (c) {
      bankByCode.set(c, t)
      codes.push(c)
    }
  }
  if (codes.length === 0) {
    return NextResponse.json({ deduped: 0, details: [] })
  }

  // 3) Cerca trans PayPal con riferimento corrispondente
  const { data: pp } = await supabase
    .from('transazioni')
    .select('id, controparte, descrizione, riferimento, importo, data')
    .eq('conto', 'paypal')
    .in('riferimento', codes)
    .range(0, 9999)
  const ppByCode = new Map<string, NonNullable<typeof pp>[number]>()
  for (const p of pp || []) {
    if (p.riferimento) ppByCode.set(String(p.riferimento), p)
  }

  // 4) Per ogni coppia, tralascia la trans bancaria
  const details: Array<{
    bankTransId: string
    bankControparte: string | null
    importo: number
    realFornitore: string | null
    paypalTransId: string
    codice: string
  }> = []
  for (const [code, bankT] of bankByCode.entries()) {
    const ppT = ppByCode.get(code)
    if (!ppT) continue // Coppia non trovata, salta
    const realFornitore = ppT.controparte || ppT.descrizione || null
    const tag = `[Tralasciata: Spostamento tra conti]`
    const nota = `${tag}\nGiroconto a wallet PayPal · vero fornitore: ${realFornitore || 'sconosciuto'} · codice PayPal ${code} · trans PayPal id ${ppT.id}${bankT.note ? '\n' + bankT.note : ''}`
    const { error } = await supabase
      .from('transazioni')
      .update({
        stato_riconciliazione: 'non_trovata',
        note: nota,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bankT.id)
    if (error) continue
    details.push({
      bankTransId: bankT.id,
      bankControparte: bankT.controparte,
      importo: bankT.importo,
      realFornitore,
      paypalTransId: ppT.id,
      codice: code,
    })
  }

  return NextResponse.json({
    deduped: details.length,
    details,
  })
}
