'use client'

export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, RefreshCw } from 'lucide-react'
import { Suspense, useEffect, useMemo, useState } from 'react'

type Stato = 'da_riconciliare' | 'riconciliata' | 'parziale' | 'non_trovata'
type FonteTipo = 'transazioni' | 'fatture'
type SortDir = 'asc' | 'desc'

interface ContoCfg {
  key: string
  label: string
  has_parser: boolean
}

interface FonteOption {
  key: string
  label: string
  tipo: FonteTipo
}

interface TransazioneRow {
  id: string
  data: string
  conto: string
  controparte: string | null
  descrizione: string | null
  importo: number
  tipo: 'entrata' | 'uscita'
  stato_riconciliazione: Stato | string | null
  note: string | null
}

interface FatturaRow {
  id: string
  data_emissione: string
  tipo: 'emessa' | 'ricevuta' | string
  numero: string | null
  denominazione_cliente: string | null
  denominazione_fornitore: string | null
  imponibile: number | null
  imposta: number | null
  totale: number | null
  stato_riconciliazione: Stato | string | null
  note: string | null
  transazione_id: string | null
}

interface ApiResponse {
  rows: Array<TransazioneRow | FatturaRow>
  total: number
  page: number
  pageSize: number
  totali?: {
    entrate?: number
    uscite?: number
    imponibile?: number
    imposta?: number
    totale?: number
    count: number
  }
  error?: string
}

const STATI: Array<{ key: Stato; label: string }> = [
  { key: 'da_riconciliare', label: 'Da riconciliare' },
  { key: 'riconciliata', label: 'Riconciliata' },
  { key: 'parziale', label: 'Parziale' },
  { key: 'non_trovata', label: 'Non trovata' },
]

const FALLBACK_CONTI: ContoCfg[] = [
  { key: 'qonto', label: 'Qonto', has_parser: true },
  { key: 'sella_conto', label: 'Sella conto', has_parser: true },
  { key: 'sella_carta', label: 'Sella carta', has_parser: true },
  { key: 'paypal', label: 'PayPal', has_parser: true },
  { key: 'revolut', label: 'Revolut', has_parser: true },
]

const VIRTUAL_FONTI: FonteOption[] = [
  { key: 'sdi', label: 'SDI', tipo: 'fatture' },
  { key: 'estero', label: 'Estero', tipo: 'fatture' },
]

function formatEuro(value: number | null | undefined): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value || 0)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('it-IT').format(date)
}

function statoLabel(value: string | null): string {
  return STATI.find(stato => stato.key === value)?.label || value || '-'
}

function isTransazione(row: TransazioneRow | FatturaRow): row is TransazioneRow {
  return 'data' in row
}

function getSoggetto(row: FatturaRow): string {
  return row.tipo === 'emessa'
    ? row.denominazione_cliente || '-'
    : row.denominazione_fornitore || '-'
}

function ImportTabelleInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()

  const [conti, setConti] = useState<ContoCfg[]>(FALLBACK_CONTI)
  const [loadingConti, setLoadingConti] = useState(true)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/conti')
      .then(res => res.json())
      .then(json => {
        const nextConti = Array.isArray(json?.conti) && json.conti.length > 0 ? json.conti : FALLBACK_CONTI
        setConti(nextConti)
      })
      .catch(() => setConti(FALLBACK_CONTI))
      .finally(() => setLoadingConti(false))
  }, [])

  const fonti = useMemo<FonteOption[]>(() => {
    const contoFonti = conti.map(conto => ({
      key: conto.key,
      label: conto.label,
      tipo: 'transazioni' as const,
    }))
    return [...contoFonti, ...VIRTUAL_FONTI]
  }, [conti])

  const fonteParam = searchParams.get('fonte')
  const selectedFonte = fonti.find(fonte => fonte.key === fonteParam) || fonti[0] || VIRTUAL_FONTI[0]
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const sortBy = searchParams.get('sortBy') || 'data'
  const sortDir = (searchParams.get('sortDir') === 'asc' ? 'asc' : 'desc') as SortDir
  const selectedStati = (searchParams.get('stato') || '').split(',').filter(Boolean)

  function replaceParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') params.delete(key)
      else params.set(key, value)
    }
    router.replace(`${pathname}?${params.toString()}`)
  }

  function setFilter(key: string, value: string) {
    replaceParams({ [key]: value || null, page: null })
  }

  function setFonte(key: string) {
    replaceParams({ fonte: key, page: null, sortBy: null, sortDir: null })
  }

  function setSort(column: string) {
    const nextDir: SortDir = sortBy === column && sortDir === 'asc' ? 'desc' : 'asc'
    replaceParams({ sortBy: column, sortDir: nextDir, page: null })
  }

  function toggleStato(stato: Stato) {
    const next = selectedStati.includes(stato)
      ? selectedStati.filter(s => s !== stato)
      : [...selectedStati, stato]
    replaceParams({ stato: next.join(',') || null, page: null })
  }

  useEffect(() => {
    if (loadingConti || !selectedFonte?.key) return

    const controller = new AbortController()
    const params = new URLSearchParams(queryString)
    params.delete('fonte')
    params.set('page', String(page))
    params.set('pageSize', '50')

    // Caricamento remoto guidato dall'URL: qui lo stato serve solo per feedback UI.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    fetch(`/api/import/tabelle/${selectedFonte.key}?${params.toString()}`, { signal: controller.signal })
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json?.error || 'Errore durante il caricamento')
        return json as ApiResponse
      })
      .then(setData)
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setError(String(err.message || err))
        setData(null)
      })
      .finally(() => setLoading(false))

    return () => controller.abort()
  }, [loadingConti, selectedFonte?.key, queryString, page])

  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 50)))
  const rows = data?.rows || []

  const filterValue = (key: string) => searchParams.get(key) || ''

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Tabelle import</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Controllo righe importate per fonte, con filtri salvati nell&apos;URL.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <RefreshCw className="h-4 w-4" />
          Aggiorna
        </button>
      </div>

      <section className="sticky top-9 z-20 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow">
        <div className="border-b border-gray-200 dark:border-gray-700 p-3">
          <div className="flex items-center gap-2 overflow-x-auto">
            {fonti.map(fonte => (
              <button
                key={fonte.key}
                type="button"
                onClick={() => setFonte(fonte.key)}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${
                  selectedFonte.key === fonte.key
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {fonte.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 p-3">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
            Dal
            <input
              type="date"
              value={filterValue('from')}
              onChange={e => setFilter('from', e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
            Al
            <input
              type="date"
              value={filterValue('to')}
              onChange={e => setFilter('to', e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
            Controparte / soggetto
            <input
              type="search"
              value={filterValue('controparte')}
              onChange={e => setFilter('controparte', e.target.value)}
              placeholder="Nome"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
            Importo min
            <input
              type="number"
              step="0.01"
              value={filterValue('importoMin')}
              onChange={e => setFilter('importoMin', e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
            Importo max
            <input
              type="number"
              step="0.01"
              value={filterValue('importoMax')}
              onChange={e => setFilter('importoMax', e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
          </label>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-300">
            Ricerca
            <input
              type="search"
              value={filterValue('q')}
              onChange={e => setFilter('q', e.target.value)}
              placeholder="Descrizione, numero, note"
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2 px-3 pb-3">
          {STATI.map(stato => (
            <button
              key={stato.key}
              type="button"
              onClick={() => toggleStato(stato.key)}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                selectedStati.includes(stato.key)
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-900'
              }`}
            >
              {stato.label}
            </button>
          ))}
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700 text-sm">
            {selectedFonte.tipo === 'transazioni' ? (
              <TransazioniTable
                rows={rows.filter(isTransazione)}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={setSort}
                loading={loading}
              />
            ) : (
              <FattureTable
                rows={rows.filter(row => !isTransazione(row)) as FatturaRow[]}
                sortBy={sortBy}
                sortDir={sortDir}
                onSort={setSort}
                loading={loading}
              />
            )}
          </table>
        </div>

        {rows.length === 0 && !loading && (
          <div className="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
            Nessuna riga corrisponde ai filtri.
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-700 px-4 py-3 text-sm flex-wrap">
          <TotalsFooter tipo={selectedFonte.tipo} totali={data?.totali} />
          <div className="flex items-center gap-3">
            <span className="text-gray-600 dark:text-gray-300">
              Pagina {page} di {totalPages} · {data?.total || 0} righe
            </span>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => replaceParams({ page: String(page - 1) })}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-gray-600"
            >
              <ChevronLeft className="h-4 w-4" />
              Prec
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => replaceParams({ page: String(page + 1) })}
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 disabled:opacity-40 dark:border-gray-600"
            >
              Succ
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SortButton({
  column,
  label,
  sortBy,
  sortDir,
  onSort,
}: {
  column: string
  label: string
  sortBy: string
  sortDir: SortDir
  onSort: (column: string) => void
}) {
  const active = sortBy === column
  const Icon = !active ? ChevronsUpDown : sortDir === 'asc' ? ChevronUp : ChevronDown
  return (
    <button type="button" onClick={() => onSort(column)} className="inline-flex items-center gap-1 font-semibold">
      {label}
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}

function Th(props: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`sticky top-0 z-10 bg-gray-100 px-3 py-2 text-left text-xs uppercase text-gray-600 dark:bg-gray-900 dark:text-gray-300 ${props.className || ''}`}>
      {props.children}
    </th>
  )
}

function Td(props: { children: React.ReactNode; className?: string; title?: string }) {
  return (
    <td title={props.title} className={`px-3 py-2 align-top text-gray-700 dark:text-gray-200 ${props.className || ''}`}>
      {props.children}
    </td>
  )
}

function TransazioniTable({
  rows,
  sortBy,
  sortDir,
  onSort,
  loading,
}: {
  rows: TransazioneRow[]
  sortBy: string
  sortDir: SortDir
  onSort: (column: string) => void
  loading: boolean
}) {
  return (
    <>
      <thead>
        <tr>
          <Th><SortButton column="data" label="Data" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th><SortButton column="conto" label="Conto" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th><SortButton column="controparte" label="Controparte" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th><SortButton column="descrizione" label="Descrizione" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th className="text-right"><SortButton column="importo" label="Importo" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th><SortButton column="stato" label="Stato" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th>Note</Th>
        </tr>
      </thead>
      <tbody className={`divide-y divide-gray-200 dark:divide-gray-700 ${loading ? 'opacity-50' : ''}`}>
        {rows.map(row => (
          <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
            <Td className="whitespace-nowrap">{formatDate(row.data)}</Td>
            <Td className="whitespace-nowrap">{row.conto}</Td>
            <Td className="min-w-48 max-w-72">{row.controparte || '-'}</Td>
            <Td title={row.descrizione || ''} className="max-w-96 truncate">{row.descrizione || '-'}</Td>
            <Td className={`text-right whitespace-nowrap font-semibold ${row.tipo === 'entrata' ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>
              {formatEuro(row.importo)}
            </Td>
            <Td className="whitespace-nowrap">{statoLabel(row.stato_riconciliazione)}</Td>
            <Td title={row.note || ''} className="max-w-72 truncate">{row.note || '-'}</Td>
          </tr>
        ))}
      </tbody>
    </>
  )
}

function FattureTable({
  rows,
  sortBy,
  sortDir,
  onSort,
  loading,
}: {
  rows: FatturaRow[]
  sortBy: string
  sortDir: SortDir
  onSort: (column: string) => void
  loading: boolean
}) {
  return (
    <>
      <thead>
        <tr>
          <Th><SortButton column="data" label="Data emissione" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th><SortButton column="tipo" label="Tipo" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th><SortButton column="numero" label="Numero" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th><SortButton column="soggetto" label="Soggetto" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th className="text-right"><SortButton column="imponibile" label="Imponibile" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th className="text-right"><SortButton column="imposta" label="Imposta" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th className="text-right"><SortButton column="totale" label="Totale" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th><SortButton column="stato" label="Stato" sortBy={sortBy} sortDir={sortDir} onSort={onSort} /></Th>
          <Th>Riconciliata con</Th>
          <Th>Note</Th>
        </tr>
      </thead>
      <tbody className={`divide-y divide-gray-200 dark:divide-gray-700 ${loading ? 'opacity-50' : ''}`}>
        {rows.map(row => (
          <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
            <Td className="whitespace-nowrap">{formatDate(row.data_emissione)}</Td>
            <Td className="whitespace-nowrap capitalize">{row.tipo}</Td>
            <Td className="whitespace-nowrap">{row.numero || '-'}</Td>
            <Td className="min-w-48 max-w-72">{getSoggetto(row)}</Td>
            <Td className="text-right whitespace-nowrap">{formatEuro(row.imponibile)}</Td>
            <Td className="text-right whitespace-nowrap">{formatEuro(row.imposta)}</Td>
            <Td className="text-right whitespace-nowrap font-semibold">{formatEuro(row.totale)}</Td>
            <Td className="whitespace-nowrap">{statoLabel(row.stato_riconciliazione)}</Td>
            <Td className="whitespace-nowrap">
              {row.transazione_id ? (
                <Link className="text-indigo-600 hover:underline dark:text-indigo-300" href={`/transazioni?id=${row.transazione_id}`}>
                  Transazione
                </Link>
              ) : '-'}
            </Td>
            <Td title={row.note || ''} className="max-w-72 truncate">{row.note || '-'}</Td>
          </tr>
        ))}
      </tbody>
    </>
  )
}

function TotalsFooter({
  tipo,
  totali,
}: {
  tipo: FonteTipo
  totali: ApiResponse['totali'] | undefined
}) {
  if (!totali) {
    return <span className="text-gray-500 dark:text-gray-400">Totali non disponibili</span>
  }

  if (tipo === 'transazioni') {
    return (
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-700 dark:text-gray-200">
        <span>Righe: <strong>{totali.count}</strong></span>
        <span>Entrate: <strong className="text-emerald-600 dark:text-emerald-300">{formatEuro(totali.entrate)}</strong></span>
        <span>Uscite: <strong className="text-red-600 dark:text-red-300">{formatEuro(totali.uscite)}</strong></span>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-gray-700 dark:text-gray-200">
      <span>Righe: <strong>{totali.count}</strong></span>
      <span>Imponibile: <strong>{formatEuro(totali.imponibile)}</strong></span>
      <span>Imposta: <strong>{formatEuro(totali.imposta)}</strong></span>
      <span>Totale: <strong>{formatEuro(totali.totale)}</strong></span>
    </div>
  )
}

export default function ImportTabellePage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500">Carico tabelle import...</div>}>
      <ImportTabelleInner />
    </Suspense>
  )
}
