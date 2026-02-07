import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function parsePayPalDate(dateStr: string): string {
  // Format: DD/MM/YYYY -> YYYY-MM-DD
  const cleaned = dateStr.replace(/['"]/g, '').trim()
  const [day, month, year] = cleaned.split('/')
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function parsePayPalAmount(value: string): number {
  // Format: "-123,01" or "123,01"
  const cleaned = value.replace(/['"]/g, '').trim()
  return parseFloat(cleaned.replace(',', '.').replace(/\s/g, ''))
}

function cleanString(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim()
}

export async function POST(request: NextRequest) {
  try {
    const { csvContent } = await request.json()
    
    if (!csvContent) {
      return NextResponse.json({ error: 'Missing csvContent' }, { status: 400 })
    }

    const supabase = createServerClient()
    const lines = csvContent.split('\n').filter((l: string) => l.trim())
    
    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV vuoto o invalido' }, { status: 400 })
    }

    // PayPal CSV uses comma as separator with quoted fields
    const parseCSVLine = (line: string): string[] => {
      const result = []
      let current = ''
      let inQuotes = false
      
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes
        } else if (char === ',' && !inQuotes) {
          result.push(current)
          current = ''
        } else {
          current += char
        }
      }
      result.push(current)
      return result
    }

    const headers = parseCSVLine(lines[0]).map(h => cleanString(h).toLowerCase())
    const transazioni = []
    const errors = []

    // Find column indices
    const dataIdx = headers.findIndex(h => h === 'data')
    const nomeIdx = headers.findIndex(h => h === 'nome')
    const tipoIdx = headers.findIndex(h => h === 'tipo')
    const statoIdx = headers.findIndex(h => h === 'stato')
    const nettoIdx = headers.findIndex(h => h === 'netto')
    const lordoIdx = headers.findIndex(h => h === 'lordo')
    const codiceIdx = headers.findIndex(h => h.includes('codice transazione') && !h.includes('riferimento'))
    const oggettoIdx = headers.findIndex(h => h.includes('titolo oggetto'))

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i])
        
        const stato = cleanString(values[statoIdx] || '')
        const tipo = cleanString(values[tipoIdx] || '')
        
        // Skip pending transactions and bank transfers (duplicates)
        if (stato.toLowerCase().includes('sospeso') || 
            tipo.toLowerCase().includes('bonifico bancario')) {
          continue
        }

        const importo = parsePayPalAmount(values[nettoIdx] || values[lordoIdx] || '0')
        
        if (importo === 0) continue

        const transazione = {
          data: parsePayPalDate(values[dataIdx] || ''),
          importo: Math.abs(importo),
          tipo: importo < 0 ? 'uscita' : 'entrata',
          descrizione: cleanString(values[oggettoIdx] || values[tipoIdx] || ''),
          controparte: cleanString(values[nomeIdx] || ''),
          conto: 'paypal',
          riferimento: cleanString(values[codiceIdx] || ''),
          stato_riconciliazione: 'da_riconciliare'
        }

        if (transazione.data && transazione.riferimento) {
          transazioni.push(transazione)
        }
      } catch (err) {
        errors.push({ line: i + 1, error: String(err) })
      }
    }

    if (transazioni.length === 0) {
      return NextResponse.json({ error: 'Nessuna transazione valida trovata', errors }, { status: 400 })
    }

    // Upsert transazioni
    const { data, error } = await supabase
      .from('transazioni')
      .upsert(transazioni, { 
        onConflict: 'data,importo,conto,riferimento',
        ignoreDuplicates: true 
      })
      .select()

    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      imported: transazioni.length,
      errors: errors.length > 0 ? errors : undefined
    })

  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
