import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/riconcilia/lista?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Restituisce tutti gli abbinamenti riconciliati nel periodo. Una riga per
// coppia (fattura, transazione). Una transazione può comparire con più fatture
// (N:1) se è un pagamento aggregato.
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  // Prendi tutte le fatture riconciliate nel periodo (data_emissione)
  let qFat = supabase
    .from('fatture')
    .select('id, numero, tipo, totale, data_emissione, transazione_id, denominazione_cliente, denominazione_fornitore')
    .eq('stato_riconciliazione', 'riconciliata')
    .not('transazione_id', 'is', null)
    .order('data_emissione', { ascending: false })
  if (from) qFat = qFat.gte('data_emissione', from)
  if (to) qFat = qFat.lte('data_emissione', to)
  const { data: fatture } = await qFat.range(0, 9999)

  if (!fatture || fatture.length === 0) {
    return NextResponse.json({ count: 0, abbinamenti: [] })
  }

  // Carica le trans collegate
  const transIds = Array.from(new Set(fatture.map(f => f.transazione_id).filter(Boolean) as string[]))
  const { data: trans } = await supabase
    .from('transazioni')
    .select('id, importo, tipo, data, conto, controparte, descrizione, riferimento')
    .in('id', transIds)
    .range(0, 9999)
  const transMap = new Map<string, NonNullable<typeof trans>[number]>()
  for (const t of trans || []) transMap.set(t.id, t)

  // Costruisci righe abbinamento
  const abbinamenti = fatture.map(f => {
    const t = f.transazione_id ? transMap.get(f.transazione_id) : null
    const soggetto = f.tipo === 'emessa' ? f.denominazione_cliente : f.denominazione_fornitore
    return {
      fattura: {
        id: f.id,
        numero: f.numero,
        tipo: f.tipo,
        totale: f.totale,
        data: f.data_emissione,
        soggetto,
      },
      trans: t ? {
        id: t.id,
        importo: t.importo,
        tipo: t.tipo,
        data: t.data,
        conto: t.conto,
        controparte: t.controparte,
        descrizione: t.descrizione,
        riferimento: t.riferimento,
      } : null,
      differenza: t ? Math.abs((f.totale || 0) - Math.abs(t.importo || 0)) : null,
    }
  })

  // Ordina per data fattura decrescente
  abbinamenti.sort((a, b) => {
    const da = a.fattura.data || ''
    const db = b.fattura.data || ''
    return db.localeCompare(da)
  })

  return NextResponse.json({
    count: abbinamenti.length,
    periodo: from && to ? { from, to } : null,
    abbinamenti,
  })
}
