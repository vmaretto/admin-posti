import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function normalizeName(name: string | null): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(srl|spa|snc|sas|srls|sapa|ltd|inc|gmbh|sarl|s r l|s p a)\b/g, '')
    .trim();
}

export async function GET() {
  const supabase = createServerClient()

  // Get all fatture (include transazione_id for N:1 mapping)
  const { data: fatture } = await supabase
    .from('fatture')
    .select('id, numero, tipo, totale, data_emissione, stato_riconciliazione, denominazione_fornitore, denominazione_cliente, transazione_id')
    .range(0, 9999)

  // Get all transazioni
  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('id, importo, tipo, data, conto, descrizione, stato_riconciliazione, controparte, fattura_id')
    .range(0, 9999)

  // Build fattura_id -> fattura map
  const fatturaMap = new Map<string, any>()
  for (const f of fatture || []) {
    fatturaMap.set(f.id, f)
  }

  // Map: normalized name -> { original name, fatture, transazioni }
  const soggettiMap = new Map<string, {
    originalName: string
    fatture: any[]
    transazioni: any[]
  }>()

  // Process fatture - group by soggetto
  for (const f of fatture || []) {
    const denom = f.tipo === 'emessa'
      ? f.denominazione_cliente
      : f.denominazione_fornitore

    if (!denom) continue

    const normalizedKey = normalizeName(denom)
    if (!normalizedKey) continue

    if (!soggettiMap.has(normalizedKey)) {
      soggettiMap.set(normalizedKey, {
        originalName: denom,
        fatture: [],
        transazioni: []
      })
    }

    soggettiMap.get(normalizedKey)!.fatture.push({
      id: f.id,
      numero: f.numero,
      tipo: f.tipo, // 'emessa' (attiva) | 'ricevuta' (passiva)
      totale: f.totale,
      data: f.data_emissione,
      stato: f.stato_riconciliazione
    })
  }

  // Build transazione -> fatture map (N:1: una transazione può avere più fatture)
  const transazioneToFatture = new Map<string, any[]>()
  for (const f of fatture || []) {
    if (f.transazione_id) {
      if (!transazioneToFatture.has(f.transazione_id)) {
        transazioneToFatture.set(f.transazione_id, [])
      }
      transazioneToFatture.get(f.transazione_id)!.push(f)
    }
  }

  // Process transazioni - track which ones get assigned to a soggetto
  const matchedTransIds = new Set<string>()

  for (const t of transazioni || []) {
    let normalizedKey = ''

    // 1. Se riconciliata, usa il soggetto dalle fatture collegate (via transazione_id)
    const fattureCollegate = transazioneToFatture.get(t.id) || []
    if (fattureCollegate.length > 0) {
      const fattura = fattureCollegate[0] // Usa la prima fattura per determinare il soggetto
      const denom = fattura.tipo === 'emessa'
        ? fattura.denominazione_cliente
        : fattura.denominazione_fornitore
      if (denom) {
        normalizedKey = normalizeName(denom)
      }
    }

    // 2. Se non riconciliata, cerca match ESATTO sulla controparte
    if (!normalizedKey && t.controparte) {
      const normalizedControparte = normalizeName(t.controparte)
      // Match esatto (dopo normalizzazione)
      if (soggettiMap.has(normalizedControparte)) {
        normalizedKey = normalizedControparte
      }
    }

    // Se trovato un soggetto, aggiungi la transazione
    if (normalizedKey && soggettiMap.has(normalizedKey)) {
      soggettiMap.get(normalizedKey)!.transazioni.push({
        id: t.id,
        importo: Math.abs(t.importo),
        tipo: t.tipo,
        data: t.data,
        conto: t.conto,
        descrizione: t.descrizione,
        controparte: t.controparte,
        stato: t.stato_riconciliazione,
        fatture_ids: fattureCollegate.map(f => f.id) // N:1: array di fatture collegate
      })
      matchedTransIds.add(t.id)
    }
  }

  // Build list of orphan transactions (no matching soggetto)
  const orfane = (transazioni || [])
    .filter(t => !matchedTransIds.has(t.id))
    .map(t => ({
      id: t.id,
      importo: Math.abs(t.importo),
      tipo: t.tipo,
      data: t.data,
      conto: t.conto,
      descrizione: t.descrizione,
      controparte: t.controparte,
      stato: t.stato_riconciliazione,
    }))
    .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())

  // Convert to array and calculate totals
  const soggetti = Array.from(soggettiMap.values())
    .map(data => {
      const totaleFatture = data.fatture.reduce((sum, f) => sum + (f.totale || 0), 0)
      const totaleTransazioni = data.transazioni.reduce((sum, t) => sum + (t.importo || 0), 0)

      return {
        denominazione: data.originalName,
        fatture: data.fatture.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()),
        transazioni: data.transazioni.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()),
        totaleFatture,
        totaleTransazioni,
        saldo: totaleFatture - totaleTransazioni
      }
    })
    .filter(s => s.fatture.length > 0 || s.transazioni.length > 0)
    .sort((a, b) => (b.totaleFatture + b.totaleTransazioni) - (a.totaleFatture + a.totaleTransazioni))

  return NextResponse.json({ soggetti, orfane })
}
