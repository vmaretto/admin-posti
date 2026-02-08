import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  const { fatturaId, transazioneId } = await request.json()
  
  // Mark fattura as non_trovata (only if still da_riconciliare)
  if (fatturaId) {
    await supabase
      .from('fatture')
      .update({ stato_riconciliazione: 'non_trovata' })
      .eq('id', fatturaId)
      .eq('stato_riconciliazione', 'da_riconciliare')
  }
  
  // Mark transazione as non_trovata (only if still da_riconciliare)
  if (transazioneId) {
    await supabase
      .from('transazioni')
      .update({ stato_riconciliazione: 'non_trovata' })
      .eq('id', transazioneId)
      .eq('stato_riconciliazione', 'da_riconciliare')
  }
  
  return NextResponse.json({ success: true })
}
