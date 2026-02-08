import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Normalize name for comparison
function normalizeName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(srl|spa|snc|sas|srls|sapa|ltd|inc|gmbh|sarl|emea|s r l|s p a)\b/g, '')
    .trim()
}

// Check if names match
function namesMatch(name1: string | null | undefined, name2: string | null | undefined): boolean {
  const n1 = normalizeName(name1)
  const n2 = normalizeName(name2)
  
  if (!n1 || !n2) return false
  if (n1 === n2) return true
  if (n1.includes(n2) || n2.includes(n1)) return true
  
  const words1 = n1.split(' ').filter(w => w.length > 3)
  const words2 = n2.split(' ').filter(w => w.length > 3)
  if (words1.length > 0 && words2.length > 0 && words1[0] === words2[0]) return true
  
  return false
}

export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const toleranceDays = parseInt(searchParams.get('toleranceDays') || '100')
  
  // Prendi fatture da riconciliare
  const { data: fatture } = await supabase
    .from('fatture')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .order('data_emissione', { ascending: false })
    .range(0, 9999)
  
  // Prendi transazioni da riconciliare
  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .range(0, 9999)
  
  // Raggruppa per soggetto (normalizzato)
  const soggettiMap = new Map<string, {
    denominazione: string
    fatture: any[]
    transazioni: any[]
  }>()
  
  // Aggiungi fatture
  for (const f of fatture || []) {
    const denom = f.tipo === 'emessa' ? f.denominazione_cliente : f.denominazione_fornitore
    if (!denom) continue
    
    const key = normalizeName(denom)
    if (!key) continue
    
    if (!soggettiMap.has(key)) {
      soggettiMap.set(key, { denominazione: denom, fatture: [], transazioni: [] })
    }
    soggettiMap.get(key)!.fatture.push(f)
  }
  
  // Aggiungi transazioni
  for (const t of transazioni || []) {
    if (!t.controparte) continue
    
    const key = normalizeName(t.controparte)
    if (!key) continue
    
    // Cerca match in soggetti esistenti
    let matchedKey = ''
    for (const [soggettoKey, data] of soggettiMap.entries()) {
      if (namesMatch(t.controparte, data.denominazione)) {
        matchedKey = soggettoKey
        break
      }
    }
    
    if (matchedKey) {
      soggettiMap.get(matchedKey)!.transazioni.push(t)
    }
  }
  
  // Costruisci risultato
  const result = []
  
  for (const [key, data] of soggettiMap.entries()) {
    const matches = []
    const fattureSenzaMatch = []
    const usedTransazioni = new Set<string>()
    
    for (const f of data.fatture) {
      const fatturaTotal = f.totale || ((f.imponibile || 0) + (f.imposta || 0))
      const fatturaDate = new Date(f.data_emissione)
      const expectedTipo = f.tipo === 'emessa' ? 'entrata' : 'uscita'
      
      // Trova transazioni compatibili
      const suggestions = []
      
      for (const t of data.transazioni) {
        if (t.tipo !== expectedTipo) continue
        
        // Importo (±2% o €5)
        const tolerance = Math.max(fatturaTotal * 0.02, 5)
        const amountDiff = Math.abs(fatturaTotal - t.importo)
        if (amountDiff > tolerance) continue
        
        // Data (±toleranceDays)
        const transDate = new Date(t.data)
        const daysDiff = Math.abs((transDate.getTime() - fatturaDate.getTime()) / (1000 * 60 * 60 * 24))
        if (daysDiff > toleranceDays) continue
        
        // Calcola score
        const dateScore = Math.max(0, 100 - (daysDiff * 1)) // -1 punto per giorno
        const amountScore = Math.max(0, 100 - (amountDiff / fatturaTotal * 100))
        const score = Math.round((dateScore * 0.6) + (amountScore * 0.4))
        
        suggestions.push({
          id: t.id,
          data: t.data,
          importo: t.importo,
          controparte: t.controparte,
          conto: t.conto,
          daysDiff: Math.round(daysDiff),
          amountDiff: Math.round(amountDiff * 100) / 100,
          score
        })
      }
      
      // Ordina per score
      suggestions.sort((a, b) => b.score - a.score)
      
      if (suggestions.length > 0) {
        matches.push({
          fattura: {
            id: f.id,
            numero: f.numero,
            totale: fatturaTotal,
            data: f.data_emissione
          },
          suggestions
        })
        // Marca le transazioni come "usate" per questo soggetto
        for (const s of suggestions) {
          usedTransazioni.add(s.id)
        }
      } else {
        fattureSenzaMatch.push({
          id: f.id,
          numero: f.numero,
          totale: fatturaTotal,
          data: f.data_emissione
        })
      }
    }
    
    // Transazioni orfane (non match con nessuna fattura)
    const transazioniOrfane = data.transazioni
      .filter(t => !usedTransazioni.has(t.id))
      .map(t => ({
        id: t.id,
        data: t.data,
        importo: t.importo,
        conto: t.conto
      }))
    
    // Aggiungi solo soggetti con qualcosa da riconciliare
    if (matches.length > 0 || fattureSenzaMatch.length > 0) {
      result.push({
        denominazione: data.denominazione,
        matches,
        fattureSenzaMatch,
        transazioniOrfane
      })
    }
  }
  
  // Ordina: prima quelli con match, poi per numero match
  result.sort((a, b) => {
    if (a.matches.length > 0 && b.matches.length === 0) return -1
    if (a.matches.length === 0 && b.matches.length > 0) return 1
    return b.matches.length - a.matches.length
  })
  
  return NextResponse.json({ soggetti: result })
}
