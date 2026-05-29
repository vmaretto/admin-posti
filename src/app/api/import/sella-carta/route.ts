import { NextRequest, NextResponse } from 'next/server'
import { parseSellaCartaStatement } from '@/lib/parsers/sella-carta'
import { extractPdfText, insertTransazioni } from '@/lib/parsers/import-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/import/sella-carta
// FormData con campo "file" (PDF promemoria carta Sella Visa Business).
// Inserisce in transazioni con conto='sella_carta'.
export async function POST(request: NextRequest) {
  const { text, errorResp } = await extractPdfText(request)
  if (errorResp) return errorResp

  const parsed = parseSellaCartaStatement(text!)
  if (!parsed.transactions.length) {
    return NextResponse.json({
      error: 'Nessuna transazione riconosciuta nel PDF Sella carta.',
      warnings: parsed.warnings,
    }, { status: 400 })
  }

  return insertTransazioni(
    'sella_carta',
    parsed.transactions.map(t => ({
      data: t.data,
      importo: t.importo,
      tipo: t.tipo,
      controparte: t.controparte,
      descrizione: t.descrizione,
      riferimento: null,
      note: [
        t.categoria ? `Categoria: ${t.categoria}` : null,
        t.carta ? `Carta: ${t.carta}` : null,
        parsed.utilizzatore ? `Utilizzatore: ${parsed.utilizzatore}` : null,
        t.valuta_originale ? `Valuta originale: ${t.valuta_originale}` : null,
      ].filter(Boolean).join(' · ') || null,
    })),
    { from: parsed.periodoFrom, to: parsed.periodoTo },
    {
      totali: { entrate: 0, uscite: parsed.totaleUscite },
      warnings: parsed.warnings,
    },
  )
}
