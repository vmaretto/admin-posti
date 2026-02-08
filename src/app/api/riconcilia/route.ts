import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Normalize name for comparison
function normalizeName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // remove special chars
    .replace(/\s+/g, ' ')        // normalize spaces
    .replace(/\b(srl|spa|snc|sas|srls|sapa|ltd|inc|gmbh|s\.r\.l|s\.p\.a)\b/g, '') // remove company suffixes
    .trim()
}

// Extract keywords from name
function extractKeywords(name: string): string[] {
  const normalized = normalizeName(name)
  return normalized.split(' ').filter(w => w.length > 2)
}

// Calculate similarity score between two names (0-100)
function nameSimilarity(name1: string | null | undefined, name2: string | null | undefined): number {
  const n1 = normalizeName(name1)
  const n2 = normalizeName(name2)
  
  if (!n1 || !n2) return 0
  
  // Exact match
  if (n1 === n2) return 100
  
  // One contains the other
  if (n1.includes(n2) || n2.includes(n1)) return 80
  
  // Keyword matching
  const kw1 = extractKeywords(name1 || '')
  const kw2 = extractKeywords(name2 || '')
  
  if (kw1.length === 0 || kw2.length === 0) return 0
  
  let matches = 0
  for (const k1 of kw1) {
    for (const k2 of kw2) {
      if (k1 === k2) {
        matches++
        break
      }
      // Partial match (one keyword contains another)
      if (k1.length > 3 && k2.length > 3 && (k1.includes(k2) || k2.includes(k1))) {
        matches += 0.5
        break
      }
    }
  }
  
  const maxKeywords = Math.max(kw1.length, kw2.length)
  return Math.round((matches / maxKeywords) * 60) // Max 60 for keyword match
}

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { fatturaId, transazioneId } = await request.json()
  
  if (!fatturaId || !transazioneId) {
    return NextResponse.json({ error: 'Missing fatturaId or transazioneId' }, { status: 400 })
  }
  
  // Update fattura
  const { error: errFattura } = await supabase
    .from('fatture')
    .update({ 
      transazione_id: transazioneId,
      stato_riconciliazione: 'riconciliata'
    })
    .eq('id', fatturaId)
  
  if (errFattura) {
    return NextResponse.json({ error: errFattura.message }, { status: 500 })
  }
  
  // Update transazione
  const { error: errTrans } = await supabase
    .from('transazioni')
    .update({ 
      fattura_id: fatturaId,
      stato_riconciliazione: 'riconciliata'
    })
    .eq('id', transazioneId)
  
  if (errTrans) {
    return NextResponse.json({ error: errTrans.message }, { status: 500 })
  }
  
  return NextResponse.json({ success: true })
}

// Auto-match endpoint
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dryRun') === 'true'
  const autoApplyPerfect = searchParams.get('autoApplyPerfect') !== 'false' // Auto-apply 100% matches by default
  const toleranceDays = parseInt(searchParams.get('toleranceDays') || '30')
  const minNameScore = parseInt(searchParams.get('minNameScore') || '0') // No minimum by default - show all candidates
  
  // Get unmatched fatture
  const { data: fatture, error: errF } = await supabase
    .from('fatture')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
  
  if (errF) {
    return NextResponse.json({ error: errF.message }, { status: 500 })
  }
  
  // Get unmatched transazioni
  const { data: transazioni, error: errT } = await supabase
    .from('transazioni')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
  
  if (errT) {
    return NextResponse.json({ error: errT.message }, { status: 500 })
  }
  
  interface MatchCandidate {
    fattura: typeof fatture[0]
    trans: typeof transazioni[0]
    fatturaTotal: number
    daysDiff: number
    nameScore: number
    totalScore: number
  }
  
  const candidates: MatchCandidate[] = []
  
  // Find all potential matches with scores
  for (const fattura of fatture || []) {
    const expectedTipo = fattura.tipo === 'emessa' ? 'entrata' : 'uscita'
    const fatturaTotal = fattura.totale || ((fattura.imponibile || 0) + (fattura.imposta || 0))
    const fatturaDenom = fattura.tipo === 'emessa' ? fattura.denominazione_cliente : fattura.denominazione_fornitore
    
    for (const trans of transazioni || []) {
      if (trans.tipo !== expectedTipo) continue
      
      // Amount check (within 2% or €5)
      const tolerance = Math.max(fatturaTotal * 0.02, 5)
      const amountDiff = Math.abs(fatturaTotal - trans.importo)
      if (amountDiff > tolerance) continue
      
      // Date check
      const fatturaDate = new Date(fattura.data_emissione)
      const transDate = new Date(trans.data)
      const daysDiff = Math.abs((transDate.getTime() - fatturaDate.getTime()) / (1000 * 60 * 60 * 24))
      if (daysDiff > toleranceDays) continue
      
      // Name similarity
      const nameScore = nameSimilarity(fatturaDenom, trans.controparte)
      
      // Skip if name similarity is too low (unless amount is exact match)
      if (nameScore < minNameScore && amountDiff > 0.01) continue
      
      // Calculate total score (higher is better)
      // - Name similarity: 0-100 (weight: 40%)
      // - Date proximity: 0-100 based on days (weight: 35%) - important signal
      // - Amount exactness: 0-100 based on diff (weight: 25%)
      
      // Date score: close dates are good, far dates are bad
      // 0-7 days: 100-85, 7-14 days: 85-70, 14-30 days: 70-40, 30+ days: 40-0
      let dateScore: number
      if (daysDiff <= 7) {
        dateScore = 100 - (daysDiff * 2)  // 100 to 86
      } else if (daysDiff <= 14) {
        dateScore = 86 - ((daysDiff - 7) * 2)  // 86 to 72
      } else if (daysDiff <= 30) {
        dateScore = 72 - ((daysDiff - 14) * 2)  // 72 to 40
      } else {
        dateScore = Math.max(0, 40 - ((daysDiff - 30) * 1.5))  // 40 to 0
      }
      
      const amountScore = Math.max(0, 100 - (amountDiff / fatturaTotal * 100))
      
      // Base score
      let totalScore = (nameScore * 0.40) + (dateScore * 0.35) + (amountScore * 0.25)
      
      // Heavy penalty if name match is below 10%
      if (nameScore < 10) {
        totalScore = totalScore * 0.3  // 70% penalty
      } else if (nameScore < 20) {
        totalScore = totalScore * 0.6  // 40% penalty
      }
      
      candidates.push({
        fattura,
        trans,
        fatturaTotal,
        daysDiff: Math.round(daysDiff),
        nameScore,
        totalScore
      })
    }
  }
  
  // Sort by total score (best first)
  candidates.sort((a, b) => b.totalScore - a.totalScore)
  
  // Select best non-conflicting matches
  const matches = []
  const usedFatture = new Set<string>()
  const usedTrans = new Set<string>()
  
  for (const c of candidates) {
    if (usedFatture.has(c.fattura.id) || usedTrans.has(c.trans.id)) continue
    
    usedFatture.add(c.fattura.id)
    usedTrans.add(c.trans.id)
    
    const fatturaDenom = c.fattura.tipo === 'emessa' ? c.fattura.denominazione_cliente : c.fattura.denominazione_fornitore
    
    matches.push({
      fattura: {
        id: c.fattura.id,
        numero: c.fattura.numero,
        totale: c.fatturaTotal,
        data: c.fattura.data_emissione,
        denominazione: fatturaDenom
      },
      transazione: {
        id: c.trans.id,
        importo: c.trans.importo,
        data: c.trans.data,
        controparte: c.trans.controparte,
        conto: c.trans.conto
      },
      daysDiff: c.daysDiff,
      nameScore: c.nameScore,
      totalScore: Math.round(c.totalScore)
    })
  }
  
  // Separate perfect matches (100% name score) from others
  const perfectMatches = matches.filter(m => m.nameScore === 100)
  const manualMatches = matches.filter(m => m.nameScore < 100)
  
  let autoApplied = 0
  
  // Auto-apply perfect matches if enabled and in dryRun mode
  if (autoApplyPerfect && dryRun && perfectMatches.length > 0) {
    for (const match of perfectMatches) {
      await supabase
        .from('fatture')
        .update({ 
          transazione_id: match.transazione.id,
          stato_riconciliazione: 'riconciliata'
        })
        .eq('id', match.fattura.id)
      
      await supabase
        .from('transazioni')
        .update({ 
          fattura_id: match.fattura.id,
          stato_riconciliazione: 'riconciliata'
        })
        .eq('id', match.transazione.id)
      
      autoApplied++
    }
  }
  
  // Apply all matches if not dryRun
  if (!dryRun && matches.length > 0) {
    for (const match of matches) {
      await supabase
        .from('fatture')
        .update({ 
          transazione_id: match.transazione.id,
          stato_riconciliazione: 'riconciliata'
        })
        .eq('id', match.fattura.id)
      
      await supabase
        .from('transazioni')
        .update({ 
          fattura_id: match.fattura.id,
          stato_riconciliazione: 'riconciliata'
        })
        .eq('id', match.transazione.id)
    }
  }
  
  return NextResponse.json({ 
    matches: dryRun ? manualMatches : matches, // In dryRun, return only non-perfect for manual review
    perfectMatches: dryRun ? perfectMatches : [],
    count: matches.length,
    autoApplied,
    dryRun
  })
}
