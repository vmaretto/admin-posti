import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createServerClient()
  
  // Get all fatture
  const { data: fatture } = await supabase
    .from('fatture')
    .select('id, numero, tipo, totale, data_emissione, stato_riconciliazione, denominazione_fornitore, denominazione_cliente')
  
  // Get all transazioni
  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('id, importo, tipo, data, conto, stato_riconciliazione, controparte')
  
  // Group by subject
  const soggettiMap = new Map<string, {
    fatture: any[]
    transazioni: any[]
  }>()
  
  // Process fatture
  for (const f of fatture || []) {
    const denom = f.tipo === 'emessa' 
      ? f.denominazione_cliente 
      : f.denominazione_fornitore
    
    if (!denom) continue
    
    const key = denom.toLowerCase().trim()
    if (!soggettiMap.has(key)) {
      soggettiMap.set(key, { fatture: [], transazioni: [] })
    }
    
    soggettiMap.get(key)!.fatture.push({
      id: f.id,
      numero: f.numero,
      tipo: f.tipo,
      totale: f.totale,
      data: f.data_emissione,
      stato: f.stato_riconciliazione
    })
  }
  
  // Process transazioni - try to match to existing subjects
  for (const t of transazioni || []) {
    if (!t.controparte) continue
    
    const controparte = t.controparte.toLowerCase().trim()
    
    // Try to find matching subject
    let matchedKey: string = ''
    for (const key of soggettiMap.keys()) {
      // Check if controparte contains subject name or vice versa
      if (controparte.includes(key) || key.includes(controparte)) {
        matchedKey = key
        break
      }
      // Check keywords
      const keyWords = key.split(' ').filter((w: string) => w.length > 3)
      const contWords = controparte.split(' ').filter((w: string) => w.length > 3)
      for (const kw of keyWords) {
        if (contWords.some((cw: string) => cw.includes(kw) || kw.includes(cw))) {
          matchedKey = key
          break
        }
      }
      if (matchedKey) break
    }
    
    if (matchedKey === '') {
      matchedKey = controparte
      if (!soggettiMap.has(matchedKey)) {
        soggettiMap.set(matchedKey, { fatture: [], transazioni: [] })
      }
    }
    
    soggettiMap.get(matchedKey)!.transazioni.push({
      id: t.id,
      importo: t.importo,
      tipo: t.tipo,
      data: t.data,
      conto: t.conto,
      stato: t.stato_riconciliazione
    })
  }
  
  // Convert to array and calculate totals
  const soggetti = Array.from(soggettiMap.entries())
    .map(([key, data]) => {
      // Get display name from first fattura or first transazione
      const displayName = data.fatture[0]?.denominazione || 
        data.transazioni[0]?.controparte ||
        key
      
      const totaleFatture = data.fatture.reduce((sum, f) => sum + f.totale, 0)
      const totaleTransazioni = data.transazioni.reduce((sum, t) => 
        sum + (t.tipo === 'entrata' ? t.importo : -t.importo), 0)
      
      // Find canonical name
      let canonicalName = key
      if (data.fatture.length > 0) {
        const f = data.fatture[0]
        canonicalName = f.tipo === 'emessa' 
          ? (fatture?.find(x => x.id === f.id)?.denominazione_cliente || key)
          : (fatture?.find(x => x.id === f.id)?.denominazione_fornitore || key)
      } else if (data.transazioni.length > 0) {
        canonicalName = transazioni?.find(x => x.id === data.transazioni[0].id)?.controparte || key
      }
      
      return {
        denominazione: canonicalName,
        fatture: data.fatture.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()),
        transazioni: data.transazioni.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()),
        totaleFatture,
        totaleTransazioni: Math.abs(totaleTransazioni),
        saldo: totaleFatture - Math.abs(totaleTransazioni)
      }
    })
    .filter(s => s.fatture.length > 0 || s.transazioni.length > 0)
    .sort((a, b) => (b.totaleFatture + b.totaleTransazioni) - (a.totaleFatture + a.totaleTransazioni))
  
  return NextResponse.json(soggetti)
}
