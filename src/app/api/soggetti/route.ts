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

// Alias detection: i casi tipo "LA PECORA NERA EDITORE DI CARGIANI SIMON" vs
// "La Pecora Nera Editore" cadono sotto il 75% di Levenshtein per via del
// suffisso lungo. Qui rileviamo "lo stesso soggetto" se uno è contenuto
// nell'altro (case-insensitive, normalizzato) con almeno 8 caratteri e 2 parole
// significative, oppure se l'80% delle parole significative del più corto
// appaiono nel più lungo.
function isAliasName(a: string, b: string): boolean {
  if (!a || !b) return false
  const na = a.toLowerCase().trim()
  const nb = b.toLowerCase().trim()
  if (!na || !nb) return false
  if (na === nb) return true
  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length > nb.length ? na : nb
  if (shorter.length < 8) return false
  if (longer.includes(shorter)) return true
  const words = shorter.split(/\s+/).filter(w => w.length >= 3)
  if (words.length < 2) return false
  const found = words.filter(w => longer.includes(w)).length
  return found / words.length >= 0.8
}

// Fetch paginato — Supabase ha un limite di 1000 righe per query a livello di
// progetto. Se il DB ha più di 1000 record, una singola select li tronca silenziosamente.
// Questa funzione itera in batch finché non c'è più niente da leggere.
async function fetchAllPaginated<T>(
  supabase: ReturnType<typeof createServerClient>,
  table: string,
  selectFields: string,
  orderBy: string = 'created_at'
): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  let from = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (let safetyCounter = 0; safetyCounter < 100; safetyCounter++) {
    const { data, error } = await supabase
      .from(table)
      .select(selectFields)
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Errore fetch ${table}: ${error.message}`)
    if (!data || data.length === 0) break
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    all.push(...(data as any[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

export async function GET() {
  const supabase = createServerClient()

  // Load TUTTE le fatture e transazioni con paginazione
  const fatture = await fetchAllPaginated<{
    id: string; numero: string; tipo: string; tipo_documento: string;
    totale: number; imponibile: number; imposta: number;
    data_emissione: string; data_ricezione: string | null;
    stato_riconciliazione: string;
    denominazione_fornitore: string | null; piva_fornitore: string | null;
    denominazione_cliente: string | null; piva_cliente: string | null;
    transazione_id: string | null; fonte: string | null; note: string | null;
  }>(
    supabase,
    'fatture',
    'id, numero, tipo, tipo_documento, totale, imponibile, imposta, data_emissione, data_ricezione, stato_riconciliazione, denominazione_fornitore, piva_fornitore, denominazione_cliente, piva_cliente, transazione_id, fonte, note'
  )

  const transazioni = await fetchAllPaginated<{
    id: string; importo: number; tipo: string; data: string;
    conto: string; descrizione: string | null;
    stato_riconciliazione: string; controparte: string | null;
    fattura_id: string | null; riferimento: string | null; note: string | null;
  }>(
    supabase,
    'transazioni',
    'id, importo, tipo, data, conto, descrizione, stato_riconciliazione, controparte, fattura_id, riferimento, note'
  )

  // Conta reale dal DB (verifica che la paginazione non abbia perso nulla)
  const { count: dbTransCount } = await supabase
    .from('transazioni')
    .select('id', { count: 'exact', head: true })
  const { count: dbFatCount } = await supabase
    .from('fatture')
    .select('id', { count: 'exact', head: true })

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
      tipo_documento: f.tipo_documento || 'fattura',
      totale: f.totale,
      imponibile: f.imponibile,
      imposta: f.imposta,
      data: f.data_emissione,
      data_ricezione: f.data_ricezione,
      stato: f.stato_riconciliazione,
      denominazione_cliente: f.denominazione_cliente,
      denominazione_fornitore: f.denominazione_fornitore,
      piva_cliente: f.piva_cliente,
      piva_fornitore: f.piva_fornitore,
      fonte: f.fonte,
      note: f.note,
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

    // 3c) Alias match: uno contenuto nell'altro (es. "LA PECORA NERA EDITORE DI
    // CARGIANI SIMON" ⊃ "La Pecora Nera Editore"). Vince sul fuzzy quando vale.
    if (!key && t.controparte && t.stato_riconciliazione !== 'non_trovata') {
      for (const [sk, sdata] of soggettiMap.entries()) {
        if (isAliasName(t.controparte, sdata.originalName)) {
          key = sk
          break
        }
      }
    }

    // 3d) Fuzzy match: similarity tra controparte e displayName di un soggetto ≥ 75%
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
        importo_signed: t.importo,
        tipo: t.tipo,
        data: t.data,
        conto: t.conto,
        descrizione: t.descrizione,
        controparte: t.controparte,
        riferimento: t.riferimento,
        note: t.note,
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
    riferimento?: string | null
    note?: string | null
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
      riferimento: t.riferimento,
      note: t.note,
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

  // DEDUP CRITICO: se due soggetti hanno lo stesso display name (case-insensitive,
  // trim), li fondiamo in uno. Causa tipica: soggetti_cluster con varianti che
  // normalizzano in modo diverso ma mostrano lo stesso testo all'utente.
  type SoggettoData = { originalName: string; fatture: any[]; transazioni: any[] }
  const dedupedMap = new Map<string, { primaryKey: string; data: SoggettoData }>()
  for (const [key, data] of soggettiMap.entries()) {
    const displayKey = data.originalName.toLowerCase().trim()
    if (!dedupedMap.has(displayKey)) {
      dedupedMap.set(displayKey, {
        primaryKey: key,
        data: {
          originalName: data.originalName,
          fatture: [...data.fatture],
          transazioni: [...data.transazioni],
        },
      })
    } else {
      const existing = dedupedMap.get(displayKey)!
      existing.data.fatture.push(...data.fatture)
      existing.data.transazioni.push(...data.transazioni)
    }
  }
  // ALIAS DEDUP: fonde soggetti dove uno è un alias (substring/parole) dell'altro.
  // Es: "LA PECORA NERA EDITORE DI CARGIANI SIMON" → "La Pecora Nera Editore".
  // Manteniamo il display più CORTO come canonico (più leggibile).
  const sortedKeys = Array.from(dedupedMap.keys())
    .sort((a, b) => dedupedMap.get(a)!.data.originalName.length - dedupedMap.get(b)!.data.originalName.length)
  const aliasMerged = new Set<string>()
  for (let i = 0; i < sortedKeys.length; i++) {
    const shorterKey = sortedKeys[i]
    if (aliasMerged.has(shorterKey)) continue
    const shorter = dedupedMap.get(shorterKey)!
    for (let j = i + 1; j < sortedKeys.length; j++) {
      const longerKey = sortedKeys[j]
      if (aliasMerged.has(longerKey)) continue
      const longer = dedupedMap.get(longerKey)!
      if (isAliasName(shorter.data.originalName, longer.data.originalName)) {
        shorter.data.fatture.push(...longer.data.fatture)
        shorter.data.transazioni.push(...longer.data.transazioni)
        aliasMerged.add(longerKey)
      }
    }
  }
  for (const k of aliasMerged) dedupedMap.delete(k)

  // Dedup anche fatture e transazioni per id (safety net contro doppi inserimenti)
  for (const { data } of dedupedMap.values()) {
    const seenF = new Set<string>()
    data.fatture = data.fatture.filter(f => {
      if (seenF.has(f.id)) return false
      seenF.add(f.id); return true
    })
    const seenT = new Set<string>()
    data.transazioni = data.transazioni.filter(t => {
      if (seenT.has(t.id)) return false
      seenT.add(t.id); return true
    })
  }

  // Build soggetti array (with fatture or transazioni, sorted by aggregate)
  const soggetti = Array.from(dedupedMap.values())
    .map(({ primaryKey, data }) => {
      const key = primaryKey
      // Le note di credito vanno SOTTRATTE dal totale fatture del soggetto:
      // riducono il debito (se ricevute) o il credito (se emesse) verso il soggetto.
      const totaleFatture = data.fatture.reduce((sum, f) => {
        const sign = f.tipo_documento === 'nota_credito' ? -1 : 1
        return sum + sign * (f.totale || 0)
      }, 0)
      const totaleTransazioni = data.transazioni.reduce((sum, t) => sum + (t.importo || 0), 0)
      const noteCreditoCount = data.fatture.filter(f => f.tipo_documento === 'nota_credito').length
      return {
        key, // chiave normalizzata, identificatore unico
        denominazione: data.originalName,
        fatture: data.fatture.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()),
        transazioni: data.transazioni.sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()),
        totaleFatture,
        totaleTransazioni,
        noteCreditoCount,
        saldo: totaleFatture - totaleTransazioni,
      }
    })
    .filter(s => s.fatture.length > 0 || s.transazioni.length > 0)
    .sort((a, b) => (b.totaleFatture + b.totaleTransazioni) - (a.totaleFatture + a.totaleTransazioni))

  // Lista TRALASCIATI: fatture e transazioni con stato_riconciliazione='non_trovata'
  // (estratti dalle note se presenti come '[Tralasciata: motivo]\n…')
  function estraiMotivo(note: string | null | undefined): string {
    if (!note) return ''
    const m = /^\[Tralasciata:\s*(.+?)\]/.exec(note)
    return m ? m[1] : ''
  }

  const fattureTralasciate = (fatture || [])
    .filter(f => f.stato_riconciliazione === 'non_trovata')
    .map(f => {
      const denom = f.tipo === 'emessa' ? f.denominazione_cliente : f.denominazione_fornitore
      return {
        id: f.id,
        numero: f.numero,
        tipo: f.tipo,
        tipo_documento: f.tipo_documento || 'fattura',
        totale: f.totale,
        data: f.data_emissione,
        denominazione: denom || '—',
        motivo: estraiMotivo((f as { note?: string | null }).note),
      }
    })
    .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())

  // Need to refetch notes; we didn't select 'note' above. Let's refetch only the ignored ones.
  const tralasciatIdsF = fattureTralasciate.map(f => f.id)
  if (tralasciatIdsF.length > 0) {
    const { data: noteRows } = await supabase
      .from('fatture')
      .select('id, note')
      .in('id', tralasciatIdsF)
    const noteMap = new Map<string, string | null>()
    for (const r of noteRows || []) noteMap.set(r.id, r.note)
    for (const f of fattureTralasciate) {
      f.motivo = estraiMotivo(noteMap.get(f.id))
    }
  }

  const transTralasciate = (transazioni || [])
    .filter(t => t.stato_riconciliazione === 'non_trovata')
    .map(t => ({
      id: t.id,
      importo: Math.abs(t.importo),
      tipo: t.tipo,
      data: t.data,
      conto: t.conto,
      descrizione: t.descrizione,
      controparte: t.controparte,
      motivo: '',
    }))
    .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())

  const tralasciatIdsT = transTralasciate.map(t => t.id)
  if (tralasciatIdsT.length > 0) {
    const { data: noteRows } = await supabase
      .from('transazioni')
      .select('id, note')
      .in('id', tralasciatIdsT)
    const noteMap = new Map<string, string | null>()
    for (const r of noteRows || []) noteMap.set(r.id, r.note)
    for (const t of transTralasciate) {
      t.motivo = estraiMotivo(noteMap.get(t.id))
    }
  }

  // AUDIT: verifica che ogni transazione e ogni fattura sia contabilizzata
  // esattamente una volta nelle sezioni della response. Se l'audit non torna,
  // c'è un bug nel matching e il client deve mostrare un alert.
  const transInSoggetti = new Set<string>()
  for (const s of soggetti) for (const t of s.transazioni) transInSoggetti.add(t.id)
  const transInOrfani = new Set<string>()
  for (const g of orfaneGroups) for (const t of g.transazioni) transInOrfani.add(t.id)
  const transInTralasciati = new Set<string>(transTralasciate.map(t => t.id))
  const allTransIds = new Set<string>((transazioni || []).map(t => t.id))
  const accountedTrans = new Set<string>([
    ...transInSoggetti,
    ...transInOrfani,
    ...transInTralasciati,
  ])
  const missingTrans: string[] = []
  for (const id of allTransIds) if (!accountedTrans.has(id)) missingTrans.push(id)

  const fattureInSoggetti = new Set<string>()
  for (const s of soggetti) for (const f of s.fatture) fattureInSoggetti.add(f.id)
  const fattureInTralasciati = new Set<string>(fattureTralasciate.map(f => f.id))
  const allFatIds = new Set<string>((fatture || []).map(f => f.id))
  const accountedFat = new Set<string>([...fattureInSoggetti, ...fattureInTralasciati])
  const missingFat: string[] = []
  for (const id of allFatIds) if (!accountedFat.has(id)) missingFat.push(id)

  return NextResponse.json({
    soggetti,
    orfaneGroups,
    tralasciati: { fatture: fattureTralasciate, transazioni: transTralasciate },
    audit: {
      transazioni: {
        totalInDb: dbTransCount ?? allTransIds.size,        // count reale dal DB (SELECT count)
        totalFetched: allTransIds.size,                     // quanto effettivamente fetchato
        inSoggetti: transInSoggetti.size,
        inOrfani: transInOrfani.size,
        inTralasciati: transInTralasciati.size,
        accounted: accountedTrans.size,
        missing: missingTrans.length + Math.max(0, (dbTransCount ?? 0) - allTransIds.size),
        missingIds: missingTrans.slice(0, 50),
      },
      fatture: {
        totalInDb: dbFatCount ?? allFatIds.size,
        totalFetched: allFatIds.size,
        inSoggetti: fattureInSoggetti.size,
        inTralasciati: fattureInTralasciati.size,
        accounted: accountedFat.size,
        missing: missingFat.length + Math.max(0, (dbFatCount ?? 0) - allFatIds.size),
        missingIds: missingFat.slice(0, 50),
      },
    },
  })
}
