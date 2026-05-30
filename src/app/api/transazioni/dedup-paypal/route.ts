import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/transazioni/dedup-paypal?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Identifica le trans bancarie (Qonto, Sella, ecc.) che sono giroconti al
// wallet PayPal. Prima prova il codice transazione quando disponibile; se i
// riferimenti PayPal non coincidono, usa un fallback controllato su stesso
// importo e data vicina. Le tralascia con motivo "Spostamento tra conti"
// arricchendo le note col vero fornitore (Vimeo, Stripe, ecc.).
//
// In questo modo le trans bancarie PayPal-like spariscono dalle "scoperte".
// Le righe conto='paypal' sono solo supporto informativo importato dal CSV:
// non vanno considerate tralasciate ne' candidate contabili autonome.
//
// Risposta: { deduped: N, details: [...] }
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  // 1) Trans bancarie da_riconciliare; filtro PayPal in JS su tutti i campi,
  // perche' spesso "PayPal" e' nella descrizione/riferimento e non nella controparte.
  let qBank = supabase
    .from('transazioni')
    .select('id, conto, importo, data, controparte, descrizione, note, riferimento, stato_riconciliazione')
    .neq('conto', 'paypal')
    .eq('stato_riconciliazione', 'da_riconciliare')
  if (from) qBank = qBank.gte('data', from)
  if (to) qBank = qBank.lte('data', to)
  const { data: bankRaw } = await qBank.range(0, 9999)
  const bank = (bankRaw || []).filter(t => looksLikePaypal(t.controparte, t.descrizione, t.note, t.riferimento))
  if (!bank || bank.length === 0) {
    return NextResponse.json({ deduped: 0, details: [] })
  }

  // 2) Cerca trans PayPal del periodo: quelle verso il vero fornitore restano
  // aperte per il match fattura, mentre la trans bancaria viene tralasciata.
  let qPaypal = supabase
    .from('transazioni')
    .select('id, controparte, descrizione, riferimento, note, importo, data')
    .eq('conto', 'paypal')
  if (from) qPaypal = qPaypal.gte('data', from)
  if (to) qPaypal = qPaypal.lte('data', to)
  const { data: pp } = await qPaypal.range(0, 9999)
  const paypal = pp || []

  if (paypal.length === 0) {
    return NextResponse.json({ deduped: 0, details: [] })
  }

  const usedPaypalIds = new Set<string>()
  const details: Array<{
    bankTransId: string
    bankControparte: string | null
    importo: number
    realFornitore: string | null
    paypalTransId: string
    match: 'codice' | 'importo_data'
    codice: string | null
    giorniDiff: number
  }> = []

  // 3) Per ogni trans bancaria PayPal-like cerca la trans PayPal piu' affidabile:
  // codice se possibile, altrimenti stesso importo e data entro pochi giorni.
  for (const bankT of bank.sort((a, b) => Math.abs(b.importo || 0) - Math.abs(a.importo || 0))) {
    const match = findPaypalMatch(bankT, paypal, usedPaypalIds)
    if (!match) continue
    const { ppT, code, strategy, giorniDiff } = match
    usedPaypalIds.add(ppT.id)

    const realFornitore = ppT.controparte || ppT.descrizione || null
    const nota = withTralasciataTag(
      bankT.note,
      `Giroconto a wallet PayPal · vero fornitore: ${realFornitore || 'sconosciuto'} · match ${strategy}${code ? ` · codice ${code}` : ''} · trans PayPal id ${ppT.id}`,
    )
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
      match: strategy,
      giorniDiff,
    })
  }

  return NextResponse.json({
    deduped: details.length,
    details,
  })
}

function looksLikePaypal(...texts: (string | null | undefined)[]): boolean {
  return texts.filter(Boolean).join(' ').toLowerCase().includes('paypal')
}

function withTralasciataTag(note: string | null | undefined, detail: string): string {
  const tag = `[Tralasciata: Spostamento tra conti]`
  const cleaned = (note || '')
    .replace(/^\[Tralasciata:\s*.+?\]\n*/g, '')
    .trim()
  return [tag, detail, cleaned].filter(Boolean).join('\n')
}

function extractCode(...texts: (string | null | undefined)[]): string | null {
  const blob = texts.filter(Boolean).join(' ')
  const m = /\b(\d{10,})\b/.exec(blob)
  return m ? m[1] : null
}

function cents(value: number | null): number {
  return Math.round(Math.abs(value || 0) * 100)
}

function daysDiff(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`).getTime()
  const db = new Date(`${b}T00:00:00`).getTime()
  if (Number.isNaN(da) || Number.isNaN(db)) return 9999
  return Math.abs(Math.round((da - db) / (1000 * 60 * 60 * 24)))
}

function paypalContainsCode(
  p: { riferimento: string | null; descrizione: string | null; note?: string | null },
  code: string,
): boolean {
  return [p.riferimento, p.descrizione, p.note].filter(Boolean).join(' ').includes(code)
}

function findPaypalMatch<
  TBank extends { importo: number | null; data: string; descrizione: string | null; note: string | null; riferimento: string | null },
  TPaypal extends { id: string; importo: number | null; data: string; controparte: string | null; descrizione: string | null; riferimento: string | null; note?: string | null },
>(
  bankT: TBank,
  paypal: TPaypal[],
  usedPaypalIds: Set<string>,
): { ppT: TPaypal; code: string | null; strategy: 'codice' | 'importo_data'; giorniDiff: number } | null {
  const code = extractCode(bankT.descrizione, bankT.note, bankT.riferimento)
  if (code) {
    const byCode = paypal.find(p => !usedPaypalIds.has(p.id) && paypalContainsCode(p, code))
    if (byCode) {
      return { ppT: byCode, code, strategy: 'codice', giorniDiff: daysDiff(bankT.data, byCode.data) }
    }
  }

  const bankCents = cents(bankT.importo)
  const byAmountAndDate = paypal
    .filter(p => !usedPaypalIds.has(p.id) && cents(p.importo) === bankCents)
    .map(p => ({ ppT: p, giorniDiff: daysDiff(bankT.data, p.data) }))
    .filter(match => match.giorniDiff <= 7)
    .sort((a, b) => a.giorniDiff - b.giorniDiff)[0]

  if (!byAmountAndDate) return null
  return { ppT: byAmountAndDate.ppT, code, strategy: 'importo_data', giorniDiff: byAmountAndDate.giorniDiff }
}
