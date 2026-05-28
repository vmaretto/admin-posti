import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Lista di fallback se la tabella conti_config non esiste ancora
// (es. utente non ha ancora lanciato la migration).
const FALLBACK_CONTI = [
  { key: 'qonto',       label: 'Qonto',       has_parser: false, ordine: 10 },
  { key: 'sella_conto', label: 'Sella conto', has_parser: false, ordine: 20 },
  { key: 'sella_carta', label: 'Sella carta', has_parser: false, ordine: 30 },
  { key: 'paypal',      label: 'PayPal',      has_parser: true,  ordine: 40 },
  { key: 'revolut',     label: 'Revolut',     has_parser: false, ordine: 50 },
]

function normalizeKey(s: string): string {
  return s.toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

// GET: lista conti configurati (ordinati per `ordine` ASC, poi label)
export async function GET() {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('conti_config')
    .select('*')
    .order('ordine', { ascending: true })
    .order('label', { ascending: true })
  if (error) {
    // Tabella non esistente o errore: torno fallback
    return NextResponse.json({ conti: FALLBACK_CONTI, fallback: true })
  }
  return NextResponse.json({ conti: data || [], fallback: false })
}

// POST: aggiunge (o aggiorna) un conto. Body: { key?, label, has_parser?, ordine? }
// Se key non passata, la deriva da label normalizzandola.
export async function POST(request: NextRequest) {
  const supabase = createServerClient()
  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }
  if (!body?.label || typeof body.label !== 'string') {
    return NextResponse.json({ error: 'label richiesta' }, { status: 400 })
  }
  const label = body.label.trim()
  const key = body.key ? normalizeKey(String(body.key)) : normalizeKey(label)
  if (!key) {
    return NextResponse.json({ error: 'key non valida' }, { status: 400 })
  }
  const has_parser = typeof body.has_parser === 'boolean' ? body.has_parser : false
  const ordine = typeof body.ordine === 'number' ? body.ordine : 100

  const { data, error } = await supabase
    .from('conti_config')
    .upsert({ key, label, has_parser, ordine }, { onConflict: 'key' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, conto: data })
}

// DELETE ?key=…
export async function DELETE(request: NextRequest) {
  const supabase = createServerClient()
  const key = new URL(request.url).searchParams.get('key')
  if (!key) return NextResponse.json({ error: 'key richiesta' }, { status: 400 })
  const { error } = await supabase.from('conti_config').delete().eq('key', key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
