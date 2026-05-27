'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { ChevronDown, ChevronRight, ExternalLink, Link2, Unlink, Zap, AlertTriangle, ArrowDownLeft, ArrowUpRight, GripVertical } from 'lucide-react'
import Link from 'next/link'

interface Fattura {
  id: string
  numero: string
  tipo: 'emessa' | 'ricevuta' | string
  totale: number
  data: string
  stato: string
  transazione_id?: string
}

interface Transazione {
  id: string
  importo: number
  tipo: 'entrata' | 'uscita' | string
  data: string
  conto: string
  descrizione?: string
  controparte?: string
  stato: string
  fatture_ids?: string[]
}

interface Soggetto {
  denominazione: string
  fatture: Fattura[]
  transazioni: Transazione[]
  totaleFatture: number
  totaleTransazioni: number
  saldo: number
}

interface Orfana {
  id: string
  importo: number
  tipo: 'entrata' | 'uscita' | string
  data: string
  conto: string
  descrizione?: string
  controparte?: string
  stato: string
}

interface SoggettiResponse {
  soggetti: Soggetto[]
  orfane: Orfana[]
}

type DragSource =
  | { kind: 'fattura'; id: string; soggetto: string }
  | { kind: 'transazione'; id: string; soggetto: string }
  | null

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(date: string): string {
  return format(new Date(date), 'dd MMM yyyy', { locale: it })
}

// Badge Attiva (emessa) / Passiva (ricevuta)
function TipoFatturaBadge({ tipo }: { tipo: string }) {
  if (tipo === 'emessa') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" title="Fattura emessa (attiva)">
        <ArrowDownLeft className="h-3 w-3" /> Attiva
      </span>
    )
  }
  if (tipo === 'ricevuta') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" title="Fattura ricevuta (passiva)">
        <ArrowUpRight className="h-3 w-3" /> Passiva
      </span>
    )
  }
  return null
}

export default function SoggettiPage() {
  const [soggetti, setSoggetti] = useState<Soggetto[]>([])
  const [orfane, setOrfane] = useState<Orfana[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [soloNonRiconciliati, setSoloNonRiconciliati] = useState(false)
  const [highlightFattura, setHighlightFattura] = useState<string | null>(null)
  const [highlightTransazione, setHighlightTransazione] = useState<string | null>(null)

  // Drag & drop state
  const dragSource = useRef<DragSource>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  // Auto-match feedback
  const [autoMatching, setAutoMatching] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [orfaneOpen, setOrfaneOpen] = useState(true)

  function showFeedback(kind: 'ok' | 'err', text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/soggetti')
      const data: SoggettiResponse = await res.json()
      setSoggetti(data.soggetti || [])
      setOrfane(data.orfane || [])
    } catch (e) {
      console.error(e)
      showFeedback('err', 'Errore nel caricamento')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggleExpand = (denom: string) => {
    const newExpanded = new Set(expanded)
    if (newExpanded.has(denom)) {
      newExpanded.delete(denom)
    } else {
      newExpanded.add(denom)
    }
    setExpanded(newExpanded)
    if (!newExpanded.has(denom)) {
      setHighlightFattura(null)
      setHighlightTransazione(null)
    }
  }

  const handleFatturaClick = (fattura: Fattura, transazioni: Transazione[]) => {
    const linkedTrans = transazioni.find(t => t.fatture_ids?.includes(fattura.id))
    if (linkedTrans) {
      setHighlightTransazione(linkedTrans.id)
      setHighlightFattura(fattura.id)
      setTimeout(() => {
        setHighlightTransazione(null)
        setHighlightFattura(null)
      }, 3000)
    }
  }

  const handleTransazioneClick = (transazione: Transazione) => {
    if (transazione.fatture_ids && transazione.fatture_ids.length > 0) {
      setHighlightFattura(transazione.fatture_ids[0])
      setHighlightTransazione(transazione.id)
      setTimeout(() => {
        setHighlightFattura(null)
        setHighlightTransazione(null)
      }, 3000)
    }
  }

  // ---- Drag & Drop handlers ----
  const onDragStart = (src: NonNullable<DragSource>, e: React.DragEvent) => {
    dragSource.current = src
    e.dataTransfer.effectAllowed = 'link'
    e.dataTransfer.setData('text/plain', `${src.kind}:${src.id}`)
  }

  const onDragEnd = () => {
    dragSource.current = null
    setDropTargetId(null)
  }

  // Validate that a drop is acceptable
  function canDrop(src: NonNullable<DragSource>, target: NonNullable<DragSource>): { ok: boolean; reason?: string } {
    if (src.kind === target.kind) {
      return { ok: false, reason: 'Trascina una fattura su una transazione (o viceversa)' }
    }
    if (src.soggetto !== target.soggetto) {
      return { ok: false, reason: 'Soggetto diverso: non si può abbinare' }
    }
    return { ok: true }
  }

  const onDragOver = (target: NonNullable<DragSource>, e: React.DragEvent) => {
    const src = dragSource.current
    if (!src) return
    const ok = canDrop(src, target).ok
    if (ok) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'link'
      setDropTargetId(target.id)
    }
  }

  const onDragLeave = (target: NonNullable<DragSource>) => {
    if (dropTargetId === target.id) setDropTargetId(null)
  }

  const onDrop = async (target: NonNullable<DragSource>, e: React.DragEvent) => {
    e.preventDefault()
    const src = dragSource.current
    setDropTargetId(null)
    dragSource.current = null
    if (!src) return

    const check = canDrop(src, target)
    if (!check.ok) {
      showFeedback('err', check.reason || 'Operazione non valida')
      return
    }

    const fatturaId = src.kind === 'fattura' ? src.id : target.id
    const transazioneId = src.kind === 'transazione' ? src.id : target.id

    try {
      const res = await fetch('/api/riconcilia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fatturaId, transazioneId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', 'Match creato')
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore nel match'
      showFeedback('err', msg)
    }
  }

  async function handleUnmatch(fatturaId: string) {
    if (!confirm('Vuoi davvero scollegare questa fattura dalla transazione?')) return
    try {
      const res = await fetch(`/api/riconcilia?fatturaId=${fatturaId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', 'Match rimosso')
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore'
      showFeedback('err', msg)
    }
  }

  async function handleAutoMatch() {
    setAutoMatching(true)
    try {
      const res = await fetch('/api/riconcilia/auto', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', `Match automatici: ${data.matched || 0}`)
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore'
      showFeedback('err', msg)
    } finally {
      setAutoMatching(false)
    }
  }

  async function handleAssignSoggetto(transazioneId: string, soggetto: string) {
    try {
      const res = await fetch('/api/transazioni/assign-soggetto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transazione_id: transazioneId, soggetto }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', `Transazione assegnata a "${soggetto}"`)
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore'
      showFeedback('err', msg)
    }
  }

  const filteredSoggetti = useMemo(() => soggetti.filter(s => {
    if (search && !s.denominazione.toLowerCase().includes(search.toLowerCase())) {
      return false
    }
    if (soloNonRiconciliati) {
      const hasNonRiconciliato =
        s.fatture.some(f => f.stato !== 'riconciliata') ||
        s.transazioni.some(t => t.stato !== 'riconciliata')
      if (!hasNonRiconciliato) return false
    }
    return true
  }), [soggetti, search, soloNonRiconciliati])

  const soggettiDenoms = useMemo(
    () => soggetti.map(s => s.denominazione).sort((a, b) => a.localeCompare(b)),
    [soggetti]
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Vista per Soggetto</h1>
        <button
          onClick={handleAutoMatch}
          disabled={autoMatching || loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-md shadow-sm"
        >
          <Zap className="h-4 w-4" />
          {autoMatching ? 'Match in corso...' : 'Match automatici'}
        </button>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div className={`mb-4 px-4 py-2 rounded-md text-sm font-medium ${
          feedback.kind === 'ok'
            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* Search & Filter */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6 flex gap-4 items-center flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca soggetto..."
          className="flex-1 border rounded-md px-4 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white min-w-[200px]"
        />
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={soloNonRiconciliati}
            onChange={(e) => setSoloNonRiconciliati(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Solo con non riconciliati</span>
        </label>
      </div>

      {/* Help banner */}
      <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-md px-4 py-3 mb-4 text-sm text-indigo-900 dark:text-indigo-100">
        <strong>Suggerimento:</strong> trascina una fattura su una transazione (o viceversa) all&apos;interno dello stesso soggetto per crearne il match. Le transazioni senza soggetto vanno prima assegnate dalla sezione qui sotto.
      </div>

      {/* Orfane section */}
      {orfane.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6 border-l-4 border-amber-500">
          <button
            onClick={() => setOrfaneOpen(o => !o)}
            className="w-full px-6 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <div className="flex items-center gap-3">
              {orfaneOpen ? <ChevronDown className="h-5 w-5 text-amber-500" /> : <ChevronRight className="h-5 w-5 text-amber-500" />}
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div className="text-left">
                <p className="font-semibold text-gray-900 dark:text-white">
                  Transazioni senza soggetto ({orfane.length})
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Assegna un soggetto per poter poi creare il match con una fattura
                </p>
              </div>
            </div>
          </button>
          {orfaneOpen && (
            <div className="border-t dark:border-gray-700 px-6 py-4 space-y-2 max-h-96 overflow-y-auto">
              {orfane.map(o => (
                <div key={o.id} className="flex flex-wrap items-center gap-3 text-sm bg-gray-50 dark:bg-gray-900 rounded px-3 py-2">
                  <span className="font-medium capitalize text-gray-900 dark:text-white">{o.conto}</span>
                  <span className="text-gray-500 dark:text-gray-400">{formatDate(o.data)}</span>
                  <span className={`font-medium ${o.tipo === 'entrata' ? 'text-green-600' : 'text-red-600'}`}>
                    {o.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(o.importo))}
                  </span>
                  <span className="text-gray-600 dark:text-gray-300 truncate max-w-xs" title={o.controparte || o.descrizione}>
                    {o.controparte || o.descrizione || <em className="text-gray-400">nessuna descrizione</em>}
                  </span>
                  <div className="flex items-center gap-2 ml-auto">
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const val = e.target.value
                        if (val) handleAssignSoggetto(o.id, val)
                        e.currentTarget.value = ''
                      }}
                      className="text-xs border rounded px-2 py-1 dark:bg-gray-800 dark:border-gray-600 dark:text-white max-w-[220px]"
                    >
                      <option value="">Assegna a soggetto…</option>
                      {soggettiDenoms.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <Link href={`/transazioni?id=${o.id}`}>
                      <ExternalLink className="h-3 w-3 text-gray-400 hover:text-indigo-600" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSoggetti.map((soggetto) => (
            <div key={soggetto.denominazione} className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              {/* Header row - clickable */}
              <div
                className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => toggleExpand(soggetto.denominazione)}
              >
                <div className="flex items-center gap-3">
                  {expanded.has(soggetto.denominazione) ? (
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  )}
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">{soggetto.denominazione}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {soggetto.fatture.length} fatture · {soggetto.transazioni.length} transazioni
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex gap-6">
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Fatture</p>
                      <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(soggetto.totaleFatture)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Transazioni</p>
                      <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(soggetto.totaleTransazioni)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase">Saldo</p>
                      <p className={`font-bold ${soggetto.saldo >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(soggetto.saldo)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded details */}
              {expanded.has(soggetto.denominazione) && (
                <div className="border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-6 py-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Fatture */}
                    <div>
                      <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Fatture</h4>
                      <div className="space-y-1 max-h-80 overflow-y-auto">
                        {soggetto.fatture.length === 0 ? (
                          <p className="text-sm text-gray-400">Nessuna fattura</p>
                        ) : (
                          soggetto.fatture.map((f) => {
                            const isLinked = soggetto.transazioni.some(t => t.fatture_ids?.includes(f.id))
                            const isHighlighted = highlightFattura === f.id
                            const isDropTarget = dropTargetId === f.id
                            const draggable = !isLinked
                            return (
                              <div
                                key={f.id}
                                draggable={draggable}
                                onDragStart={(e) => draggable && onDragStart({ kind: 'fattura', id: f.id, soggetto: soggetto.denominazione }, e)}
                                onDragEnd={onDragEnd}
                                onDragOver={(e) => onDragOver({ kind: 'fattura', id: f.id, soggetto: soggetto.denominazione }, e)}
                                onDragLeave={() => onDragLeave({ kind: 'fattura', id: f.id, soggetto: soggetto.denominazione })}
                                onDrop={(e) => onDrop({ kind: 'fattura', id: f.id, soggetto: soggetto.denominazione }, e)}
                                className={`flex justify-between items-center text-sm rounded px-3 py-2 transition group ${
                                  isDropTarget
                                    ? 'bg-indigo-100 dark:bg-indigo-900 ring-2 ring-indigo-500'
                                    : isHighlighted
                                    ? 'bg-yellow-200 dark:bg-yellow-900 ring-2 ring-yellow-400'
                                    : 'bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-gray-700'
                                } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {draggable && (
                                    <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />
                                  )}
                                  {isLinked && (
                                    <button
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleFatturaClick(f, soggetto.transazioni) }}
                                      className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400"
                                      title="Mostra transazione collegata"
                                    >
                                      <Link2 className="h-4 w-4" />
                                    </button>
                                  )}
                                  <TipoFatturaBadge tipo={f.tipo} />
                                  <Link
                                    href={`/fatture?id=${f.id}`}
                                    className="font-medium hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400 truncate"
                                  >
                                    {f.numero}
                                  </Link>
                                  <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(f.data)}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className={`px-1.5 py-0.5 text-xs rounded ${
                                    f.stato === 'riconciliata' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                                    f.stato === 'da_riconciliare' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                                    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                  }`}>{f.stato.replace('_', ' ')}</span>
                                  <span className="font-medium text-gray-900 dark:text-white whitespace-nowrap">{formatCurrency(f.totale)}</span>
                                  {isLinked && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleUnmatch(f.id) }}
                                      className="text-gray-400 hover:text-red-600"
                                      title="Scollega"
                                    >
                                      <Unlink className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>

                    {/* Transazioni */}
                    <div>
                      <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Transazioni</h4>
                      <div className="space-y-1 max-h-80 overflow-y-auto">
                        {soggetto.transazioni.length === 0 ? (
                          <p className="text-sm text-gray-400">Nessuna transazione</p>
                        ) : (
                          soggetto.transazioni.map((t) => {
                            const isLinked = !!(t.fatture_ids && t.fatture_ids.length > 0)
                            const isHighlighted = highlightTransazione === t.id
                            const isDropTarget = dropTargetId === t.id
                            const draggable = !isLinked
                            return (
                              <div
                                key={t.id}
                                draggable={draggable}
                                onDragStart={(e) => draggable && onDragStart({ kind: 'transazione', id: t.id, soggetto: soggetto.denominazione }, e)}
                                onDragEnd={onDragEnd}
                                onDragOver={(e) => onDragOver({ kind: 'transazione', id: t.id, soggetto: soggetto.denominazione }, e)}
                                onDragLeave={() => onDragLeave({ kind: 'transazione', id: t.id, soggetto: soggetto.denominazione })}
                                onDrop={(e) => onDrop({ kind: 'transazione', id: t.id, soggetto: soggetto.denominazione }, e)}
                                className={`flex justify-between items-center text-sm rounded px-3 py-2 transition group ${
                                  isDropTarget
                                    ? 'bg-indigo-100 dark:bg-indigo-900 ring-2 ring-indigo-500'
                                    : isHighlighted
                                    ? 'bg-yellow-200 dark:bg-yellow-900 ring-2 ring-yellow-400'
                                    : 'bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-gray-700'
                                } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {draggable && (
                                    <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />
                                  )}
                                  {isLinked && (
                                    <button
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleTransazioneClick(t) }}
                                      className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400"
                                      title="Mostra fattura collegata"
                                    >
                                      <Link2 className="h-4 w-4" />
                                    </button>
                                  )}
                                  <Link
                                    href={`/transazioni?id=${t.id}`}
                                    className="font-medium capitalize hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400 whitespace-nowrap"
                                  >
                                    {t.conto}
                                  </Link>
                                  <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(t.data)}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className={`px-1.5 py-0.5 text-xs rounded ${
                                    t.stato === 'riconciliata' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                                    t.stato === 'da_riconciliare' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                                    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                  }`}>{t.stato.replace('_', ' ')}</span>
                                  <span className={`font-medium whitespace-nowrap ${t.tipo === 'entrata' ? 'text-green-600' : 'text-red-600'}`}>
                                    {t.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(t.importo))}
                                  </span>
                                  {isLinked && t.fatture_ids && t.fatture_ids[0] && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleUnmatch(t.fatture_ids![0]) }}
                                      className="text-gray-400 hover:text-red-600"
                                      title="Scollega"
                                    >
                                      <Unlink className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {filteredSoggetti.length === 0 && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              Nessun soggetto trovato
            </div>
          )}
        </div>
      )}
    </div>
  )
}
