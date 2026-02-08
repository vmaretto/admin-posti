import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { normalizeSubject } from '@/lib/normalize'

export const dynamic = 'force-dynamic'

interface SoggettoGroup {
  nome: string
  nome_normalizzato: string
  fatture: any[]
  totale: number
  count: number
  riconciliate: number
}

export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  
  const tipo = searchParams.get('tipo')
  const stato = searchParams.get('stato')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const grouped = searchParams.get('grouped') === 'true'
  
  // Query fatture
  let query = supabase
    .from('fatture')
    .select('*')
    .order('data_emissione', { ascending: false })
    .range(0, 9999)
  
  if (tipo) query = query.eq('tipo', tipo)
  if (stato) query = query.eq('stato_riconciliazione', stato)
  if (from) query = query.gte('data_emissione', from)
  if (to) query = query.lte('data_emissione', to)
  
  const { data: fatture, error } = await query
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  // Get all transazioni for lookup
  const transazioneIds = [...new Set((fatture || []).map(f => f.transazione_id).filter(Boolean))]
  
  let transazioniMap = new Map<string, any>()
  if (transazioneIds.length > 0) {
    const { data: transazioni } = await supabase
      .from('transazioni')
      .select('id, data, importo, conto, controparte')
      .in('id', transazioneIds)
    
    for (const t of transazioni || []) {
      transazioniMap.set(t.id, t)
    }
  }
  
  // Merge transazione into fatture (as array for consistency with UI)
  const fattureWithTransazioni = (fatture || []).map(f => ({
    ...f,
    transazione: f.transazione_id ? [transazioniMap.get(f.transazione_id)].filter(Boolean) : []
  }))
  
  // Se grouped=true, raggruppa per soggetto
  if (grouped) {
    const soggettiMap = new Map<string, SoggettoGroup>()
    
    for (const fattura of fattureWithTransazioni) {
      const nome = fattura.tipo === 'emessa' 
        ? fattura.denominazione_cliente 
        : fattura.denominazione_fornitore
      
      if (!nome) continue
      
      const nomeNorm = normalizeSubject(nome)
      
      if (!soggettiMap.has(nomeNorm)) {
        soggettiMap.set(nomeNorm, {
          nome: nome, // usa il primo nome trovato
          nome_normalizzato: nomeNorm,
          fatture: [],
          totale: 0,
          count: 0,
          riconciliate: 0
        })
      }
      
      const group = soggettiMap.get(nomeNorm)!
      group.fatture.push(fattura)
      group.totale += fattura.totale
      group.count += 1
      if (fattura.stato_riconciliazione === 'riconciliata') {
        group.riconciliate += 1
      }
    }
    
    // Ordina fatture dentro ogni gruppo per data desc
    for (const group of soggettiMap.values()) {
      group.fatture.sort((a, b) => 
        new Date(b.data_emissione).getTime() - new Date(a.data_emissione).getTime()
      )
    }
    
    const soggetti = Array.from(soggettiMap.values())
      .sort((a, b) => b.totale - a.totale) // default: ordina per importo desc
    
    return NextResponse.json({ soggetti })
  }
  
  return NextResponse.json(fattureWithTransazioni)
}

export async function PATCH(request: NextRequest) {
  const supabase = createServerClient()
  const body = await request.json()
  
  const { id, stato_riconciliazione, note, transazione_id } = body
  
  if (!id) {
    return NextResponse.json({ error: 'ID required' }, { status: 400 })
  }
  
  const updateData: Record<string, any> = {}
  if (stato_riconciliazione !== undefined) updateData.stato_riconciliazione = stato_riconciliazione
  if (note !== undefined) updateData.note = note
  if (transazione_id !== undefined) updateData.transazione_id = transazione_id
  updateData.updated_at = new Date().toISOString()
  
  // Se stato diventa "da_riconciliare", scollega la transazione
  if (stato_riconciliazione === 'da_riconciliare') {
    updateData.transazione_id = null
  }
  
  const { error } = await supabase
    .from('fatture')
    .update(updateData)
    .eq('id', id)
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  
  if (!id) {
    // Delete all
    const { error } = await supabase.from('fatture').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }
  
  const { error } = await supabase.from('fatture').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  
  return NextResponse.json({ success: true })
}
