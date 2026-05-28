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
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  // ========== FATTURE ==========
  // Tutte le fatture (filtrate per periodo se richiesto)
  let qF = supabase
    .from('fatture')
    .select('id, tipo, totale, imponibile, imposta, data_emissione, stato_riconciliazione, denominazione_cliente, denominazione_fornitore')
  if (from) qF = qF.gte('data_emissione', from)
  if (to) qF = qF.lte('data_emissione', to)
  const { data: allFatture } = await qF.range(0, 9999)
  
  const fattureTotali = allFatture?.length || 0
  const fattureRiconciliate = allFatture?.filter(f => f.stato_riconciliazione === 'riconciliata').length || 0
  const fattureDaRiconciliare = allFatture?.filter(f => f.stato_riconciliazione === 'da_riconciliare') || []
  
  // Importi fatture
  const importoTotaleFatture = allFatture?.reduce((sum, f) => {
    const tot = f.totale || ((f.imponibile || 0) + (f.imposta || 0))
    return sum + tot
  }, 0) || 0
  
  const importoRiconciliatoFatture = allFatture
    ?.filter(f => f.stato_riconciliazione === 'riconciliata')
    .reduce((sum, f) => {
      const tot = f.totale || ((f.imponibile || 0) + (f.imposta || 0))
      return sum + tot
    }, 0) || 0
  
  // ========== TRANSAZIONI ==========
  let qT = supabase
    .from('transazioni')
    .select('id, tipo, importo, data, controparte, stato_riconciliazione')
  if (from) qT = qT.gte('data', from)
  if (to) qT = qT.lte('data', to)
  const { data: allTransazioni } = await qT.range(0, 9999)
  
  const transazioniTotali = allTransazioni?.length || 0
  const transazioniRiconciliate = allTransazioni?.filter(t => t.stato_riconciliazione === 'riconciliata').length || 0
  const transazioniDaRiconciliare = allTransazioni?.filter(t => t.stato_riconciliazione === 'da_riconciliare') || []
  
  // Importi transazioni (solo entrate)
  const importoIncassi = allTransazioni
    ?.filter(t => t.tipo === 'entrata')
    .reduce((sum, t) => sum + (t.importo || 0), 0) || 0
  
  const importoRiconciliatoTransazioni = allTransazioni
    ?.filter(t => t.stato_riconciliazione === 'riconciliata')
    .reduce((sum, t) => sum + (t.importo || 0), 0) || 0
  
  // ========== CALCOLO "DA CONFERMARE" (fatture con almeno 1 candidato) ==========
  // Criteri: soggetto match, importo ±5%, data ±120gg
  const TOLERANCE_PERCENT = 0.05
  const TOLERANCE_DAYS = 120
  
  let fattureDaConfermare = 0
  let fattureManual = 0
  
  for (const fattura of fattureDaRiconciliare) {
    const fatturaTotal = fattura.totale || ((fattura.imponibile || 0) + (fattura.imposta || 0))
    const fatturaDate = new Date(fattura.data_emissione)
    const expectedTipo = fattura.tipo === 'emessa' ? 'entrata' : 'uscita'
    const fatturaDenom = fattura.tipo === 'emessa' ? fattura.denominazione_cliente : fattura.denominazione_fornitore
    
    let hasCandidate = false
    
    for (const trans of transazioniDaRiconciliare) {
      // Tipo corretto
      if (trans.tipo !== expectedTipo) continue
      
      // Soggetto match
      if (!namesMatch(fatturaDenom, trans.controparte)) continue
      
      // Importo ±5%
      const tolerance = fatturaTotal * TOLERANCE_PERCENT
      const amountDiff = Math.abs(fatturaTotal - trans.importo)
      if (amountDiff > tolerance) continue
      
      // Data ±120gg
      const transDate = new Date(trans.data)
      const daysDiff = Math.abs((transDate.getTime() - fatturaDate.getTime()) / (1000 * 60 * 60 * 24))
      if (daysDiff > TOLERANCE_DAYS) continue
      
      // Match trovato!
      hasCandidate = true
      break
    }
    
    if (hasCandidate) {
      fattureDaConfermare++
    } else {
      fattureManual++
    }
  }
  
  // ========== LEGACY STATS (per backward compatibility) ==========
  const totale_entrate = allTransazioni?.filter(t => t.tipo === 'entrata').reduce((s, t) => s + t.importo, 0) || 0
  const totale_uscite = allTransazioni?.filter(t => t.tipo === 'uscita').reduce((s, t) => s + t.importo, 0) || 0
  
  const { count: fatture_emesse } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true })
    .eq('tipo', 'emessa')
  
  const { count: fatture_ricevute } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true })
    .eq('tipo', 'ricevuta')
  
  const { data: daIncassare } = await supabase
    .from('fatture')
    .select('totale')
    .eq('tipo', 'emessa')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .range(0, 9999)
  
  const da_incassare = daIncassare?.reduce((s, f) => s + (f.totale || 0), 0) || 0
  
  const { data: daPagare } = await supabase
    .from('fatture')
    .select('totale')
    .eq('tipo', 'ricevuta')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .range(0, 9999)
  
  const da_pagare = daPagare?.reduce((s, f) => s + (f.totale || 0), 0) || 0
  
  const { count: fatture_estere } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true })
    .eq('fonte', 'estero')
  
  // Stati breakdown
  const fattureStati: Record<string, number> = {}
  allFatture?.forEach(f => {
    const stato = f.stato_riconciliazione || 'senza_stato'
    fattureStati[stato] = (fattureStati[stato] || 0) + 1
  })
  
  const transazioniStati: Record<string, number> = {}
  allTransazioni?.forEach(t => {
    const stato = t.stato_riconciliazione || 'senza_stato'
    transazioniStati[stato] = (transazioniStati[stato] || 0) + 1
  })
  
  return NextResponse.json({
    // Nuove statistiche strutturate
    fatture: {
      totali: fattureTotali,
      riconciliate: fattureRiconciliate,
      da_confermare: fattureDaConfermare,
      manuali: fattureManual,
      importo_totale: importoTotaleFatture,
      importo_riconciliato: importoRiconciliatoFatture
    },
    transazioni: {
      totali: transazioniTotali,
      riconciliate: transazioniRiconciliate,
      non_riconciliate: transazioniTotali - transazioniRiconciliate,
      importo_incassi: importoIncassi,
      importo_riconciliato: importoRiconciliatoTransazioni
    },
    // Legacy (backward compatibility)
    totale_entrate,
    totale_uscite,
    da_incassare,
    da_pagare,
    fatture_emesse: fatture_emesse || 0,
    fatture_ricevute: fatture_ricevute || 0,
    fatture_estere: fatture_estere || 0,
    transazioni_totali: transazioniTotali,
    fatture_stati: fattureStati,
    transazioni_stati: transazioniStati
  })
}
