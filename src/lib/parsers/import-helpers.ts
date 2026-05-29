// Helper condiviso per gli endpoint /api/import/<conto>.
//
// Riceve il File PDF dalla FormData, estrae il testo via pdf-parse v1,
// applica un parser specifico e fa l'insert in tabella transazioni con
// dedup su (conto, data, importo, controparte).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export interface ParsedTransazione {
  data: string // YYYY-MM-DD
  importo: number
  tipo: 'entrata' | 'uscita'
  controparte: string
  descrizione: string | null
  riferimento: string | null
  note: string | null
}

export interface ImportResponseExtras {
  periodo?: { from: string | null; to: string | null }
  saldo?: { iniziale: number | null; finale: number | null }
  totali?: { entrate: number | null; uscite: number | null }
  warnings?: string[]
}

/** Estrae il testo dal PDF presente nel form-data, campo "file" */
export async function extractPdfText(request: NextRequest): Promise<{ text?: string; errorResp?: NextResponse }> {
  let buffer: Buffer
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') {
      return { errorResp: NextResponse.json({ error: 'File non fornito' }, { status: 400 }) }
    }
    const arrayBuffer = await (file as Blob).arrayBuffer()
    buffer = Buffer.from(arrayBuffer)
  } catch (e: unknown) {
    return {
      errorResp: NextResponse.json(
        { error: e instanceof Error ? e.message : 'Errore lettura file' },
        { status: 400 },
      ),
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse: any = (await import('pdf-parse/lib/pdf-parse.js' as string)).default
    const data = await pdfParse(buffer)
    return { text: data.text || '' }
  } catch (e: unknown) {
    return {
      errorResp: NextResponse.json(
        { error: `Errore parsing PDF: ${e instanceof Error ? e.message : 'sconosciuto'}` },
        { status: 500 },
      ),
    }
  }
}

/**
 * Inserisce le trans in DB con dedup su (conto, data, importo, controparte)
 * limitato al periodo per non scansionare tutto il DB.
 */
export async function insertTransazioni(
  conto: string,
  rows: ParsedTransazione[],
  periodo: { from: string | null; to: string | null },
  extras?: ImportResponseExtras,
): Promise<NextResponse> {
  if (rows.length === 0) {
    return NextResponse.json({
      error: 'Nessuna transazione riconosciuta',
      ...extras,
      hint: 'Il file non sembra essere nel formato atteso. Verifica o mandami il PDF per integrazione.',
    }, { status: 400 })
  }

  const supabase = createServerClient()

  // Carica esistenti nel periodo per dedup
  let existingKeys = new Set<string>()
  if (periodo.from && periodo.to) {
    const { data: existing } = await supabase
      .from('transazioni')
      .select('data, importo, controparte')
      .eq('conto', conto)
      .gte('data', periodo.from)
      .lte('data', periodo.to)
      .range(0, 9999)
    existingKeys = new Set(
      (existing || []).map(t => `${t.data}|${Number(t.importo).toFixed(2)}|${(t.controparte || '').trim().toLowerCase()}`),
    )
  }

  const toInsert: Record<string, unknown>[] = []
  let skipped = 0
  for (const r of rows) {
    const key = `${r.data}|${r.importo.toFixed(2)}|${r.controparte.trim().toLowerCase()}`
    if (existingKeys.has(key)) { skipped++; continue }
    existingKeys.add(key)
    toInsert.push({
      conto,
      data: r.data,
      importo: r.importo,
      tipo: r.tipo,
      controparte: r.controparte,
      descrizione: r.descrizione || r.controparte,
      riferimento: r.riferimento,
      note: r.note,
      stato_riconciliazione: 'da_riconciliare',
    })
  }

  let inserted = 0
  if (toInsert.length > 0) {
    const { error } = await supabase.from('transazioni').insert(toInsert)
    if (error) {
      return NextResponse.json({
        error: `Errore insert: ${error.message}`,
        parsed: rows.length,
        skipped,
      }, { status: 500 })
    }
    inserted = toInsert.length
  }

  return NextResponse.json({
    success: true,
    imported: inserted,
    skipped,
    parsed: rows.length,
    periodo,
    ...extras,
  })
}
