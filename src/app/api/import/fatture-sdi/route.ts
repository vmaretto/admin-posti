import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { parseSdiCSV, type SdiTipo } from '@/lib/parsers/fatture-sdi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/import/fatture-sdi
// Body JSON: { csvContent: string, tipo: 'emessa' | 'ricevuta' }
//
// Fix rispetto alla precedente versione:
//  - Niente più upsert con onConflict su constraint inesistente.
//  - Dedup esplicito su (tipo, numero, data_emissione, fonte='sdi')
//    limitato al periodo del file (no scan dell'intero DB).
//  - Calcolo `totale` = imponibile + imposta (campo che mancava!).
//  - Gestione \\r\\n e apici singoli wrappanti i valori (es. "'F-2026-20'").
//  - Risposta allineata agli altri import: imported, skipped, parsed, periodo.
export async function POST(request: NextRequest) {
  let body: { csvContent?: string; tipo?: SdiTipo }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }
  if (!body?.csvContent || !body?.tipo) {
    return NextResponse.json({ error: 'csvContent e tipo richiesti' }, { status: 400 })
  }
  if (body.tipo !== 'emessa' && body.tipo !== 'ricevuta') {
    return NextResponse.json({ error: 'tipo deve essere "emessa" o "ricevuta"' }, { status: 400 })
  }

  const parsed = parseSdiCSV(body.csvContent, body.tipo)
  if (parsed.fatture.length === 0) {
    return NextResponse.json({
      error: 'Nessuna fattura riconosciuta nel CSV SDI.',
      warnings: parsed.warnings,
      hint: 'Verifica che sia il CSV scaricato dal cassetto fiscale.',
    }, { status: 400 })
  }

  const supabase = createServerClient()

  // Dedup esplicito: cerco fatture esistenti con stesso (tipo, numero, data_emissione)
  // dentro al periodo del file.
  let existingKeys = new Set<string>()
  if (parsed.periodoFrom && parsed.periodoTo) {
    const { data: existing } = await supabase
      .from('fatture')
      .select('numero, data_emissione, tipo')
      .eq('tipo', body.tipo)
      .gte('data_emissione', parsed.periodoFrom)
      .lte('data_emissione', parsed.periodoTo)
      .range(0, 9999)
    existingKeys = new Set(
      (existing || []).map(f => `${f.tipo}|${f.numero}|${f.data_emissione}`),
    )
  }

  const toInsert: Record<string, unknown>[] = []
  let skipped = 0
  for (const f of parsed.fatture) {
    const key = `${f.tipo}|${f.numero}|${f.data_emissione}`
    if (existingKeys.has(key)) { skipped++; continue }
    existingKeys.add(key)
    toInsert.push({
      tipo: f.tipo,
      tipo_documento: f.tipo_documento,
      numero: f.numero,
      data_emissione: f.data_emissione,
      data_ricezione: f.data_ricezione,
      piva_fornitore: f.piva_fornitore,
      denominazione_fornitore: f.denominazione_fornitore,
      piva_cliente: f.piva_cliente,
      denominazione_cliente: f.denominazione_cliente,
      imponibile: f.imponibile,
      imposta: f.imposta,
      totale: f.totale,
      fonte: 'sdi',
      stato_riconciliazione: 'da_riconciliare',
      note: f.sdi_file ? `Sdi/file: ${f.sdi_file}` : null,
    })
  }

  let inserted = 0
  if (toInsert.length > 0) {
    const { error } = await supabase.from('fatture').insert(toInsert)
    if (error) {
      return NextResponse.json({
        error: `Errore insert: ${error.message}`,
        parsed: parsed.fatture.length,
        skipped,
      }, { status: 500 })
    }
    inserted = toInsert.length
  }

  return NextResponse.json({
    success: true,
    imported: inserted,
    skipped,
    parsed: parsed.fatture.length,
    periodo: { from: parsed.periodoFrom, to: parsed.periodoTo },
    totali: { totale: parsed.totale },
    warnings: parsed.warnings,
  })
}
