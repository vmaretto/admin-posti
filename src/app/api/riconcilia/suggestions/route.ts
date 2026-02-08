import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { normalizeSubject } from '@/lib/normalize'

export const dynamic = 'force-dynamic'

interface Fattura {
  id: string
  numero: string
  soggetto: string
  importo: number
  data: string
  tipo: string
}

interface Transazione {
  id: string
  controparte: string
  importo: number
  data: string
  tipo: string
  conto: string
}

interface Candidato {
  transazione_id: string
  controparte: string
  importo: number
  data: string
  conto: string
  diff_importo: number
  diff_giorni: number
  score: number
}

interface FatturaConCandidati {
  fattura: Fattura
  candidati: Candidato[]
  selected?: boolean
}

interface SoggettoSuggestion {
  soggetto: string
  soggetto_normalized: string
  tipo: 'emessa' | 'ricevuta'
  fatture: FatturaConCandidati[]
  transazioni: Transazione[]
  totale_fatture: number
  totale_transazioni: number
}

interface FatturaManuale {
  fattura: Fattura
  transazioni_simili: Candidato[]  // Transazioni con importo simile (anche altri soggetti)
}

interface SoggettoManuale {
  soggetto: string
  soggetto_normalized: string
  tipo: 'emessa' | 'ricevuta'
  fatture: FatturaManuale[]
  totale_fatture: number
}

/**
 * GET /api/riconcilia/suggestions
 * Genera suggerimenti aggregati per soggetto
 * 
 * Restituisce:
 * - suggestions: Soggetti con fatture che hanno transazioni candidate (stesso soggetto)
 * - manuali: Soggetti con fatture senza candidati (propone transazioni simili per importo)
 */
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  
  // Prendi fatture da riconciliare
  const { data: fatture, error: errFatture } = await supabase
    .from('fatture')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .order('data_emissione', { ascending: false })
    .range(0, 9999)
  
  if (errFatture) {
    return NextResponse.json({ error: errFatture.message }, { status: 500 })
  }
  
  // Prendi transazioni da riconciliare
  const { data: transazioni, error: errTrans } = await supabase
    .from('transazioni')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .range(0, 9999)
  
  if (errTrans) {
    return NextResponse.json({ error: errTrans.message }, { status: 500 })
  }
  
  // Pre-calcola normalizzazioni transazioni
  const transazioniNormalized = (transazioni || []).map(t => ({
    ...t,
    controparte_normalized: normalizeSubject(t.controparte || '')
  }))
  
  // Mappa soggetti -> fatture con candidati
  const soggettiMap = new Map<string, SoggettoSuggestion>()
  // Fatture senza candidati
  const fattureSenzaCandidati: { fattura: Fattura; tipo: 'emessa' | 'ricevuta'; soggetto_normalized: string }[] = []
  
  for (const fattura of fatture || []) {
    const fatturaTotal = fattura.totale || ((fattura.imponibile || 0) + (fattura.imposta || 0))
    const fatturaSoggetto = fattura.tipo === 'emessa' 
      ? fattura.denominazione_cliente 
      : fattura.denominazione_fornitore
    const fatturaDate = new Date(fattura.data_emissione)
    const expectedTipo = fattura.tipo === 'emessa' ? 'entrata' : 'uscita'
    
    const soggettoNormalized = normalizeSubject(fatturaSoggetto || '')
    if (!soggettoNormalized) continue
    
    const candidati: Candidato[] = []
    
    for (const trans of transazioniNormalized) {
      // Tipo deve corrispondere (emessa -> entrata, ricevuta -> uscita)
      if (trans.tipo !== expectedTipo) continue
      
      // Soggetto normalizzato IDENTICO
      if (trans.controparte_normalized !== soggettoNormalized) continue
      
      // Calcola differenza importo
      const diffImporto = Math.abs(fatturaTotal - trans.importo)
      
      // Criterio importo: diff > 2€ ma ≤ 5% O ≤ 50€
      // (se diff ≤ 2€ sarebbe auto-match, non suggestion)
      if (diffImporto <= 2) continue // Questo è un auto-match, non un suggestion
      
      const maxDiff5Percent = fatturaTotal * 0.05
      if (diffImporto > maxDiff5Percent && diffImporto > 50) continue // Troppo diverso
      
      // Calcola differenza giorni
      const transDate = new Date(trans.data)
      const diffMs = transDate.getTime() - fatturaDate.getTime()
      const diffGiorni = Math.round(diffMs / (1000 * 60 * 60 * 24))
      
      // Data transazione tra -30 e +120 giorni dalla fattura
      if (diffGiorni < -30 || diffGiorni > 120) continue
      
      // Calcola score (importo più vicino = score più alto)
      const maxDiff = Math.max(maxDiff5Percent, 50)
      const score = Math.round(Math.max(0, 100 - (diffImporto / maxDiff * 100)))
      
      candidati.push({
        transazione_id: trans.id,
        controparte: trans.controparte,
        importo: trans.importo,
        data: trans.data,
        conto: trans.conto || '',
        diff_importo: Math.round(diffImporto * 100) / 100,
        diff_giorni: diffGiorni,
        score
      })
    }
    
    // Ordina candidati per score
    candidati.sort((a, b) => b.score - a.score)
    
    const fatturaData: Fattura = {
      id: fattura.id,
      numero: fattura.numero,
      soggetto: fatturaSoggetto || '',
      importo: fatturaTotal,
      data: fattura.data_emissione,
      tipo: fattura.tipo
    }
    
    if (candidati.length > 0) {
      // Ha candidati -> aggiungi a suggestions
      const key = `${soggettoNormalized}_${fattura.tipo}`
      
      if (!soggettiMap.has(key)) {
        // Trova transazioni di questo soggetto
        const transazioniSoggetto = transazioniNormalized
          .filter(t => t.controparte_normalized === soggettoNormalized && t.tipo === expectedTipo)
          .map(t => ({
            id: t.id,
            controparte: t.controparte,
            importo: t.importo,
            data: t.data,
            tipo: t.tipo,
            conto: t.conto || ''
          }))
        
        soggettiMap.set(key, {
          soggetto: fatturaSoggetto || '',
          soggetto_normalized: soggettoNormalized,
          tipo: fattura.tipo as 'emessa' | 'ricevuta',
          fatture: [],
          transazioni: transazioniSoggetto,
          totale_fatture: 0,
          totale_transazioni: transazioniSoggetto.reduce((sum, t) => sum + t.importo, 0)
        })
      }
      
      const soggetto = soggettiMap.get(key)!
      soggetto.fatture.push({ fattura: fatturaData, candidati })
      soggetto.totale_fatture += fatturaTotal
    } else {
      // Nessun candidato -> manuale
      fattureSenzaCandidati.push({
        fattura: fatturaData,
        tipo: fattura.tipo as 'emessa' | 'ricevuta',
        soggetto_normalized: soggettoNormalized
      })
    }
  }
  
  // Costruisci array suggestions ordinato
  const suggestions = Array.from(soggettiMap.values())
    .sort((a, b) => b.totale_fatture - a.totale_fatture)
  
  // Costruisci manuali aggregati per soggetto
  const manualiMap = new Map<string, SoggettoManuale>()
  
  for (const item of fattureSenzaCandidati) {
    const key = `${item.soggetto_normalized}_${item.tipo}`
    const expectedTipo = item.tipo === 'emessa' ? 'entrata' : 'uscita'
    
    if (!manualiMap.has(key)) {
      manualiMap.set(key, {
        soggetto: item.fattura.soggetto,
        soggetto_normalized: item.soggetto_normalized,
        tipo: item.tipo,
        fatture: [],
        totale_fatture: 0
      })
    }
    
    // Trova transazioni con importo simile (anche di altri soggetti)
    const transazioniSimili: Candidato[] = []
    
    for (const trans of transazioniNormalized) {
      if (trans.tipo !== expectedTipo) continue
      
      // Importo simile (±10% o ±100€)
      const diffImporto = Math.abs(item.fattura.importo - trans.importo)
      const maxDiff = Math.max(item.fattura.importo * 0.1, 100)
      if (diffImporto > maxDiff) continue
      
      // Data ragionevole (-60 a +180 giorni)
      const fatturaDate = new Date(item.fattura.data)
      const transDate = new Date(trans.data)
      const diffMs = transDate.getTime() - fatturaDate.getTime()
      const diffGiorni = Math.round(diffMs / (1000 * 60 * 60 * 24))
      if (diffGiorni < -60 || diffGiorni > 180) continue
      
      // Score basato su importo
      const score = Math.round(Math.max(0, 100 - (diffImporto / maxDiff * 100)))
      
      transazioniSimili.push({
        transazione_id: trans.id,
        controparte: trans.controparte,
        importo: trans.importo,
        data: trans.data,
        conto: trans.conto || '',
        diff_importo: Math.round(diffImporto * 100) / 100,
        diff_giorni: diffGiorni,
        score
      })
    }
    
    // Ordina per score e prendi top 5
    transazioniSimili.sort((a, b) => b.score - a.score)
    
    const manuale = manualiMap.get(key)!
    manuale.fatture.push({
      fattura: item.fattura,
      transazioni_simili: transazioniSimili.slice(0, 5)
    })
    manuale.totale_fatture += item.fattura.importo
  }
  
  const manuali = Array.from(manualiMap.values())
    .sort((a, b) => b.totale_fatture - a.totale_fatture)
  
  return NextResponse.json({ 
    suggestions,
    manuali,
    count_suggestions: suggestions.length,
    count_manuali: manuali.length,
    count_fatture_suggestions: suggestions.reduce((sum, s) => sum + s.fatture.length, 0),
    count_fatture_manuali: manuali.reduce((sum, s) => sum + s.fatture.length, 0)
  })
}
