import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Parse Italian SDI CSV format
function parseSDIAmount(value: string): number {
  // Format: "000000010000,00" -> 10000.00
  const cleaned = value.replace(/['"]/g, '').trim()
  const numeric = cleaned.replace(/^0+/, '') || '0'
  return parseFloat(numeric.replace(',', '.'))
}

function parseSDIDate(value: string): string {
  // Format: DD/MM/YYYY -> YYYY-MM-DD
  const cleaned = value.replace(/['"]/g, '').trim()
  const [day, month, year] = cleaned.split('/')
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function cleanString(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim()
}

export async function POST(request: NextRequest) {
  try {
    const { csvContent, tipo } = await request.json()
    
    if (!csvContent || !tipo) {
      return NextResponse.json({ error: 'Missing csvContent or tipo' }, { status: 400 })
    }

    const supabase = createServerClient()
    const lines = csvContent.split('\n').filter((l: string) => l.trim())
    
    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV vuoto o invalido' }, { status: 400 })
    }

    const headers = lines[0].split(';').map((h: string) => cleanString(h).toLowerCase())
    const fatture = []
    const errors = []

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = lines[i].split(';')
        const row: Record<string, string> = {}
        
        headers.forEach((h: string, idx: number) => {
          row[h] = values[idx] || ''
        })

        const tipoDoc = cleanString(row['tipo documento'] || '').toLowerCase()
        const isNotaCredito = tipoDoc.includes('credito')

        const fattura = {
          tipo: tipo as 'emessa' | 'ricevuta',
          tipo_documento: isNotaCredito ? 'nota_credito' : 'fattura',
          numero: cleanString(row['numero fattura / documento'] || row['numero fattura'] || ''),
          data_emissione: parseSDIDate(row['data emissione'] || ''),
          data_ricezione: row['data consegna/presa visione'] || row['data ricezione'] 
            ? parseSDIDate(row['data consegna/presa visione'] || row['data ricezione']) 
            : null,
          piva_fornitore: cleanString(row['partita iva fornitore'] || ''),
          denominazione_fornitore: cleanString(row['denominazione fornitore'] || ''),
          piva_cliente: cleanString(row['partita iva cliente'] || ''),
          denominazione_cliente: cleanString(row['denominazione cliente'] || ''),
          imponibile: parseSDIAmount(row['imponibile/importo (totale in euro)'] || '0'),
          imposta: parseSDIAmount(row['imposta (totale in euro)'] || '0'),
          fonte: 'sdi',
          stato_riconciliazione: 'da_riconciliare'
        }

        if (fattura.numero && fattura.data_emissione) {
          fatture.push(fattura)
        }
      } catch (err) {
        errors.push({ line: i + 1, error: String(err) })
      }
    }

    if (fatture.length === 0) {
      return NextResponse.json({ error: 'Nessuna fattura valida trovata', errors }, { status: 400 })
    }

    // Upsert fatture
    const { data, error } = await supabase
      .from('fatture')
      .upsert(fatture, { 
        onConflict: 'numero,data_emissione,tipo',
        ignoreDuplicates: false 
      })
      .select()

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      imported: fatture.length,
      errors: errors.length > 0 ? errors : undefined
    })

  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
