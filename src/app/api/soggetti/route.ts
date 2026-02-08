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
  
  // Get all transazioni (only those linked to fatture)
  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('id, importo, tipo, data, conto, stato_riconciliazione, controparte, fattura_id')
    .not('fattura_id', 'is', null)
    .range(0, 9999)
  
  // Build fattura_id -> fattura map
  const fatturaMap = new Map<string, any>()
  for (const f of fatture || []) {
    fatturaMap.set(f.id, f)
  }
  
  // Map: normalized name -> { original name, fatture, transazioni }
  const soggettiMap = new Map<string, {
    originalName: string
    fatture: any[]
    transazioni: any[]
  }>()
  
  // Process fatture - group by soggetto
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
  
  // Process transazioni - associate to soggetto via fattura_id
  for (const t of transazioni || []) {
    if (!t.fattura_id) continue
    
    const fattura = fatturaMap.get(t.fattura_id)
    if (!fattura) continue
    
    const denom = fattura.tipo === 'emessa' 
      ? fattura.denominazione_cliente 
      : fattura.denominazione_fornitore
    
    if (!denom) continue
    
    const normalizedKey = normalizeName(denom)
    if (!normalizedKey || !soggettiMap.has(normalizedKey)) continue
    
    soggettiMap.get(normalizedKey)!.transazioni.push({
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
