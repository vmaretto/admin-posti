import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { distance } from 'fastest-levenshtein'

export const dynamic = 'force-dynamic'

function normalizeName(name: string | null): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(srl|spa|snc|sas|srls|sapa|ltd|inc|gmbh|sarl|s r l|s p a)\b/g, '')
    .trim()
}

// 0..1 similarity (1 = identical)
function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 1
  return 1 - distance(a, b) / maxLen
}

export async function GET() {
  const supabase = createServerClient()

  // Load fatture, transazioni, soggetti_cluster
  const { data: fatture } = await supabase
    .from('fatture')
    .select('id, numero, tipo, totale, data_emissione, stato_riconciliazione, denominazione_fornitore, denominazione_cliente, transazione_id')
    .range(0, 9999)

  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('id, importo, tipo, data, conto, descrizione, stato_riconciliazione, controparte, fattura_id')
    .range(0, 9999)

  const { data: clusterRows } = await supabase
    .from('soggetti_cluster')
    .select('nome_normalizzato, varianti')

  // Map normalized -> { displayName, fatture[], transazioni[] }
  const soggettiMap = new Map<string, {
    originalName: string
    fatture: any[]
    transazioni: any[]
  }>()

  // 1) Process fatture → seed soggetti
  for (const f of fatture || []) {
    const denom = f.tipo === 'emessa'
      ? f.denominazione_cliente
      : f.denominazione_fornitore
    if (!denom) continue
    const key = normalizeName(denom)
    if (!key) continue

    if (!soggettiMap.has(key)) {
      soggettiMap.set(key, { originalName: denom, fatture: [], transazioni: [] })
    }
    soggettiMap.get(key)!.fatture.push({
      id: f.id,
      numero: f.numero,
      tipo: f.tipo,
      totale: f.totale,
      data: f.data_emissione,
      stato: f.stato_riconciliazione,
    })
  }

  // 2) Add user-created soggetti from cluster (those with no fatture yet)
  for (const c of clusterRows || []) {
    const key: string = c.nome_normalizzato
    if (!key) continue
    if (!soggettiMap.has(key)) {
      const display = Array.isArray(c.varianti) && c.varianti.length > 0 ? c.varianti[0] : key
      soggettiMap.set(key, { originalName: display, fatture: [], transazioni: [] })
    }
  }

  // Build transazione -> fatture[] map for linked invoices
  const transazioneToFatture = new Map<string, any[]>()
  for (const f of fatture || []) {
    if (f.transazione_id) {
      if (!transazioneToFatture.has(f.transazione_id)) {
        transazioneToFatture.set(f.transazione_id, [])
      }
      transazioneToFatture.get(f.transazione_id)!.push(f)
    }
  }

  // 3) Process transazioni; track which ones get bound to a soggetto
  const matchedTransIds = new Set<string>()

  for (const t of transazioni || []) {
    let key = ''

    // 3a) If linked via fattura.transazione_id, use that fattura's soggetto
    const linkedFatture = transazioneToFatture.get(t.id) || []
    if (linkedFatture.length > 0) {
      const f = linkedFatture[0]
      const denom = f.tipo === 'emessa' ? f.denominazione_cliente : f.denominazione_fornitore
      if (denom) key = normalizeName(denom)
    }

    // 3b) Otherwise match by normalized controparte
    if (!key && t.controparte) {
      const nc = normalizeName(t.controparte)
      if (nc && soggettiMap.has(nc)) key = nc
    }

    if (key && soggettiMap.has(key)) {
      soggettiMap.get(key)!.transazioni.push({
        id: t.id,
        importo: Math.abs(t.importo),
        tipo: t.tipo,
        data: t.data,
        conto: t.conto,
        descrizione: t.descrizione,
        controparte: t.controparte,
        stato: t.stato_riconciliazione,
        fatture_ids: linkedFatture.map(f => f.id),
      })
      matchedTransIds.add(t.id)
    }
  }

  // 4) Build orphan groups (transactions with no matching soggetto, excluding "tralasciate")
  type Orfana = {
    id: string
    importo: number
    tipo: string
    data: string
    conto: string
    descrizione: string | null
    controparte: string | null
    stato: string
  }

  const orphans: Orfana[] = (transazioni || [])
    .filter(t => !matchedTransIds.has(t.id))
    .filter(t => t.stato_riconciliazione !== 'non_trovata') // tralasciate = nascoste
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

  // Group by normalized controparte (or '__SENZA_DESCR__' if empty)
  const groupMap = new Map<string, { label: string; controparti: Set<string>; items: Orfana[] }>()
  for (const o of orphans) {
    const normalized = normalizeName(o.controparte) || '__SENZA_DESCR__'
    if (!groupMap.has(normalized)) {
      groupMap.set(normalized, {
        label: o.controparte || (o.descrizione || 'Senza controparte'),
        controparti: new Set<string>(),
        items: [],
      })
    }
    const g = groupMap.get(normalized)!
    if (o.controparte) g.controparti.add(o.controparte)
    g.items.push(o)
  }

  // Precompute soggetti keys for suggestions
  const soggettiKeys = Array.from(soggettiMap.keys())
  const soggettiDisplayByKey = new Map<string, string>()
  for (const [k, v] of soggettiMap.entries()) soggettiDisplayByKey.set(k, v.originalName)

  // Build orfaneGroups with totals + suggestions, sort by total desc
  const orfaneGroups = Array.from(groupMap.entries()).map(([key, g]) => {
    const totale = g.items.reduce((s, x) => s + x.importo, 0)
    const count = g.items.length

    // Suggest best matching existing soggetto (similarity ≥ 0.6)
    let suggestion: { soggetto: string; confidence: number } | null = null
    if (key !== '__SENZA_DESCR__') {
      let bestKey = ''
      let bestSim = 0
      for (const sk of soggettiKeys) {
        const sim = similarity(key, sk)
        if (sim > bestSim) {
          bestSim = sim
          bestKey = sk
        }
      }
      if (bestKey && bestSim >= 0.6 && bestSim < 1) {
        suggestion = {
          soggetto: soggettiDisplayByKey.get(bestKey) || bestKey,
          confidence: Math.round(bestSim * 100),
        }
      }
    }

    return {
      key,
      label: g.label,
      varianti: Array.from(g.controparti),
      count,
      totale,
      suggestion,
      transazioni: g.items.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()),
    }
  })
    .sort((a, b) => b.totale - a.totale)

  // Build soggetti array (with fatture or transazioni, sorted by aggregate)
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
        saldo: totaleFatture - totaleTransazioni,
      }
    })
    .filter(s => s.fatture.length > 0 || s.transazioni.length > 0)
    .sort((a, b) => (b.totaleFatture + b.totaleTransazioni) - (a.totaleFatture + a.totaleTransazioni))

  return NextResponse.json({ soggetti, orfaneGroups })
}
