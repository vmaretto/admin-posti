import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Fallback se la tabella conti_config non esiste ancora (migration non lanciata).
// Wise rimosso: ora le fonti sono configurabili dal frontend (Step 1).
const FALLBACK_CONTI_ATTESI: { key: string; label: string; hasParser: boolean }[] = [
  { key: 'qonto', label: 'Qonto', hasParser: false },
  { key: 'sella_conto', label: 'Sella conto', hasParser: false },
  { key: 'sella_carta', label: 'Sella carta', hasParser: false },
  { key: 'paypal', label: 'PayPal', hasParser: true },
  { key: 'revolut', label: 'Revolut', hasParser: false },
]

interface ContoStats {
  conto: string
  label: string
  hasParser: boolean
  count: number
  entrate: number
  uscite: number
  firstDate: string | null
  lastDate: string | null
  maxGapDays: number // gap massimo (in giorni) senza movimenti dentro il periodo
  presentNelDb: boolean
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  return Math.round((db - da) / (1000 * 60 * 60 * 24))
}

function computeMaxGap(dates: string[], periodFrom: string, periodTo: string): number {
  // Estremo: nessuna data → l'intero periodo è un gap
  if (dates.length === 0) return daysBetween(periodFrom, periodTo) + 1
  const sorted = [...dates].sort()
  let maxGap = 0
  // gap iniziale: periodFrom → prima data
  maxGap = Math.max(maxGap, daysBetween(periodFrom, sorted[0]))
  // gap tra coppie consecutive
  for (let i = 1; i < sorted.length; i++) {
    maxGap = Math.max(maxGap, daysBetween(sorted[i - 1], sorted[i]))
  }
  // gap finale: ultima data → periodTo
  maxGap = Math.max(maxGap, daysBetween(sorted[sorted.length - 1], periodTo))
  return maxGap
}

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Restituisce statistiche aggregate per gli step del wizard.
export async function GET(request: NextRequest) {
  const supabase = createServerClient()
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!from || !to) {
    return NextResponse.json({ error: 'from/to richiesti' }, { status: 400 })
  }

  // ---- Lista fonti configurate (DB con fallback) ----
  let CONTI_ATTESI = FALLBACK_CONTI_ATTESI
  const { data: contiCfg } = await supabase
    .from('conti_config')
    .select('key, label, has_parser, ordine')
    .order('ordine', { ascending: true })
  if (contiCfg && contiCfg.length > 0) {
    CONTI_ATTESI = contiCfg.map(c => ({ key: c.key, label: c.label, hasParser: c.has_parser }))
  }

  // ---- Transazioni del periodo ----
  const { data: trans } = await supabase
    .from('transazioni')
    .select('id, tipo, importo, data, conto, stato_riconciliazione')
    .gte('data', from)
    .lte('data', to)
    .range(0, 9999)

  // Raggruppa per conto, calcola counter + importi + range date
  const perContoMap = new Map<string, {
    count: number
    entrate: number
    uscite: number
    dates: string[]
  }>()
  let transScoperte = 0
  let transScoperteImporto = 0
  let transRiconciliate = 0
  for (const t of trans || []) {
    const conto = t.conto || '?'
    if (!perContoMap.has(conto)) {
      perContoMap.set(conto, { count: 0, entrate: 0, uscite: 0, dates: [] })
    }
    const g = perContoMap.get(conto)!
    g.count++
    if (t.tipo === 'entrata') g.entrate += Math.abs(t.importo || 0)
    else g.uscite += Math.abs(t.importo || 0)
    if (t.data) g.dates.push(t.data)

    if (t.stato_riconciliazione === 'riconciliata') {
      transRiconciliate++
    } else if (t.stato_riconciliazione === 'da_riconciliare') {
      transScoperte++
      transScoperteImporto += Math.abs(t.importo || 0)
    }
  }

  // Costruisci il dettaglio per i conti ATTESI + eventuali conti in DB non in lista
  const contiAttesiKeys = new Set(CONTI_ATTESI.map(c => c.key))
  const contiDb = Array.from(perContoMap.keys()).filter(k => k && k !== '?')
  const contiAltri = contiDb.filter(k => !contiAttesiKeys.has(k))

  const allConti: ContoStats[] = []
  for (const ca of CONTI_ATTESI) {
    const g = perContoMap.get(ca.key)
    const dates = g?.dates || []
    const sorted = [...dates].sort()
    allConti.push({
      conto: ca.key,
      label: ca.label,
      hasParser: ca.hasParser,
      count: g?.count || 0,
      entrate: g?.entrate || 0,
      uscite: g?.uscite || 0,
      firstDate: sorted[0] || null,
      lastDate: sorted[sorted.length - 1] || null,
      maxGapDays: computeMaxGap(dates, from, to),
      presentNelDb: dates.length > 0,
    })
  }
  for (const k of contiAltri) {
    const g = perContoMap.get(k)!
    const sorted = [...g.dates].sort()
    allConti.push({
      conto: k,
      label: k,
      hasParser: false,
      count: g.count,
      entrate: g.entrate,
      uscite: g.uscite,
      firstDate: sorted[0] || null,
      lastDate: sorted[sorted.length - 1] || null,
      maxGapDays: computeMaxGap(g.dates, from, to),
      presentNelDb: true,
    })
  }

  // ---- Fatture del periodo ----
  const { data: fatt } = await supabase
    .from('fatture')
    .select('id, tipo, totale, stato_riconciliazione, fonte, data_emissione')
    .gte('data_emissione', from)
    .lte('data_emissione', to)
    .range(0, 9999)

  let fattureEmesse = 0
  let fattureEmesseTot = 0
  let fattureRicevute = 0
  let fattureRicevuteTot = 0
  let fattureEstere = 0
  let fattureRiconciliate = 0
  let fattureScoperte = 0
  const emesseDates: string[] = []
  const ricevuteDates: string[] = []
  for (const f of fatt || []) {
    if (f.tipo === 'emessa') {
      fattureEmesse++
      fattureEmesseTot += Math.abs(f.totale || 0)
      if (f.data_emissione) emesseDates.push(f.data_emissione)
    } else if (f.tipo === 'ricevuta') {
      fattureRicevute++
      fattureRicevuteTot += Math.abs(f.totale || 0)
      if (f.data_emissione) ricevuteDates.push(f.data_emissione)
    }
    if (f.fonte === 'estero') fattureEstere++
    if (f.stato_riconciliazione === 'riconciliata') fattureRiconciliate++
    else if (f.stato_riconciliazione === 'da_riconciliare') fattureScoperte++
  }

  const emesseSorted = [...emesseDates].sort()
  const ricevuteSorted = [...ricevuteDates].sort()

  return NextResponse.json({
    periodo: { from, to },
    trans: {
      totale: trans?.length || 0,
      perConto: Object.fromEntries(
        allConti.map(c => [c.conto, {
          count: c.count, entrate: c.entrate, uscite: c.uscite,
        }]),
      ),
      // Dettaglio ricco per Step 1 (con gap detection)
      contiDettaglio: allConti,
      contiAltri,
      scoperte: transScoperte,
      scoperteImporto: transScoperteImporto,
      riconciliate: transRiconciliate,
    },
    fatture: {
      totale: fatt?.length || 0,
      emesse: fattureEmesse,
      emesseTotale: fattureEmesseTot,
      emesseFirstDate: emesseSorted[0] || null,
      emesseLastDate: emesseSorted[emesseSorted.length - 1] || null,
      emesseMaxGap: computeMaxGap(emesseDates, from, to),
      ricevute: fattureRicevute,
      ricevuteTotale: fattureRicevuteTot,
      ricevuteFirstDate: ricevuteSorted[0] || null,
      ricevuteLastDate: ricevuteSorted[ricevuteSorted.length - 1] || null,
      ricevuteMaxGap: computeMaxGap(ricevuteDates, from, to),
      estere: fattureEstere,
      riconciliate: fattureRiconciliate,
      scoperte: fattureScoperte,
    },
  })
}
