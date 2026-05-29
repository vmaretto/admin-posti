import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { parseQontoStatement } from '@/lib/parsers/qonto'

export const dynamic = 'force-dynamic'
// pdf-parse fa side-effect su Node — niente edge runtime
export const runtime = 'nodejs'

// POST /api/import/qonto
// Body: multipart/form-data con campo "file" (PDF dell'estratto conto Qonto)
// Inserisce le transazioni in tabella `transazioni` con conto='qonto'.
// Idempotente: cerca duplicati su (conto, data, importo, controparte) prima
// di inserire.
export async function POST(request: NextRequest) {
  const supabase = createServerClient()

  let buffer: Buffer
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'File non fornito' }, { status: 400 })
    }
    const arrayBuffer = await (file as Blob).arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Errore lettura file' },
      { status: 400 },
    )
  }

  // Estrai il testo dal PDF
  let text = ''
  try {
    // pdf-parse v2 — import default
    const pdfParseModule = await import('pdf-parse')
    // pdf-parse v2 supporta sia default function che oggetto con .default
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse: any = (pdfParseModule as any).default || pdfParseModule
    const data = await pdfParse(buffer)
    text = data.text || ''
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `Errore parsing PDF: ${e instanceof Error ? e.message : 'sconosciuto'}` },
      { status: 500 },
    )
  }

  if (!text.trim()) {
    return NextResponse.json({ error: 'Testo estratto dal PDF è vuoto' }, { status: 400 })
  }

  const parsed = parseQontoStatement(text)
  if (parsed.transactions.length === 0) {
    return NextResponse.json({
      error: 'Nessuna transazione riconosciuta',
      warnings: parsed.warnings,
      hint: 'Il PDF non sembra essere un estratto conto Qonto standard. Mandami il file per integrarne il formato.',
    }, { status: 400 })
  }

  // Trova duplicati esistenti per (conto='qonto', data, importo, controparte)
  // dentro al periodo coperto dal file (evita di scansionare l'intero DB).
  let existingKeys = new Set<string>()
  if (parsed.periodoFrom && parsed.periodoTo) {
    const { data: existing } = await supabase
      .from('transazioni')
      .select('data, importo, controparte')
      .eq('conto', 'qonto')
      .gte('data', parsed.periodoFrom)
      .lte('data', parsed.periodoTo)
      .range(0, 9999)
    existingKeys = new Set(
      (existing || []).map(t => `${t.data}|${Number(t.importo).toFixed(2)}|${(t.controparte || '').trim().toLowerCase()}`),
    )
  }

  // Costruisci le righe da inserire (skippa duplicati)
  const toInsert = []
  let skipped = 0
  for (const t of parsed.transactions) {
    const key = `${t.data}|${t.importo.toFixed(2)}|${t.controparte.trim().toLowerCase()}`
    if (existingKeys.has(key)) {
      skipped++
      continue
    }
    existingKeys.add(key)
    toInsert.push({
      conto: 'qonto',
      data: t.data,
      importo: t.importo,
      tipo: t.tipo,
      controparte: t.controparte,
      descrizione: t.descrizione || (t.controparte || null),
      riferimento: t.riferimento,
      note: t.valuta_originale
        ? `Importo originale: ${t.importo_originale} ${t.valuta_originale}${t.carta ? ` · ${t.carta}` : ''}`
        : (t.carta ? `Carta ${t.carta}` : null),
      stato_riconciliazione: 'da_riconciliare',
    })
  }

  let inserted = 0
  if (toInsert.length > 0) {
    const { error } = await supabase.from('transazioni').insert(toInsert)
    if (error) {
      return NextResponse.json({
        error: `Errore insert: ${error.message}`,
        parsed: parsed.transactions.length,
        skipped,
      }, { status: 500 })
    }
    inserted = toInsert.length
  }

  return NextResponse.json({
    success: true,
    imported: inserted,
    skipped, // duplicati già presenti
    parsed: parsed.transactions.length,
    periodo: { from: parsed.periodoFrom, to: parsed.periodoTo },
    saldo: { iniziale: parsed.saldoIniziale, finale: parsed.saldoFinale },
    totali: { entrate: parsed.totaleEntrate, uscite: parsed.totaleUscite },
    warnings: parsed.warnings,
  })
}
