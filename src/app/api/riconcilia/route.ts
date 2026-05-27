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

// Check if names match (normalized comparison)
function namesMatch(name1: string | null | undefined, name2: string | null | undefined): boolean {
  const n1 = normalizeName(name1)
  const n2 = normalizeName(name2)
  
  if (!n1 || !n2) return false
  if (n1 === n2) return true
  if (n1.includes(n2) || n2.includes(n1)) return true
  
  // Check first significant word
  const words1 = n1.split(' ').filter(w => w.length > 3)
  const words2 = n2.split(' ').filter(w => w.length > 3)
  if (words1.length > 0 && words2.length > 0 && words1[0] === words2[0]) return true
  
  return false
}

// POST: Collega una fattura a una transazione (con nota opzionale)
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { fatturaId, transazioneId, note } = await request.json()

  if (!fatturaId || !transazioneId) {
    return NextResponse.json({ error: 'Missing fatturaId or transazioneId' }, { status: 400 })
  }

  // Inserisci in tabella riconciliazioni (N:1 supportato)
  const { error: errRic } = await supabase
    .from('riconciliazioni')
    .upsert({
      fattura_id: fatturaId,
      transazione_id: transazioneId
    }, { onConflict: 'fattura_id' })

  if (errRic) {
    return NextResponse.json({ error: errRic.message }, { status: 500 })
  }

  // Prepara update fattura
  const updateFattura: Record<string, unknown> = {
    stato_riconciliazione: 'riconciliata',
    transazione_id: transazioneId,
  }
  // Se c'è una nota, append in fatture.note come [Match: <nota>]
  if (note && typeof note === 'string' && note.trim()) {
    const { data: existing } = await supabase
      .from('fatture')
      .select('note')
      .eq('id', fatturaId)
      .single()
    const tag = `[Match: ${note.trim()}]`
    const prev = existing?.note?.trim()
    updateFattura.note = prev ? `${tag}\n${prev}` : tag
  }

  // Aggiorna stato fattura E imposta transazione_id (la vista Soggetti legge da qui)
  await supabase
    .from('fatture')
    .update(updateFattura)
    .eq('id', fatturaId)

  // Aggiorna stato transazione
  await supabase
    .from('transazioni')
    .update({ stato_riconciliazione: 'riconciliata' })
    .eq('id', transazioneId)

  return NextResponse.json({ success: true })
}

// DELETE: Scollega una riconciliazione
export async function DELETE(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const fatturaId = searchParams.get('fatturaId')
  
  if (!fatturaId) {
    return NextResponse.json({ error: 'Missing fatturaId' }, { status: 400 })
  }
  
  // Trova la transazione collegata
  const { data: ric } = await supabase
    .from('riconciliazioni')
    .select('transazione_id')
    .eq('fattura_id', fatturaId)
    .single()
  
  // Rimuovi il collegamento
  await supabase
    .from('riconciliazioni')
    .delete()
    .eq('fattura_id', fatturaId)
  
  // Aggiorna stato fattura e azzera transazione_id
  await supabase
    .from('fatture')
    .update({
      stato_riconciliazione: 'da_riconciliare',
      transazione_id: null,
    })
    .eq('id', fatturaId)
  
  // Se la transazione non ha più fatture collegate, mettila da_riconciliare
  if (ric?.transazione_id) {
    const { count } = await supabase
      .from('riconciliazioni')
      .select('*', { count: 'exact', head: true })
      .eq('transazione_id', ric.transazione_id)
    
    if (count === 0) {
      await supabase
        .from('transazioni')
        .update({ stato_riconciliazione: 'da_riconciliare' })
        .eq('id', ric.transazione_id)
    }
  }
  
  return NextResponse.json({ success: true })
}

// GET: Trova suggerimenti di match per una fattura
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const fatturaId = searchParams.get('fatturaId')
  const toleranceDays = parseInt(searchParams.get('toleranceDays') || '100')
  
  // Se fatturaId specificato, trova suggerimenti per quella fattura
  if (fatturaId) {
    // Prendi la fattura
    const { data: fattura } = await supabase
      .from('fatture')
      .select('*')
      .eq('id', fatturaId)
      .single()
    
    if (!fattura) {
      return NextResponse.json({ error: 'Fattura not found' }, { status: 404 })
    }
    
    const expectedTipo = fattura.tipo === 'emessa' ? 'entrata' : 'uscita'
    const fatturaTotal = fattura.totale || ((fattura.imponibile || 0) + (fattura.imposta || 0))
    const fatturaDenom = fattura.tipo === 'emessa' ? fattura.denominazione_cliente : fattura.denominazione_fornitore
    const fatturaDate = new Date(fattura.data_emissione)
    
    // Prendi transazioni da_riconciliare del tipo giusto
    const { data: transazioni } = await supabase
      .from('transazioni')
      .select('*')
      .eq('tipo', expectedTipo)
      .eq('stato_riconciliazione', 'da_riconciliare')
      .range(0, 9999)
    
    const suggestions = []
    
    for (const trans of transazioni || []) {
      // Verifica soggetto (DEVE corrispondere)
      if (!namesMatch(fatturaDenom, trans.controparte)) continue
      
      // Verifica importo (2% o min 5€)
      const tolerance = Math.max(fatturaTotal * 0.02, 5)
      const amountDiff = Math.abs(fatturaTotal - trans.importo)
      if (amountDiff > tolerance) continue
      
      // Verifica data (max toleranceDays)
      const transDate = new Date(trans.data)
      const daysDiff = Math.abs((transDate.getTime() - fatturaDate.getTime()) / (1000 * 60 * 60 * 24))
      if (daysDiff > toleranceDays) continue
      
      suggestions.push({
        id: trans.id,
        data: trans.data,
        importo: trans.importo,
        controparte: trans.controparte,
        conto: trans.conto,
        daysDiff: Math.round(daysDiff),
        amountDiff: Math.round(amountDiff * 100) / 100
      })
    }
    
    // Ordina per vicinanza di data
    suggestions.sort((a, b) => a.daysDiff - b.daysDiff)
    
    return NextResponse.json({ 
      fattura: {
        id: fattura.id,
        numero: fattura.numero,
        totale: fatturaTotal,
        data: fattura.data_emissione,
        denominazione: fatturaDenom,
        tipo: fattura.tipo
      },
      suggestions 
    })
  }
  
  // Se nessun fatturaId, ritorna lista fatture da riconciliare con conteggio suggerimenti
  const { data: fatture } = await supabase
    .from('fatture')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .order('data_emissione', { ascending: false })
    .range(0, 9999)
  
  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .range(0, 9999)
  
  const result = []
  
  for (const fattura of fatture || []) {
    const expectedTipo = fattura.tipo === 'emessa' ? 'entrata' : 'uscita'
    const fatturaTotal = fattura.totale || ((fattura.imponibile || 0) + (fattura.imposta || 0))
    const fatturaDenom = fattura.tipo === 'emessa' ? fattura.denominazione_cliente : fattura.denominazione_fornitore
    const fatturaDate = new Date(fattura.data_emissione)
    
    let suggestionCount = 0
    
    for (const trans of transazioni || []) {
      if (trans.tipo !== expectedTipo) continue
      if (!namesMatch(fatturaDenom, trans.controparte)) continue
      
      const tolerance = Math.max(fatturaTotal * 0.02, 5)
      const amountDiff = Math.abs(fatturaTotal - trans.importo)
      if (amountDiff > tolerance) continue
      
      const transDate = new Date(trans.data)
      const daysDiff = Math.abs((transDate.getTime() - fatturaDate.getTime()) / (1000 * 60 * 60 * 24))
      if (daysDiff > toleranceDays) continue
      
      suggestionCount++
    }
    
    result.push({
      id: fattura.id,
      numero: fattura.numero,
      totale: fatturaTotal,
      data: fattura.data_emissione,
      denominazione: fatturaDenom,
      tipo: fattura.tipo,
      suggestionCount
    })
  }
  
  // Ordina: prima quelle con suggerimenti, poi per data
  result.sort((a, b) => {
    if (a.suggestionCount > 0 && b.suggestionCount === 0) return -1
    if (a.suggestionCount === 0 && b.suggestionCount > 0) return 1
    return new Date(b.data).getTime() - new Date(a.data).getTime()
  })
  
  return NextResponse.json({ 
    fatture: result,
    total: result.length,
    withSuggestions: result.filter(f => f.suggestionCount > 0).length
  })
}
