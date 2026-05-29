import { NextRequest, NextResponse } from 'next/server'
import { parseSellaContoStatement } from '@/lib/parsers/sella-conto'
import { extractPdfText, insertTransazioni } from '@/lib/parsers/import-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/import/sella-conto
// FormData con campo "file" (PDF estratto conto Sella).
// Inserisce in transazioni con conto='sella_conto'.
export async function POST(request: NextRequest) {
  const { text, errorResp } = await extractPdfText(request)
  if (errorResp) return errorResp

  const parsed = parseSellaContoStatement(text!)
  if (!parsed.transactions.length) {
    return NextResponse.json({
      error: 'Nessuna transazione riconosciuta nel PDF Sella conto.',
      warnings: parsed.warnings,
    }, { status: 400 })
  }

  return insertTransazioni(
    'sella_conto',
    parsed.transactions.map(t => ({
      data: t.data,
      importo: t.importo,
      tipo: t.tipo,
      controparte: t.controparte,
      descrizione: t.descrizione,
      riferimento: null,
      note: t.dataValuta ? `Data valuta: ${t.dataValuta}` : null,
    })),
    { from: parsed.periodoFrom, to: parsed.periodoTo },
    {
      saldo: { iniziale: parsed.saldoIniziale, finale: parsed.saldoFinale },
      totali: { entrate: parsed.totaleEntrate, uscite: parsed.totaleUscite },
      warnings: parsed.warnings,
    },
  )
}
