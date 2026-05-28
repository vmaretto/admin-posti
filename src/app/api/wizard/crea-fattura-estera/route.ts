import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/wizard/crea-fattura-estera
// Crea una fattura estera (fonte='estero') e la collega alla transazione
// indicata (la riconcilia in un colpo solo). Aggiorna anche stato della
// transazione e inserisce una riga in riconciliazioni.
//
// Body:
//   {
//     transazione_id: UUID,           // obbligatorio
//     numero: string,
//     denominazione_fornitore: string,
//     data_emissione: 'YYYY-MM-DD',
//     totale: number,
//     valuta?: string,                // default 'EUR'
//     importo_originale?: number,     // se valuta != EUR
//     piva_fornitore?: string,
//     note?: string,
//     wizard_periodo_id?: UUID,       // se passato, rimuove la trans dalla queue
//   }
export async function POST(request: NextRequest) {
  const supabase = createServerClient()

  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }

  if (!body?.transazione_id) {
    return NextResponse.json({ error: 'transazione_id obbligatorio' }, { status: 400 })
  }
  if (!body?.numero || !body?.denominazione_fornitore || !body?.data_emissione) {
    return NextResponse.json({ error: 'numero, denominazione_fornitore, data_emissione richiesti' }, { status: 400 })
  }
  const totale = Number(body.totale)
  if (!isFinite(totale) || totale <= 0) {
    return NextResponse.json({ error: 'totale deve essere un numero positivo' }, { status: 400 })
  }

  // 1) Verifica che la trans esista
  const { data: trans } = await supabase
    .from('transazioni')
    .select('id, importo, tipo, controparte')
    .eq('id', body.transazione_id)
    .maybeSingle()
  if (!trans) {
    return NextResponse.json({ error: 'transazione non trovata' }, { status: 404 })
  }

  // 2) Inserisci la fattura estera (fonte='estero', tipo='ricevuta' per default
  //    perché i casi tipici sono fornitori esteri / costi). Già collegata alla
  //    trans tramite transazione_id, già in stato 'riconciliata'.
  const fatturaPayload: Record<string, unknown> = {
    tipo: 'ricevuta',
    tipo_documento: 'fattura',
    fonte: 'estero',
    numero: String(body.numero).trim(),
    denominazione_fornitore: String(body.denominazione_fornitore).trim(),
    data_emissione: body.data_emissione,
    totale,
    imponibile: totale,
    imposta: 0,
    valuta: body.valuta || 'EUR',
    importo_originale: body.importo_originale ?? totale,
    transazione_id: body.transazione_id,
    stato_riconciliazione: 'riconciliata',
    piva_fornitore: body.piva_fornitore || null,
    note: body.note || null,
  }
  const { data: fattura, error: errFat } = await supabase
    .from('fatture')
    .insert(fatturaPayload)
    .select()
    .single()
  if (errFat) {
    return NextResponse.json({ error: `Errore creazione fattura: ${errFat.message}` }, { status: 500 })
  }

  // 3) Aggiorna stato transazione
  await supabase
    .from('transazioni')
    .update({ stato_riconciliazione: 'riconciliata', updated_at: new Date().toISOString() })
    .eq('id', body.transazione_id)

  // 4) Inserisci in riconciliazioni (idempotente)
  await supabase
    .from('riconciliazioni')
    .upsert(
      { fattura_id: fattura.id, transazione_id: body.transazione_id },
      { onConflict: 'fattura_id' },
    )

  // 5) Se passato wizard_periodo_id, rimuovi la trans dalla queue
  if (body.wizard_periodo_id) {
    const { data: periodo } = await supabase
      .from('wizard_periodi')
      .select('trans_estere_queue')
      .eq('id', body.wizard_periodo_id)
      .maybeSingle()
    if (periodo) {
      const newQueue = (periodo.trans_estere_queue || []).filter(
        (id: string) => id !== body.transazione_id,
      )
      await supabase
        .from('wizard_periodi')
        .update({ trans_estere_queue: newQueue })
        .eq('id', body.wizard_periodo_id)
    }
  }

  return NextResponse.json({ success: true, fattura })
}
