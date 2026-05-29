import { NextRequest, NextResponse } from 'next/server'
import { parsePayPalCSV } from '@/lib/parsers/paypal-csv'
import { insertTransazioni } from '@/lib/parsers/import-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/import/paypal
// Body JSON: { csvContent: string }  (compatibilità retro con la pagina /import)
// Inserisce in transazioni con conto='paypal'.
//
// Fix rispetto alla precedente versione:
//  - Strip BOM UTF-8 (Data, prima riga)
//  - Skip righe "In sospeso" e "Bonifico bancario" (anti-duplicato del movimento)
//  - Dedup su (conto, data, importo, controparte) limitato al periodo, niente
//    più upsert su constraint inesistente.
//  - Risposta allineata agli altri parser: { imported, skipped, parsed, periodo, ... }
export async function POST(request: NextRequest) {
  let body: { csvContent?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }
  if (!body?.csvContent) {
    return NextResponse.json({ error: 'csvContent richiesto' }, { status: 400 })
  }

  const parsed = parsePayPalCSV(body.csvContent)
  if (parsed.transactions.length === 0) {
    return NextResponse.json({
      error: 'Nessuna transazione riconosciuta nel CSV PayPal.',
      warnings: parsed.warnings,
      hint: 'Verifica che sia un export PayPal con header italiano. In caso di dubbio mandami il file.',
    }, { status: 400 })
  }

  return insertTransazioni(
    'paypal',
    parsed.transactions.map(t => ({
      data: t.data,
      importo: t.importo,
      tipo: t.tipo,
      controparte: t.controparte,
      descrizione: t.descrizione,
      riferimento: t.riferimento,
      note: [
        t.riferimentoOrig ? `Codice rif. PayPal: ${t.riferimentoOrig}` : null,
        t.emailContraente ? `Email: ${t.emailContraente}` : null,
      ].filter(Boolean).join(' · ') || null,
    })),
    { from: parsed.periodoFrom, to: parsed.periodoTo },
    {
      totali: { entrate: parsed.totaleEntrate, uscite: parsed.totaleUscite },
      warnings: parsed.warnings,
    },
  )
}
