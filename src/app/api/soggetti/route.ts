import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function normalizeName(name: string | null): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(srl|spa|snc|sas|srls|sapa|ltd|inc|gmbh|sarl|s r l|s p a)\b/g, '')
    .trim();
}

export async function GET() {
  const supabase = createServerClient()
  
  // Get all fatture
  const { data: fatture } = await supabase
    .from('fatture')
    .select('id, numero, tipo, totale, data_emissione, stato_riconciliazione, denominazione_fornitore, denominazione_cliente')
    .range(0, 9999)
  
  // Get all transazioni
  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('id, importo, tipo, data, conto, stato_riconciliazione, controparte')
    .range(0, 9999)
  
  // Map: normalized name -> { original name, fatture, transazioni }
  const soggettiMap = new Map<string, {
    originalName: string
    fatture: any[]
    transazioni: any[]
  }>()
  
  // Process fatture
  for (const f of fatture || []) {
    const denom = f.tipo === 'emessa' 
      ? f.denominazione_cliente 
      : f.denominazione_fornitore
    
    if (!denom) continue
    
    const normalizedKey = normalizeName(denom)
    if (!normalizedKey) continue
    
    if (!soggettiMap.has(normalizedKey)) {
      soggettiMap.set(normalizedKey, { 
        originalName: denom, 
        fatture: [], 
        transazioni: [] 
      })
    }
    
    soggettiMap.get(normalizedKey)!.fatture.push({
      id: f.id,
      numero: f.numero,
      tipo: f.tipo,
      totale: f.totale,
      data: f.data_emissione,
      stato: f.stato_riconciliazione
    })
  }
  
  // Process transazioni - match to subjects by normalized name
  for (const t of transazioni || []) {
    if (!t.controparte) continue
    
    const normalizedControparte = normalizeName(t.controparte)
    if (!normalizedControparte) continue
    
    // Try exact normalized match first
    let matchedKey = ''
    
    if (soggettiMap.has(normalizedControparte)) {
      matchedKey = normalizedControparte
    } else {
      // Try partial match - only if the match is significant (>5 chars)
      for (const key of soggettiMap.keys()) {
        // Require that the contained string is at least 6 characters to avoid false positives
        // like "ae" matching "officinae"
        if (normalizedControparte.length >= 6 && key.includes(normalizedControparte)) {
          matchedKey = key
          break
        }
        if (key.length >= 6 && normalizedControparte.includes(key)) {
          matchedKey = key
          break
        }
        // Check if first significant word matches (must be >4 chars)
        const keyWords = key.split(' ').filter(w => w.length > 4)
        const contWords = normalizedControparte.split(' ').filter(w => w.length > 4)
        if (keyWords.length > 0 && contWords.length > 0 && keyWords[0] === contWords[0]) {
          matchedKey = key
          break
        }
      }
    }
    
    // If no match found, create new subject
    if (!matchedKey) {
      matchedKey = normalizedControparte
      soggettiMap.set(matchedKey, {
        originalName: t.controparte,
        fatture: [],
        transazioni: []
      })
    }
    
    soggettiMap.get(matchedKey)!.transazioni.push({
      id: t.id,
      importo: Math.abs(t.importo),
      tipo: t.tipo,
      data: t.data,
      conto: t.conto,
      stato: t.stato_riconciliazione
    })
  }
  
  // Convert to array and calculate totals
  const soggetti = Array.from(soggettiMap.values())
    .map(data => {
      const totaleFatture = data.fatture.reduce((sum, f) => sum + (f.totale || 0), 0)
      const totaleTransazioni = data.transazioni.reduce((sum, t) => sum + (t.importo || 0), 0)
      
      return {
        denominazione: data.originalName,
        fatture: data.fatture.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()),
        transazioni: data.transazioni.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()),
        totaleFatture,
        totaleTransazioni,
        saldo: totaleFatture - totaleTransazioni
      }
    })
    .filter(s => s.fatture.length > 0 || s.transazioni.length > 0)
    .sort((a, b) => (b.totaleFatture + b.totaleTransazioni) - (a.totaleFatture + a.totaleTransazioni))
  
  return NextResponse.json(soggetti)
}
