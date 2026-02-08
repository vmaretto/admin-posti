import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createServerClient()
  
  // Get totals from transazioni
  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('tipo, importo')
  
  const totale_entrate = transazioni?.filter(t => t.tipo === 'entrata').reduce((s, t) => s + t.importo, 0) || 0
  const totale_uscite = transazioni?.filter(t => t.tipo === 'uscita').reduce((s, t) => s + t.importo, 0) || 0
  
  // Get fatture counts
  const { count: fatture_emesse } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true })
    .eq('tipo', 'emessa')
  
  const { count: fatture_ricevute } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true })
    .eq('tipo', 'ricevuta')
  
  // Da incassare (fatture emesse non riconciliate)
  const { data: daIncassare } = await supabase
    .from('fatture')
    .select('totale')
    .eq('tipo', 'emessa')
    .eq('stato_riconciliazione', 'da_riconciliare')
  
  const da_incassare = daIncassare?.reduce((s, f) => s + (f.totale || 0), 0) || 0
  
  // Da pagare (fatture ricevute non riconciliate)
  const { data: daPagare } = await supabase
    .from('fatture')
    .select('totale')
    .eq('tipo', 'ricevuta')
    .eq('stato_riconciliazione', 'da_riconciliare')
  
  const da_pagare = daPagare?.reduce((s, f) => s + (f.totale || 0), 0) || 0
  
  // Counts
  const { count: transazioni_totali } = await supabase
    .from('transazioni')
    .select('*', { count: 'exact', head: true })
  
  const { count: fatture_riconciliate } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true })
    .eq('stato_riconciliazione', 'riconciliata')
  
  const { count: fatture_da_riconciliare } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true })
    .eq('stato_riconciliazione', 'da_riconciliare')
  
  // Transazioni riconciliate/da riconciliare
  const { count: transazioni_riconciliate } = await supabase
    .from('transazioni')
    .select('*', { count: 'exact', head: true })
    .eq('stato_riconciliazione', 'riconciliata')
  
  const { count: transazioni_da_riconciliare } = await supabase
    .from('transazioni')
    .select('*', { count: 'exact', head: true })
    .eq('stato_riconciliazione', 'da_riconciliare')
  
  // Fatture estere count
  const { count: fatture_estere } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true })
    .eq('fonte', 'estero')
  
  return NextResponse.json({
    totale_entrate,
    totale_uscite,
    da_incassare,
    da_pagare,
    fatture_emesse: fatture_emesse || 0,
    fatture_ricevute: fatture_ricevute || 0,
    fatture_estere: fatture_estere || 0,
    transazioni_totali: transazioni_totali || 0,
    fatture_riconciliate: fatture_riconciliate || 0,
    fatture_da_riconciliare: fatture_da_riconciliare || 0,
    transazioni_riconciliate: transazioni_riconciliate || 0,
    transazioni_da_riconciliare: transazioni_da_riconciliare || 0
  })
}
