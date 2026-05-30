import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/transazioni/enrich-paypal?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Per ogni trans bancaria (Qonto, Sella, ecc.) che ha come controparte
// "PayPal Europe S.a.r.l." con un codice transazione PayPal nella descrizione,
// trova la trans corrispondente nel conto PayPal (tramite riferimento) e
// ne estrae il VERO fornitore (Vimeo, Stripe, LIME, ...).
//
// Output: { enrichments: { [transId]: { realControparte, realDescrizione,
//   paypalCodice, paypalTransId } } }
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  // 1) Carica le trans bancarie del periodo con controparte che contiene
  //    "PayPal" o "paypal" (sono i bonifici uscita verso il wallet PayPal).
  let qBank = supabase
    .from('transazioni')
    .select('id, conto, importo, data, controparte, descrizione, note, riferimento, stato_riconciliazione')
    .neq('conto', 'paypal')
    .ilike('controparte', '%paypal%')
  if (from) qBank = qBank.gte('data', from)
  if (to) qBank = qBank.lte('data', to)
  const { data: bank } = await qBank.range(0, 9999)

  if (!bank || bank.length === 0) {
    return NextResponse.json({ enrichments: {} })
  }

  // 2) Per ogni trans bancaria, estrai il numero a 10+ cifre dalla descrizione,
  //    riferimento o note (è il codice transazione PayPal).
  function extractPaypalCode(...texts: (string | null | undefined)[]): string | null {
    const blob = texts.filter(Boolean).join(' ')
    const m = /\b(\d{10,})\b/.exec(blob)
    return m ? m[1] : null
  }

  const bankByCode = new Map<string, typeof bank[number]>()
  const codes: string[] = []
  for (const t of bank) {
    const code = extractPaypalCode(t.descrizione, t.note, t.riferimento)
    if (code) {
      bankByCode.set(code, t)
      codes.push(code)
    }
  }

  if (codes.length === 0) {
    return NextResponse.json({ enrichments: {} })
  }

  // 3) Cerca trans PayPal con riferimento che combacia. Finestra date estesa
  //    di ±5 giorni rispetto al periodo (i bonifici sono spesso 1-2 giorni
  //    dopo l'op PayPal).
  let qPP = supabase
    .from('transazioni')
    .select('id, importo, data, controparte, descrizione, riferimento, note')
    .eq('conto', 'paypal')
    .in('riferimento', codes)
  const { data: pp } = await qPP.range(0, 9999)

  const ppByCode = new Map<string, NonNullable<typeof pp>[number]>()
  for (const p of pp || []) {
    if (p.riferimento) ppByCode.set(String(p.riferimento), p)
  }

  // 4) Costruisci la mappa enrichments
  const enrichments: Record<string, {
    realControparte: string | null
    realDescrizione: string | null
    paypalCodice: string
    paypalTransId: string | null
    note?: string
  }> = {}
  for (const [code, bankT] of bankByCode.entries()) {
    const ppT = ppByCode.get(code)
    if (!ppT) {
      // Codice trovato nella causale bancaria ma non c'è trans PayPal con quel rif:
      // probabilmente il CSV PayPal non è stato caricato per quel periodo.
      enrichments[bankT.id] = {
        realControparte: null,
        realDescrizione: null,
        paypalCodice: code,
        paypalTransId: null,
        note: 'CSV PayPal non caricato per questo periodo',
      }
      continue
    }
    enrichments[bankT.id] = {
      realControparte: ppT.controparte,
      realDescrizione: ppT.descrizione,
      paypalCodice: code,
      paypalTransId: ppT.id,
    }
  }

  return NextResponse.json({ enrichments, count: Object.keys(enrichments).length })
}
