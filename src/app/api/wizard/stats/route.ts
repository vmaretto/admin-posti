import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Restituisce statistiche aggregate per gli step del wizard:
//   - per conto (qonto/sella/wise/paypal/...): N transazioni nel periodo
//   - per tipo fattura (emessa/ricevuta): N fatture nel periodo
//   - trans scoperte residue del periodo (per Step 4)
//   - totali generali
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!from || !to) {
    return NextResponse.json({ error: 'from/to richiesti' }, { status: 400 })
  }

  // ---- Transazioni del periodo ----
  const { data: trans } = await supabase
    .from('transazioni')
    .select('id, tipo, importo, conto, stato_riconciliazione')
    .gte('data', from)
    .lte('data', to)
    .range(0, 9999)

  const transPerConto: Record<string, { count: number; entrate: number; uscite: number; ultimaData?: string }> = {}
  let transScoperte = 0
  let transScoperteImporto = 0
  let transRiconciliate = 0
  for (const t of trans || []) {
    const conto = t.conto || '?'
    if (!transPerConto[conto]) {
      transPerConto[conto] = { count: 0, entrate: 0, uscite: 0 }
    }
    transPerConto[conto].count++
    if (t.tipo === 'entrata') transPerConto[conto].entrate += Math.abs(t.importo || 0)
    else transPerConto[conto].uscite += Math.abs(t.importo || 0)

    if (t.stato_riconciliazione === 'riconciliata') {
      transRiconciliate++
    } else if (t.stato_riconciliazione === 'da_riconciliare') {
      transScoperte++
      transScoperteImporto += Math.abs(t.importo || 0)
    }
  }

  // ---- Fatture del periodo (per tipo) ----
  const { data: fatt } = await supabase
    .from('fatture')
    .select('id, tipo, totale, stato_riconciliazione, fonte')
    .gte('data_emissione', from)
    .lte('data_emissione', to)
    .range(0, 9999)

  let fattureEmesse = 0
  let fattureRicevute = 0
  let fattureEstere = 0
  let fattureRiconciliate = 0
  let fattureScoperte = 0
  for (const f of fatt || []) {
    if (f.tipo === 'emessa') fattureEmesse++
    else if (f.tipo === 'ricevuta') fattureRicevute++
    if (f.fonte === 'estero') fattureEstere++
    if (f.stato_riconciliazione === 'riconciliata') fattureRiconciliate++
    else if (f.stato_riconciliazione === 'da_riconciliare') fattureScoperte++
  }

  return NextResponse.json({
    periodo: { from, to },
    trans: {
      totale: trans?.length || 0,
      perConto: transPerConto,
      scoperte: transScoperte,
      scoperteImporto: transScoperteImporto,
      riconciliate: transRiconciliate,
    },
    fatture: {
      totale: fatt?.length || 0,
      emesse: fattureEmesse,
      ricevute: fattureRicevute,
      estere: fattureEstere,
      riconciliate: fattureRiconciliate,
      scoperte: fattureScoperte,
    },
  })
}
