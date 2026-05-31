import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const BUCKET = 'fatture-estere'

// POST /api/wizard/upload-fattura-estera
// Variante "upload" dello Step 5: invece di digitare i dati e creare la
// fattura da zero, si carica il PDF della fattura del fornitore estero. Il
// file viene salvato su Supabase Storage (bucket privato), la fattura viene
// creata con il path dell'allegato e collegata alla transazione (entrambe
// passano in stato 'riconciliata').
//
// Richiede multipart/form-data:
//   file                      -> il PDF della fattura (obbligatorio)
//   transazione_id            -> UUID (obbligatorio)
//   denominazione_fornitore   -> string (obbligatorio)
//   data_emissione            -> 'YYYY-MM-DD' (obbligatorio)
//   totale                    -> number (obbligatorio)
//   numero                    -> string (opzionale: se vuoto viene generato)
//   valuta                    -> string (opzionale, default 'EUR')
//   importo_originale         -> number (opzionale)
//   piva_fornitore            -> string (opzionale)
//   note                      -> string (opzionale)
//   wizard_periodo_id         -> UUID (opzionale: rimuove la trans dalla queue)
export async function POST(request: NextRequest) {
  const supabase = createServerClient()

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart/form-data atteso' }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'file (PDF) obbligatorio' }, { status: 400 })
  }

  const transazione_id = String(form.get('transazione_id') || '').trim()
  const denominazione_fornitore = String(form.get('denominazione_fornitore') || '').trim()
  const data_emissione = String(form.get('data_emissione') || '').trim()
  const totale = Number(form.get('totale'))

  if (!transazione_id) {
    return NextResponse.json({ error: 'transazione_id obbligatorio' }, { status: 400 })
  }
  if (!denominazione_fornitore || !data_emissione) {
    return NextResponse.json({ error: 'denominazione_fornitore e data_emissione richiesti' }, { status: 400 })
  }
  if (!isFinite(totale) || totale <= 0) {
    return NextResponse.json({ error: 'totale deve essere un numero positivo' }, { status: 400 })
  }

  const valuta = String(form.get('valuta') || 'EUR').trim() || 'EUR'
  const importoOriginaleRaw = Number(form.get('importo_originale'))
  const importo_originale = isFinite(importoOriginaleRaw) && importoOriginaleRaw > 0 ? importoOriginaleRaw : totale
  const piva_fornitore = String(form.get('piva_fornitore') || '').trim()
  const note = String(form.get('note') || '').trim()
  const wizard_periodo_id = String(form.get('wizard_periodo_id') || '').trim()

  // Numero: se non fornito, ne generiamo uno deterministico leggibile.
  let numero = String(form.get('numero') || '').trim()
  if (!numero) {
    numero = `EST-${data_emissione.replace(/-/g, '')}-${transazione_id.slice(0, 8)}`
  }

  // 1) Verifica che la trans esista
  const { data: trans } = await supabase
    .from('transazioni')
    .select('id, importo, tipo, controparte')
    .eq('id', transazione_id)
    .maybeSingle()
  if (!trans) {
    return NextResponse.json({ error: 'transazione non trovata' }, { status: 404 })
  }

  // 2) Carica il file su storage.
  const safeName = (file.name || 'fattura.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')
  const objectPath = `${wizard_periodo_id || 'misc'}/${transazione_id}/${Date.now()}-${safeName}`
  const bytes = Buffer.from(await file.arrayBuffer())
  const { error: errUp } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, bytes, {
      contentType: file.type || 'application/pdf',
      upsert: false,
    })
  if (errUp) {
    return NextResponse.json({ error: `Errore upload file: ${errUp.message}` }, { status: 500 })
  }

  // 3) Inserisci la fattura estera (fonte='estero', tipo='ricevuta'), già
  //    collegata alla trans e in stato 'riconciliata', con path dell'allegato.
  const fatturaPayload: Record<string, unknown> = {
    tipo: 'ricevuta',
    tipo_documento: 'fattura',
    fonte: 'estero',
    numero,
    denominazione_fornitore,
    data_emissione,
    totale,
    imponibile: totale,
    imposta: 0,
    valuta,
    importo_originale,
    transazione_id,
    stato_riconciliazione: 'riconciliata',
    piva_fornitore: piva_fornitore || null,
    note: note || null,
    allegato_path: objectPath,
  }
  const { data: fattura, error: errFat } = await supabase
    .from('fatture')
    .insert(fatturaPayload)
    .select()
    .single()
  if (errFat) {
    // rollback best-effort del file caricato
    await supabase.storage.from(BUCKET).remove([objectPath])
    return NextResponse.json({ error: `Errore creazione fattura: ${errFat.message}` }, { status: 500 })
  }

  // 4) Aggiorna stato transazione
  await supabase
    .from('transazioni')
    .update({ stato_riconciliazione: 'riconciliata', updated_at: new Date().toISOString() })
    .eq('id', transazione_id)

  // 5) Inserisci in riconciliazioni (idempotente)
  await supabase
    .from('riconciliazioni')
    .upsert(
      { fattura_id: fattura.id, transazione_id },
      { onConflict: 'fattura_id' },
    )

  // 6) Se passato wizard_periodo_id, rimuovi la trans dalla queue
  if (wizard_periodo_id) {
    const { data: periodo } = await supabase
      .from('wizard_periodi')
      .select('trans_estere_queue')
      .eq('id', wizard_periodo_id)
      .maybeSingle()
    if (periodo) {
      const newQueue = (periodo.trans_estere_queue || []).filter(
        (id: string) => id !== transazione_id,
      )
      await supabase
        .from('wizard_periodi')
        .update({ trans_estere_queue: newQueue })
        .eq('id', wizard_periodo_id)
    }
  }

  // 7) URL firmato per consultare il file appena caricato (1 settimana)
  let signedUrl: string | null = null
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, 60 * 60 * 24 * 7)
  if (signed?.signedUrl) signedUrl = signed.signedUrl

  return NextResponse.json({ success: true, fattura, allegato_path: objectPath, signedUrl })
}
