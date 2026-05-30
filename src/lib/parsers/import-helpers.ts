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

  // Post-import: tenta dedup PayPal in modo asincrono (non blocca la risposta)
  // Identifica trans bancarie giroconto-al-wallet che hanno un match con
  // trans PayPal già caricate.
  let dedupedPaypal = 0
  if (periodo.from && periodo.to) {
    try {
      // Chiamata interna: usa lo stesso supabase client per dedup
      // Invece di fare una HTTP call interna, replico la logica qui.
      const { data: bank } = await supabase
        .from('transazioni')
        .select('id, conto, importo, descrizione, note, riferimento')
        .neq('conto', 'paypal')
        .ilike('controparte', '%paypal%')
        .eq('stato_riconciliazione', 'da_riconciliare')
        .gte('data', periodo.from)
        .lte('data', periodo.to)
        .range(0, 9999)

      if (bank && bank.length > 0) {
        const codes: string[] = []
        const bankByCode = new Map<string, typeof bank[number]>()
        for (const t of bank) {
          const blob = [t.descrizione, t.note, t.riferimento].filter(Boolean).join(' ')
          const m = /\b(\d{10,})\b/.exec(blob)
          if (m) {
            codes.push(m[1])
            bankByCode.set(m[1], t)
          }
        }
        if (codes.length > 0) {
          const { data: pp } = await supabase
            .from('transazioni')
            .select('id, controparte, descrizione, riferimento')
            .eq('conto', 'paypal')
            .in('riferimento', codes)
            .range(0, 9999)
          const ppByCode = new Map<string, NonNullable<typeof pp>[number]>()
          for (const p of pp || []) {
            if (p.riferimento) ppByCode.set(String(p.riferimento), p)
          }
          for (const [code, bankT] of bankByCode.entries()) {
            const ppT = ppByCode.get(code)
            if (!ppT) continue
            const realFornitore = ppT.controparte || ppT.descrizione || null
            const tag = `[Tralasciata: Spostamento tra conti]`
            const nota = `${tag}\nGiroconto a wallet PayPal · vero fornitore: ${realFornitore || 'sconosciuto'} · codice PayPal ${code}${bankT.note ? '\n' + bankT.note : ''}`
            await supabase
              .from('transazioni')
              .update({
                stato_riconciliazione: 'non_trovata',
                note: nota,
                updated_at: new Date().toISOString(),
              })
              .eq('id', bankT.id)
            dedupedPaypal++
          }
        }
      }
    } catch {
      // best effort, non blocca l'import
    }
  }

  return NextResponse.json({
    success: true,
    imported: inserted,
    skipped,
    parsed: rows.length,
    periodo,
    dedupedPaypal,
    ...extras,
  })
}
