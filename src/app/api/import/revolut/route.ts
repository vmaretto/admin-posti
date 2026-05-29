import { NextRequest, NextResponse } from 'next/server'
import { parseRevolutStatement } from '@/lib/parsers/revolut'
import { extractPdfText, insertTransazioni } from '@/lib/parsers/import-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/import/revolut
// FormData con campo "file" (PDF Revolut Business statement).
// Inserisce in transazioni con conto='revolut'.
export async function POST(request: NextRequest) {
  const { text, errorResp } = await extractPdfText(request)
  if (errorResp) return errorResp

  const parsed = parseRevolutStatement(text!)
  if (!parsed.transactions.length) {
    return NextResponse.json({
      error: 'Nessuna transazione riconosciuta nel PDF Revolut.',
      warnings: parsed.warnings,
    }, { status: 400 })
  }

  return insertTransazioni(
    'revolut',
    parsed.transactions.map(t => ({
      data: t.data,
      importo: t.importo,
      tipo: t.tipo,
      controparte: t.controparte,
      descrizione: t.descrizione,
      riferimento: null,
      note: `Tipo Revolut: ${t.tipoCodice}${t.saldoDopo !== null ? ` · Saldo dopo: ${t.saldoDopo}` : ''}`,
    })),
    { from: parsed.periodoFrom, to: parsed.periodoTo },
    {
      saldo: { iniziale: parsed.saldoIniziale, finale: parsed.saldoFinale },
      totali: { entrate: parsed.totaleEntrate, uscite: parsed.totaleUscite },
      warnings: parsed.warnings,
    },
  )
}
