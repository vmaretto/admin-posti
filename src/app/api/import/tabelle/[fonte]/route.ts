import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { parsePeriodo } from '@/lib/periodo'

export const dynamic = 'force-dynamic'

type SortDir = 'asc' | 'desc'
type FonteTipo = 'transazioni' | 'fatture'

interface RouteContext {
  params: Promise<{ fonte: string }>
}

interface TotaliTransazioni {
  entrate: number
  uscite: number
  count: number
}

interface TotaliFatture {
  imponibile: number
  imposta: number
  totale: number
  count: number
}

// Il builder Supabase/PostgREST cambia tipo a ogni step della chain.
// Teniamo l'opacita' confinata ai soli helper che applicano filtri comuni.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FilterQuery = any

const FALLBACK_CONTI = ['qonto', 'sella_conto', 'sella_carta', 'paypal', 'revolut']
const STATI_VALIDI = ['da_riconciliare', 'riconciliata', 'parziale', 'non_trovata']

const TRANS_SORT: Record<string, string> = {
  data: 'data',
  conto: 'conto',
  controparte: 'controparte',
  descrizione: 'descrizione',
  importo: 'importo',
  stato: 'stato_riconciliazione',
  note: 'note',
}

const FATTURE_SORT: Record<string, string> = {
  data: 'data_emissione',
  data_emissione: 'data_emissione',
  tipo: 'tipo',
  numero: 'numero',
  soggetto: 'denominazione_cliente',
  imponibile: 'imponibile',
  imposta: 'imposta',
  totale: 'totale',
  stato: 'stato_riconciliazione',
  note: 'note',
}

function parseNumber(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) return fallback
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseSortDir(value: string | null): SortDir {
  return value === 'asc' ? 'asc' : 'desc'
}

function parseStati(value: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map(s => s.trim())
    .filter(s => STATI_VALIDI.includes(s))
}

function likePattern(value: string): string {
  return `%${value.replace(/[%_]/g, '\\$&')}%`
}

function sumValue(rows: unknown, key: string): number {
  if (!Array.isArray(rows)) return 0
  const row = rows[0] as Record<string, unknown> | undefined
  const value = row?.[key]
  return typeof value === 'number' ? value : Number(value || 0)
}

async function getAllowedConti(supabase: ReturnType<typeof createServerClient>): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('conti_config')
    .select('key')
    .order('ordine', { ascending: true })

  if (error) return new Set(FALLBACK_CONTI)
  return new Set((data || []).map(row => String(row.key)))
}

function applyTransFilters(query: FilterQuery, params: URLSearchParams, fonte: string): FilterQuery {
  const periodo = parsePeriodo(params.get('periodo'))
  const from = params.get('from') || periodo.from
  const to = params.get('to') || periodo.to
  const controparte = params.get('controparte')?.trim()
  const importoMin = parseNumber(params.get('importoMin'))
  const importoMax = parseNumber(params.get('importoMax'))
  const stati = parseStati(params.get('stato'))
  const q = params.get('q')?.trim()

  let filtered = query.eq('conto', fonte)
  if (from) filtered = filtered.gte('data', from)
  if (to) filtered = filtered.lte('data', to)
  if (controparte) filtered = filtered.ilike('controparte', likePattern(controparte))
  if (importoMin !== null) filtered = filtered.gte('importo', importoMin)
  if (importoMax !== null) filtered = filtered.lte('importo', importoMax)
  if (stati.length > 0) filtered = filtered.in('stato_riconciliazione', stati)
  if (q) {
    const pattern = likePattern(q)
    filtered = filtered.or(`descrizione.ilike.${pattern},controparte.ilike.${pattern},riferimento.ilike.${pattern},note.ilike.${pattern}`)
  }
  return filtered
}

function applyFattureFilters(query: FilterQuery, params: URLSearchParams, fonte: string): FilterQuery {
  const periodo = parsePeriodo(params.get('periodo'))
  const from = params.get('from') || periodo.from
  const to = params.get('to') || periodo.to
  const controparte = params.get('controparte')?.trim()
  const importoMin = parseNumber(params.get('importoMin'))
  const importoMax = parseNumber(params.get('importoMax'))
  const stati = parseStati(params.get('stato'))
  const q = params.get('q')?.trim()

  let filtered = query.eq('fonte', fonte)
  if (from) filtered = filtered.gte('data_emissione', from)
  if (to) filtered = filtered.lte('data_emissione', to)
  if (controparte) {
    const pattern = likePattern(controparte)
    filtered = filtered.or(`denominazione_cliente.ilike.${pattern},denominazione_fornitore.ilike.${pattern}`)
  }
  if (importoMin !== null) filtered = filtered.gte('totale', importoMin)
  if (importoMax !== null) filtered = filtered.lte('totale', importoMax)
  if (stati.length > 0) filtered = filtered.in('stato_riconciliazione', stati)
  if (q) {
    const pattern = likePattern(q)
    filtered = filtered.or(`numero.ilike.${pattern},note.ilike.${pattern},denominazione_cliente.ilike.${pattern},denominazione_fornitore.ilike.${pattern}`)
  }
  return filtered
}

async function getTransTotali(
  supabase: ReturnType<typeof createServerClient>,
  params: URLSearchParams,
  fonte: string,
  count: number,
): Promise<TotaliTransazioni> {
  const entrateQuery = applyTransFilters(
    supabase.from('transazioni').select('entrate:importo.sum()').eq('tipo', 'entrata'),
    params,
    fonte,
  )
  const usciteQuery = applyTransFilters(
    supabase.from('transazioni').select('uscite:importo.sum()').eq('tipo', 'uscita'),
    params,
    fonte,
  )
  const [{ data: entrate }, { data: uscite }] = await Promise.all([entrateQuery, usciteQuery])
  return {
    entrate: Math.abs(sumValue(entrate, 'entrate')),
    uscite: Math.abs(sumValue(uscite, 'uscite')),
    count,
  }
}

async function getFattureTotali(
  supabase: ReturnType<typeof createServerClient>,
  params: URLSearchParams,
  fonte: string,
  count: number,
): Promise<TotaliFatture> {
  const query = applyFattureFilters(
    supabase.from('fatture').select('imponibile_sum:imponibile.sum(), imposta_sum:imposta.sum(), totale_sum:totale.sum()'),
    params,
    fonte,
  )
  const { data } = await query
  return {
    imponibile: sumValue(data, 'imponibile_sum'),
    imposta: sumValue(data, 'imposta_sum'),
    totale: sumValue(data, 'totale_sum'),
    count,
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const supabase = createServerClient()
  const { fonte } = await context.params
  const { searchParams } = new URL(request.url)

  const tipo: FonteTipo = fonte === 'sdi' || fonte === 'estero' ? 'fatture' : 'transazioni'
  if (tipo === 'transazioni') {
    const allowedConti = await getAllowedConti(supabase)
    if (!allowedConti.has(fonte)) {
      return NextResponse.json({ error: 'Fonte non trovata' }, { status: 404 })
    }
  }

  const page = parsePositiveInt(searchParams.get('page'), 1)
  const pageSize = Math.min(parsePositiveInt(searchParams.get('pageSize'), 50), 200)
  const fromIndex = (page - 1) * pageSize
  const toIndex = fromIndex + pageSize - 1
  const sortDir = parseSortDir(searchParams.get('sortDir'))

  if (tipo === 'transazioni') {
    const sortBy = TRANS_SORT[searchParams.get('sortBy') || 'data'] || 'data'
    const baseQuery = applyTransFilters(
      supabase.from('transazioni').select('*', { count: 'exact' }),
      searchParams,
      fonte,
    )
      .order(sortBy, { ascending: sortDir === 'asc', nullsFirst: false })
      .range(fromIndex, toIndex)

    const { data, error, count } = await baseQuery
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const total = count || 0
    const totali = await getTransTotali(supabase, searchParams, fonte, total)
    return NextResponse.json({ rows: data || [], total, page, pageSize, totali })
  }

  const sortBy = FATTURE_SORT[searchParams.get('sortBy') || 'data'] || 'data_emissione'
  const baseQuery = applyFattureFilters(
    supabase.from('fatture').select('*', { count: 'exact' }),
    searchParams,
    fonte,
  )
    .order(sortBy, { ascending: sortDir === 'asc', nullsFirst: false })
    .range(fromIndex, toIndex)

  const { data, error, count } = await baseQuery
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const total = count || 0
  const totali = await getFattureTotali(supabase, searchParams, fonte, total)
  return NextResponse.json({ rows: data || [], total, page, pageSize, totali })
}
