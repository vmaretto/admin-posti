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

// 0..1 similarity (1 = identical) — computed on simple-lower (trimmed lowercase)
function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  const aa = a.toLowerCase().trim()
  const bb = b.toLowerCase().trim()
  if (aa === bb) return 1
  const maxLen = Math.max(aa.length, bb.length)
  if (maxLen === 0) return 1
  return 1 - distance(aa, bb) / maxLen
}

// Soglie fuzzy matching
const FUZZY_AUTO_THRESHOLD = 0.75   // ≥75% → assegna automaticamente (no approva)
const FUZZY_SUGGEST_THRESHOLD = 0.5  // 50-75% → mostra suggerimento approvabile

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

  // 1) Process fatture → seed soggetti (escludendo le tralasciate)
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
    // Le fatture tralasciate non vengono mostrate nelle liste del soggetto
    if (f.stato_riconciliazione === 'non_trovata') continue
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

    // 3b) Otherwise match by normalized controparte (exact)
    if (!key && t.controparte) {
      const nc = normalizeName(t.controparte)
      if (nc && soggettiMap.has(nc)) key = nc
    }

    // 3c) Fuzzy match: similarity tra controparte e displayName di un soggetto ≥ 75%
    if (!key && t.controparte && t.stato_riconciliazione !== 'non_trovata') {
      let bestKey = ''
      let bestSim = 0
      for (const [sk, sdata] of soggettiMap.entries()) {
        const sim = similarity(t.controparte, sdata.originalName)
        if (sim > bestSim) {
          bestSim = sim
          bestKey = sk
        }
      }
      if (bestKey && bestSim >= FUZZY_AUTO_THRESHOLD) {
        key = bestKey
      }
    }

    // Le transazioni tralasciate non vanno mostrate nemmeno nei soggetti
    if (key && soggettiMap.has(key) && t.stato_riconciliazione !== 'non_trovata') {
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

  // Build orfaneGroups with totals + suggestions, sort by total desc
  // (i soggetti ≥75% sono già stati assegnati sopra dal fuzzy match)
  const soggettiEntries = Array.from(soggettiMap.values())

  const orfaneGroups = Array.from(groupMap.entries()).map(([key, g]) => {
    const totale = g.items.reduce((s, x) => s + x.importo, 0)
    const count = g.items.length

    // Suggerimento: best soggetto via similarity sui nomi ORIGINALI
    let suggestion: { soggetto: string; confidence: number } | null = null
    if (key !== '__SENZA_DESCR__') {
      let bestName = ''
      let bestSim = 0
      for (const s of soggettiEntries) {
        const sim = similarity(g.label, s.originalName)
        if (sim > bestSim) {
          bestSim = sim
          bestName = s.originalName
        }
      }
      // Mostra suggerimento solo nella fascia 50-75% (sopra il 75% è già stato auto-assegnato)
      if (bestName && bestSim >= FUZZY_SUGGEST_THRESHOLD && bestSim < FUZZY_AUTO_THRESHOLD) {
        suggestion = {
          soggetto: bestName,
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
