'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useMemo, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Calendar, Check, ChevronRight, Wand2, ArrowRight, RefreshCw, AlertTriangle,
  Banknote, Receipt, Zap, Globe, ClipboardCheck,
} from 'lucide-react'
import {
  parsePeriodo, formatPeriodoSlug, defaultPeriodoSlug, PeriodoTipo, MESI_LABELS,
} from '@/lib/periodo'

const STEPS = [
  { id: 0, label: 'Periodo', icon: Calendar, desc: 'Scegli il periodo di lavoro' },
  { id: 1, label: 'Movimenti bancari', icon: Banknote, desc: 'Carica gli estratti conto' },
  { id: 2, label: 'Fatture italiane', icon: Receipt, desc: 'Importa SDI emesse/ricevute' },
  { id: 3, label: 'Auto-match', icon: Zap, desc: 'Abbina trans ↔ fatture' },
  { id: 4, label: 'Classificazione', icon: AlertTriangle, desc: 'Decidi le trans scoperte' },
  { id: 5, label: 'Fatture estere', icon: Globe, desc: 'Carica le fatture mancanti' },
  { id: 6, label: 'Riepilogo', icon: ClipboardCheck, desc: 'KPI ed export del periodo' },
] as const

interface PeriodoRow {
  id: string
  tipo: 'annuale' | 'trimestrale' | 'mensile'
  anno: number
  trimestre: number | null
  mese: number | null
  step_corrente: number
  completato: boolean
  trans_estere_queue: string[]
  updated_at: string
}

interface ContoDettaglio {
  conto: string
  label: string
  hasParser: boolean
  count: number
  entrate: number
  uscite: number
  firstDate: string | null
  lastDate: string | null
  maxGapDays: number
  presentNelDb: boolean
}

interface WizardStats {
  periodo: { from: string; to: string }
  trans: {
    totale: number
    perConto: Record<string, { count: number; entrate: number; uscite: number }>
    contiDettaglio?: ContoDettaglio[]
    contiAltri?: string[]
    scoperte: number
    scoperteImporto: number
    riconciliate: number
  }
  fatture: {
    totale: number
    emesse: number
    emesseTotale?: number
    emesseFirstDate?: string | null
    emesseLastDate?: string | null
    emesseMaxGap?: number
    ricevute: number
    ricevuteTotale?: number
    ricevuteFirstDate?: string | null
    ricevuteLastDate?: string | null
    ricevuteMaxGap?: number
    estere: number
    riconciliate: number
    scoperte: number
  }
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function WizardInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Il wizard riusa lo stesso ?periodo= del PeriodoPicker globale.
  // Se non c'è ancora, parte da defaultPeriodoSlug (anno corrente).
  const periodo = useMemo(
    () => parsePeriodo(searchParams.get('periodo') || defaultPeriodoSlug()),
    [searchParams],
  )

  const [row, setRow] = useState<PeriodoRow | null>(null)
  const [stats, setStats] = useState<WizardStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  function showFeedback(kind: 'ok' | 'err', text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 4000)
  }

  // Mappa periodo (slug) → coord per le API wizard
  const coord = useMemo(() => {
    if (periodo.tipo === 'tutto') return null
    return {
      tipo:
        periodo.tipo === 'anno'
          ? 'annuale'
          : periodo.tipo === 'trimestre'
            ? 'trimestrale'
            : 'mensile',
      anno: periodo.anno,
      trimestre: periodo.trimestre ?? null,
      mese: periodo.mese ?? null,
    }
  }, [periodo])

  // Carica row wizard_periodi (se esiste) per il periodo attivo
  const reloadRow = useCallback(async () => {
    if (!coord) {
      setRow(null)
      return
    }
    const params = new URLSearchParams({
      tipo: coord.tipo,
      anno: String(coord.anno),
    })
    if (coord.trimestre != null) params.set('trimestre', String(coord.trimestre))
    if (coord.mese != null) params.set('mese', String(coord.mese))
    try {
      const res = await fetch(`/api/wizard/periodo?${params.toString()}`)
      if (res.status === 404) {
        setRow(null)
        return
      }
      const data = await res.json()
      setRow(data.periodo)
    } catch (e) {
      console.error(e)
    }
  }, [coord])

  // Carica stats periodo (per riempire i tile degli step)
  const reloadStats = useCallback(async () => {
    if (!periodo.from || !periodo.to) {
      setStats(null)
      return
    }
    try {
      const res = await fetch(`/api/wizard/stats?from=${periodo.from}&to=${periodo.to}`)
      const data = await res.json()
      setStats(data)
    } catch (e) {
      console.error(e)
    }
  }, [periodo.from, periodo.to])

  useEffect(() => {
    reloadRow()
    reloadStats()
  }, [reloadRow, reloadStats])

  async function apriPeriodo() {
    if (!coord) {
      showFeedback('err', 'Seleziona un periodo valido (non "Tutto")')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/wizard/periodo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coord),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      setRow(data.periodo)
      showFeedback('ok', data.created ? 'Periodo aperto' : 'Periodo ripreso')
    } catch (e: unknown) {
      showFeedback('err', e instanceof Error ? e.message : 'Errore')
    } finally {
      setLoading(false)
    }
  }

  async function setStep(n: number) {
    if (!row) return
    setLoading(true)
    try {
      const res = await fetch('/api/wizard/periodo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, step_corrente: n, completato: n >= STEPS.length - 1 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      setRow(data.periodo)
    } catch (e: unknown) {
      showFeedback('err', e instanceof Error ? e.message : 'Errore')
    } finally {
      setLoading(false)
    }
  }

  async function lanciaAutoMatch() {
    if (!periodo.from || !periodo.to) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/riconcilia/auto?from=${periodo.from}&to=${periodo.to}`,
        { method: 'POST' },
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', `Match automatici: ${data.matched || 0}`)
      await reloadStats()
    } catch (e: unknown) {
      showFeedback('err', e instanceof Error ? e.message : 'Errore')
    } finally {
      setLoading(false)
    }
  }

  // Helper per cambiare periodo dal picker built-in
  function changePeriodo(newSlug: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('periodo', newSlug)
    router.push(`/wizard?${params.toString()}`)
  }

  const annoCorrente = new Date().getFullYear()
  const anni: number[] = []
  for (let y = annoCorrente + 1; y >= annoCorrente - 5; y--) anni.push(y)

  const stepCorrente = row?.step_corrente ?? 0

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Wand2 className="h-7 w-7 text-indigo-600" /> Wizard riconciliazione
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Procedura guidata periodo per periodo. Lo stato è salvato: puoi chiudere e riprendere.
          </p>
        </div>
        <Link
          href={`/soggetti?${searchParams.toString()}`}
          className="text-sm text-indigo-600 hover:underline inline-flex items-center gap-1"
        >
          Vai a Soggetti <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {feedback && (
        <div
          className={`mb-4 px-4 py-2 rounded-md text-sm font-medium ${
            feedback.kind === 'ok'
              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Sidebar verticale: indicatore step */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <aside className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 self-start">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
            Passi del wizard
          </h3>
          <ol className="space-y-1">
            {STEPS.map(s => {
              const isCurrent = s.id === stepCorrente
              const isDone = row && s.id < stepCorrente
              const isReachable = !!row || s.id === 0
              return (
                <li key={s.id}>
                  <button
                    onClick={() => row && setStep(s.id)}
                    disabled={!isReachable}
                    className={`w-full text-left px-3 py-2 rounded flex items-center gap-2 text-sm ${
                      isCurrent
                        ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-900 dark:text-indigo-100 font-semibold'
                        : isDone
                          ? 'text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed'
                    }`}
                  >
                    <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      isDone
                        ? 'bg-emerald-500 text-white'
                        : isCurrent
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                    }`}>
                      {isDone ? <Check className="h-3.5 w-3.5" /> : s.id}
                    </span>
                    <s.icon className="h-4 w-4 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="truncate">{s.label}</div>
                      <div className="text-[10px] opacity-70 truncate">{s.desc}</div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ol>
        </aside>

        <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 min-h-[400px]">
          {/* STEP 0 — Scelta periodo */}
          {stepCorrente === 0 && (
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                Step 0 — Scegli il periodo
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                Scegli su quale finestra temporale vuoi lavorare. Il periodo è quello globale
                dell&apos;app (vedi anche la barra in alto).
              </p>

              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-w-2xl">
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Tipo</label>
                    <select
                      value={periodo.tipo}
                      onChange={e => {
                        const t = e.target.value as PeriodoTipo
                        if (t === 'tutto') return changePeriodo('tutto')
                        if (t === 'anno') return changePeriodo(formatPeriodoSlug({ tipo: 'anno', anno: periodo.anno || annoCorrente }))
                        if (t === 'trimestre') return changePeriodo(formatPeriodoSlug({ tipo: 'trimestre', anno: periodo.anno || annoCorrente, trimestre: periodo.trimestre || 1 }))
                        if (t === 'mese') return changePeriodo(formatPeriodoSlug({ tipo: 'mese', anno: periodo.anno || annoCorrente, mese: periodo.mese || 1 }))
                      }}
                      className="mt-1 w-full border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    >
                      <option value="anno">Annuale</option>
                      <option value="trimestre">Trimestrale</option>
                      <option value="mese">Mensile</option>
                    </select>
                  </div>
                  {periodo.tipo !== 'tutto' && (
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Anno</label>
                      <select
                        value={periodo.anno}
                        onChange={e => changePeriodo(formatPeriodoSlug({
                          tipo: periodo.tipo,
                          anno: parseInt(e.target.value),
                          trimestre: periodo.trimestre,
                          mese: periodo.mese,
                        }))}
                        className="mt-1 w-full border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      >
                        {anni.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                  )}
                  {periodo.tipo === 'trimestre' && (
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Trimestre</label>
                      <select
                        value={periodo.trimestre}
                        onChange={e => changePeriodo(formatPeriodoSlug({ tipo: 'trimestre', anno: periodo.anno, trimestre: parseInt(e.target.value) }))}
                        className="mt-1 w-full border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      >
                        <option value={1}>Q1 (gen-mar)</option>
                        <option value={2}>Q2 (apr-giu)</option>
                        <option value={3}>Q3 (lug-set)</option>
                        <option value={4}>Q4 (ott-dic)</option>
                      </select>
                    </div>
                  )}
                  {periodo.tipo === 'mese' && (
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Mese</label>
                      <select
                        value={periodo.mese}
                        onChange={e => changePeriodo(formatPeriodoSlug({ tipo: 'mese', anno: periodo.anno, mese: parseInt(e.target.value) }))}
                        className="mt-1 w-full border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                      >
                        {MESI_LABELS.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                      </select>
                    </div>
                  )}
                </div>

                <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded p-3 text-sm">
                  Periodo selezionato: <strong>{periodo.label}</strong>
                  {periodo.from && periodo.to && (
                    <span className="ml-2 text-gray-600 dark:text-gray-400">({periodo.from} → {periodo.to})</span>
                  )}
                </div>

                {/* Stato della riga wizard_periodi */}
                {row ? (
                  <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-700 rounded p-4">
                    <p className="font-semibold text-emerald-900 dark:text-emerald-100">
                      ✓ Periodo aperto — Step corrente: {row.step_corrente} {row.completato && '(completato)'}
                    </p>
                    <p className="text-xs text-emerald-800 dark:text-emerald-200 mt-1">
                      Aggiornato: {new Date(row.updated_at).toLocaleString('it-IT')}
                    </p>
                    <button
                      onClick={() => setStep(Math.min(row.step_corrente + 1, STEPS.length - 1))}
                      disabled={loading}
                      className="mt-3 inline-flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded"
                    >
                      Vai allo Step {Math.min(row.step_corrente + 1, STEPS.length - 1)} <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="bg-yellow-50 dark:bg-yellow-950 border border-yellow-300 dark:border-yellow-700 rounded p-4">
                    <p className="text-sm text-yellow-900 dark:text-yellow-100">
                      Per iniziare apri il periodo (verrà creata una riga di avanzamento in DB).
                    </p>
                    <button
                      onClick={apriPeriodo}
                      disabled={loading || !coord}
                      className="mt-3 inline-flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded"
                    >
                      Apri periodo <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 1 — Movimenti bancari */}
          {stepCorrente === 1 && (
            <StepMovimentiBancari
              periodo={periodo}
              stats={stats}
              onNext={() => setStep(2)}
            />
          )}

          {/* STEP 2 — Fatture italiane */}
          {stepCorrente === 2 && (
            <StepFattureIT periodo={periodo} stats={stats} onNext={() => setStep(3)} onBack={() => setStep(1)} />
          )}

          {/* STEP 3 — Auto-match */}
          {stepCorrente === 3 && (
            <StepAutoMatch
              periodo={periodo}
              stats={stats}
              loading={loading}
              onAutoMatch={lanciaAutoMatch}
              onNext={() => setStep(4)}
              onBack={() => setStep(2)}
            />
          )}

          {/* STEP 4 — Classificazione */}
          {stepCorrente === 4 && row && (
            <StepClassificazione
              periodo={periodo}
              row={row}
              onReloadRow={reloadRow}
              onReloadStats={reloadStats}
              onNext={() => setStep(5)}
              onBack={() => setStep(3)}
              showFeedback={showFeedback}
            />
          )}

          {/* STEP 5 — Carica fatture estere */}
          {stepCorrente === 5 && row && (
            <StepFattureEstere
              row={row}
              onReloadRow={reloadRow}
              onReloadStats={reloadStats}
              onNext={() => setStep(6)}
              onBack={() => setStep(4)}
              showFeedback={showFeedback}
            />
          )}

          {/* STEP 6 — Riepilogo */}
          {stepCorrente === 6 && (
            <StepRiepilogo periodo={periodo} stats={stats} onBack={() => setStep(5)} />
          )}
        </section>
      </div>
    </div>
  )
}

// ---- Step components (parte 1 wizard, gli altri saranno espansi) ----

// Soglia gap massimo accettabile (giorni) dentro il periodo per ogni conto.
// Sopra questa soglia mostro un warning giallo.
const GAP_WARN_DAYS = 14

type TileStatus = 'empty' | 'partial' | 'ok' | 'no-parser'

function getTileStatus(c: ContoDettaglio): TileStatus {
  if (c.count === 0) return 'empty'
  if (c.maxGapDays > GAP_WARN_DAYS) return 'partial'
  return 'ok'
}

function StepMovimentiBancari({
  periodo, stats, onNext,
}: { periodo: ReturnType<typeof parsePeriodo>; stats: WizardStats | null; onNext: () => void }) {
  const conti = stats?.trans.contiDettaglio || []
  const nEmpty = conti.filter(c => c.count === 0).length
  const nPartial = conti.filter(c => c.count > 0 && c.maxGapDays > GAP_WARN_DAYS).length

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Step 1 — Movimenti bancari del periodo</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Una tile per ogni conto. Verifico che per <strong>{periodo.label}</strong> ci sia tutto.
        Verde = ok, giallo = possibile gap di {GAP_WARN_DAYS}+ giorni senza movimenti, rosso = mancano i dati.
      </p>

      {/* Banner riassuntivo */}
      {(nEmpty > 0 || nPartial > 0) && (
        <div className={`mb-4 px-4 py-2 rounded text-sm border ${
          nEmpty > 0
            ? 'bg-red-50 dark:bg-red-950 border-red-300 text-red-900 dark:text-red-100'
            : 'bg-amber-50 dark:bg-amber-950 border-amber-300 text-amber-900 dark:text-amber-100'
        }`}>
          {nEmpty > 0 && <><strong>{nEmpty} conti senza movimenti</strong>{' '}</>}
          {nPartial > 0 && <><strong>{nPartial} con possibili gap</strong></>}
          {' — '}controlla di aver caricato tutto prima di procedere.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {conti.map(c => (
          <ContoTile key={c.conto} c={c} periodo={periodo} />
        ))}
        {conti.length === 0 && (
          <p className="text-sm text-gray-500 col-span-full text-center py-4">
            Carico…
          </p>
        )}
      </div>

      <div className="flex justify-between items-center">
        <Link href="/import" className="text-sm text-indigo-600 hover:underline">
          Apri /import →
        </Link>
        <button
          onClick={onNext}
          className={`px-4 py-2 rounded text-white text-sm font-medium inline-flex items-center gap-1 ${
            nEmpty > 0
              ? 'bg-amber-600 hover:bg-amber-700'
              : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {nEmpty > 0 && <AlertTriangle className="h-4 w-4" />}
          Avanti <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function ContoTile({ c, periodo }: { c: ContoDettaglio; periodo: ReturnType<typeof parsePeriodo> }) {
  const status = getTileStatus(c)
  const styles = {
    empty: 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950',
    partial: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950',
    ok: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950',
    'no-parser': 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900',
  }[status]
  const badge = {
    empty: { label: 'MANCA', cls: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100' },
    partial: { label: 'GAP', cls: 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100' },
    ok: { label: '✓ OK', cls: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100' },
    'no-parser': { label: '—', cls: 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100' },
  }[status]

  // Per PayPal il parser esiste → link diretto a /import?type=paypal
  // Per gli altri non c'è il parser → link generico a /import con nota
  const importLink = c.conto === 'paypal' ? '/import?type=paypal' : '/import'

  return (
    <div className={`border-2 rounded-lg p-4 ${styles}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Banknote className="h-5 w-5 opacity-70" />
          <h3 className="font-bold text-base">{c.label}</h3>
        </div>
        <span className={`text-[10px] font-bold uppercase rounded px-2 py-0.5 ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      <p className="text-2xl font-bold mt-1">
        {c.count}
        <span className="text-xs font-normal opacity-70 ml-1">movimenti</span>
      </p>
      {c.count > 0 && (
        <>
          <p className="text-[11px] mt-2 opacity-80">
            <span className="text-green-700 dark:text-green-400">↗ +{formatCurrency(c.entrate)}</span>{' '}
            <span className="text-red-700 dark:text-red-400">↘ −{formatCurrency(c.uscite)}</span>
          </p>
          <p className="text-[11px] mt-1 opacity-80">
            Dal {c.firstDate ? new Date(c.firstDate).toLocaleDateString('it-IT') : '—'}
            {' al '}
            {c.lastDate ? new Date(c.lastDate).toLocaleDateString('it-IT') : '—'}
          </p>
          {c.maxGapDays > GAP_WARN_DAYS && (
            <p className="text-[11px] mt-1 text-amber-700 dark:text-amber-300 font-semibold">
              ⚠ Gap massimo {c.maxGapDays} giorni
            </p>
          )}
        </>
      )}
      {c.count === 0 && (
        <p className="text-xs mt-2 italic opacity-80">
          Nessun movimento per {periodo.label}.
          {c.hasParser
            ? ' Vai a /import per caricare il CSV.'
            : ' Parser non disponibile — caricali come fai di solito, poi torna qui.'}
        </p>
      )}
      <Link
        href={importLink}
        className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Apri /import →
      </Link>
    </div>
  )
}

function StepFattureIT({
  periodo, stats, onNext, onBack,
}: { periodo: ReturnType<typeof parsePeriodo>; stats: WizardStats | null; onNext: () => void; onBack: () => void }) {
  const emesseCount = stats?.fatture.emesse ?? 0
  const ricevuteCount = stats?.fatture.ricevute ?? 0
  const emesseGap = stats?.fatture.emesseMaxGap ?? 0
  const ricevuteGap = stats?.fatture.ricevuteMaxGap ?? 0

  const emesseStatus = emesseCount === 0 ? 'empty' : emesseGap > GAP_WARN_DAYS * 2 ? 'partial' : 'ok'
  const ricevuteStatus = ricevuteCount === 0 ? 'empty' : ricevuteGap > GAP_WARN_DAYS * 2 ? 'partial' : 'ok'
  const nEmpty = (emesseCount === 0 ? 1 : 0) + (ricevuteCount === 0 ? 1 : 0)

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Step 2 — Fatture italiane SDI</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Verifico che per <strong>{periodo.label}</strong> ci siano sia le fatture emesse (clienti) sia le ricevute (fornitori).
      </p>

      {nEmpty > 0 && (
        <div className="mb-4 px-4 py-2 rounded text-sm border bg-red-50 dark:bg-red-950 border-red-300 text-red-900 dark:text-red-100">
          <strong>{nEmpty} tipi di fattura mancano</strong> per il periodo. Scarica il CSV dal SDI e caricalo via /import.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <FatturaTile
          title="Fatture emesse"
          subtitle="Attive — clienti / ricavi"
          count={emesseCount}
          totale={stats?.fatture.emesseTotale}
          firstDate={stats?.fatture.emesseFirstDate}
          lastDate={stats?.fatture.emesseLastDate}
          maxGap={emesseGap}
          status={emesseStatus}
          importLink="/import?type=fatture_emesse"
          periodo={periodo}
        />
        <FatturaTile
          title="Fatture ricevute"
          subtitle="Passive — fornitori / costi"
          count={ricevuteCount}
          totale={stats?.fatture.ricevuteTotale}
          firstDate={stats?.fatture.ricevuteFirstDate}
          lastDate={stats?.fatture.ricevuteLastDate}
          maxGap={ricevuteGap}
          status={ricevuteStatus}
          importLink="/import?type=fatture_ricevute"
          periodo={periodo}
        />
      </div>

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 rounded bg-gray-100 dark:bg-gray-700 text-sm font-medium">Indietro</button>
        <button
          onClick={onNext}
          className={`px-4 py-2 rounded text-white text-sm font-medium inline-flex items-center gap-1 ${
            nEmpty > 0 ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {nEmpty > 0 && <AlertTriangle className="h-4 w-4" />}
          Avanti <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function FatturaTile({
  title, subtitle, count, totale, firstDate, lastDate, maxGap, status, importLink, periodo,
}: {
  title: string
  subtitle: string
  count: number
  totale?: number
  firstDate?: string | null
  lastDate?: string | null
  maxGap?: number
  status: 'empty' | 'partial' | 'ok'
  importLink: string
  periodo: ReturnType<typeof parsePeriodo>
}) {
  const styles = {
    empty: 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950',
    partial: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950',
    ok: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950',
  }[status]
  const badge = {
    empty: { label: 'MANCA', cls: 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100' },
    partial: { label: 'GAP', cls: 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100' },
    ok: { label: '✓ OK', cls: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100' },
  }[status]

  return (
    <div className={`border-2 rounded-lg p-4 ${styles}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="font-bold text-base">{title}</h3>
          <p className="text-xs opacity-70">{subtitle}</p>
        </div>
        <span className={`text-[10px] font-bold uppercase rounded px-2 py-0.5 ${badge.cls}`}>
          {badge.label}
        </span>
      </div>
      <p className="text-2xl font-bold mt-1">
        {count}
        <span className="text-xs font-normal opacity-70 ml-1">fatture</span>
      </p>
      {count > 0 && (
        <>
          {typeof totale === 'number' && (
            <p className="text-[11px] mt-2 opacity-80">
              Totale {formatCurrency(totale)}
            </p>
          )}
          <p className="text-[11px] mt-1 opacity-80">
            Dal {firstDate ? new Date(firstDate).toLocaleDateString('it-IT') : '—'}
            {' al '}
            {lastDate ? new Date(lastDate).toLocaleDateString('it-IT') : '—'}
          </p>
          {typeof maxGap === 'number' && maxGap > GAP_WARN_DAYS * 2 && (
            <p className="text-[11px] mt-1 text-amber-700 dark:text-amber-300 font-semibold">
              ⚠ Gap massimo {maxGap} giorni
            </p>
          )}
        </>
      )}
      {count === 0 && (
        <p className="text-xs mt-2 italic opacity-80">
          Nessuna per {periodo.label}. Scarica il CSV dal SDI e caricalo.
        </p>
      )}
      <Link
        href={importLink}
        className="mt-3 inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Apri /import →
      </Link>
    </div>
  )
}

function StepAutoMatch({
  periodo, stats, loading, onAutoMatch, onNext, onBack,
}: {
  periodo: ReturnType<typeof parsePeriodo>
  stats: WizardStats | null
  loading: boolean
  onAutoMatch: () => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Step 3 — Auto-match</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Lancio l&apos;auto-match limitato al periodo {periodo.label}. Trans abbinate a fatture
        con stesso soggetto (anche alias), importo entro 2€, data nel range −30/+120 gg.
      </p>
      <div className="bg-gray-50 dark:bg-gray-900 rounded p-4 mb-4">
        <p className="text-sm">
          <strong>Trans nel periodo:</strong> {stats?.trans.totale ?? '—'} ({stats?.trans.riconciliate ?? 0} già riconciliate, <span className="text-red-700">{stats?.trans.scoperte ?? 0} scoperte</span>)
        </p>
        <p className="text-sm mt-1">
          <strong>Fatture nel periodo:</strong> {stats?.fatture.totale ?? '—'} ({stats?.fatture.riconciliate ?? 0} riconciliate, <span className="text-amber-700">{stats?.fatture.scoperte ?? 0} senza pagamento</span>)
        </p>
      </div>
      <button
        onClick={onAutoMatch}
        disabled={loading || !periodo.from}
        className="mb-6 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded"
      >
        {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        Lancia Match automatici sul periodo
      </button>
      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 rounded bg-gray-100 dark:bg-gray-700 text-sm font-medium">Indietro</button>
        <button onClick={onNext} className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-1">
          Avanti <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function StepRiepilogo({
  periodo, stats, onBack,
}: { periodo: ReturnType<typeof parsePeriodo>; stats: WizardStats | null; onBack: () => void }) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Step 6 — Riepilogo periodo</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Stato della riconciliazione per <strong>{periodo.label}</strong>.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <SummaryCard
          color="red"
          label="Trans scoperte"
          count={stats?.trans.scoperte ?? 0}
          importo={stats?.trans.scoperteImporto ?? 0}
        />
        <SummaryCard
          color="amber"
          label="Fatture senza pagamento"
          count={stats?.fatture.scoperte ?? 0}
          importo={null}
        />
        <SummaryCard
          color="emerald"
          label="Trans riconciliate"
          count={stats?.trans.riconciliate ?? 0}
          importo={null}
        />
      </div>
      <div className="flex justify-between items-center">
        <button onClick={onBack} className="px-4 py-2 rounded bg-gray-100 dark:bg-gray-700 text-sm font-medium">Indietro</button>
        <Link
          href={`/soggetti?periodo=${periodo.slug}`}
          className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
        >
          Vai a Soggetti del periodo →
        </Link>
      </div>
    </div>
  )
}

const MOTIVI_PREDEFINITI = [
  'Importo piccolo',
  'Spesa sbagliata',
  'Stipendi',
  'Imposte e tasse',
  'Commissioni bancarie',
  'Spostamento tra conti',
  'Movimento personale',
]

interface TransScoperta {
  id: string
  importo: number
  tipo: string
  data: string
  conto: string
  controparte: string | null
  descrizione: string | null
}

function StepClassificazione({
  periodo, row, onReloadRow, onReloadStats, onNext, onBack, showFeedback,
}: {
  periodo: ReturnType<typeof parsePeriodo>
  row: PeriodoRow
  onReloadRow: () => Promise<void>
  onReloadStats: () => Promise<void>
  onNext: () => void
  onBack: () => void
  showFeedback: (k: 'ok' | 'err', t: string) => void
}) {
  const [trans, setTrans] = useState<TransScoperta[]>([])
  const [loading, setLoading] = useState(true)
  const [tralasciaModal, setTralasciaModal] = useState<{
    ids: string[]
    motivo: string
    custom: string
  } | null>(null)

  const reloadTrans = useCallback(async () => {
    if (!periodo.from || !periodo.to) return
    setLoading(true)
    try {
      const url = `/api/transazioni?stato=da_riconciliare&from=${periodo.from}&to=${periodo.to}`
      const res = await fetch(url)
      const data = await res.json()
      // /api/transazioni senza grouped ritorna un array piatto
      const list: TransScoperta[] = Array.isArray(data) ? data : (data.transazioni || [])
      // ordina per importo DESC
      list.sort((a, b) => Math.abs(b.importo) - Math.abs(a.importo))
      setTrans(list)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [periodo.from, periodo.to])

  useEffect(() => { reloadTrans() }, [reloadTrans])

  // ID già marcati come "estero" nella queue del periodo
  const queueSet = useMemo(() => new Set(row.trans_estere_queue), [row.trans_estere_queue])

  async function marcaEstero(tId: string) {
    try {
      const newQueue = Array.from(new Set([...row.trans_estere_queue, tId]))
      const res = await fetch('/api/wizard/periodo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, trans_estere_queue: newQueue }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', 'Marcata come fornitore estero')
      await onReloadRow()
    } catch (e: unknown) {
      showFeedback('err', e instanceof Error ? e.message : 'Errore')
    }
  }

  async function rimuoviEstero(tId: string) {
    try {
      const newQueue = row.trans_estere_queue.filter(x => x !== tId)
      const res = await fetch('/api/wizard/periodo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, trans_estere_queue: newQueue }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      await onReloadRow()
    } catch (e: unknown) {
      showFeedback('err', e instanceof Error ? e.message : 'Errore')
    }
  }

  function apriTralasciaSingola(tId: string) {
    setTralasciaModal({ ids: [tId], motivo: '', custom: '' })
  }

  async function submitTralascia() {
    if (!tralasciaModal) return
    const motivoFinal = tralasciaModal.motivo === 'Altro'
      ? tralasciaModal.custom.trim()
      : tralasciaModal.motivo
    if (!motivoFinal) {
      showFeedback('err', 'Seleziona o scrivi una motivazione')
      return
    }
    try {
      const res = await fetch('/api/transazioni/ignora', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transazione_ids: tralasciaModal.ids, motivo: motivoFinal }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', `${tralasciaModal.ids.length} transazioni tralasciate`)
      setTralasciaModal(null)
      await reloadTrans()
      await onReloadStats()
    } catch (e: unknown) {
      showFeedback('err', e instanceof Error ? e.message : 'Errore')
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Step 4 — Classifica le trans scoperte</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Per ogni transazione del periodo {periodo.label} ancora senza fattura corrispondente, scegli:
        <strong> Estero</strong> (entra in coda Step 5),
        <strong> Tralascia</strong> (con motivazione),
        oppure lasciala stare.
      </p>

      <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 rounded p-3 mb-4 text-xs text-amber-900 dark:text-amber-100">
        <strong>{row.trans_estere_queue.length}</strong> trans già marcate come Estero (vai allo Step 5 per caricarle).
      </div>

      {loading ? (
        <p className="text-center text-gray-500 py-8">Caricamento trans scoperte…</p>
      ) : trans.length === 0 ? (
        <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 rounded p-6 text-center text-emerald-900 dark:text-emerald-100">
          ✓ Tutte le transazioni del periodo sono coperte o classificate. Passa allo Step 5 per caricare le fatture estere o salta direttamente al Riepilogo.
        </div>
      ) : (
        <div className="space-y-1 mb-6 max-h-[500px] overflow-y-auto">
          {trans.map(t => {
            const isEstero = queueSet.has(t.id)
            const importoAbs = Math.abs(t.importo)
            return (
              <div
                key={t.id}
                className={`flex items-center gap-3 px-3 py-2 rounded text-sm border ${
                  isEstero
                    ? 'bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700'
                    : 'bg-gray-50 dark:bg-gray-900 border-transparent'
                }`}
              >
                <span className={`font-medium whitespace-nowrap ${t.tipo === 'entrata' ? 'text-green-700' : 'text-red-700'}`}>
                  {t.tipo === 'entrata' ? '+' : '−'}{formatCurrency(importoAbs)}
                </span>
                <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                  {new Date(t.data).toLocaleDateString('it-IT')}
                </span>
                <span className="capitalize text-gray-700 dark:text-gray-300 text-xs">{t.conto}</span>
                <span className="text-gray-800 dark:text-gray-200 truncate flex-1" title={t.controparte || t.descrizione || ''}>
                  {t.controparte || t.descrizione || <em className="text-gray-400">—</em>}
                </span>

                {isEstero ? (
                  <>
                    <span className="px-2 py-0.5 text-[10px] uppercase rounded bg-blue-200 dark:bg-blue-800 text-blue-900 dark:text-blue-100 font-bold flex items-center gap-1">
                      <Globe className="h-3 w-3" /> Estero
                    </span>
                    <button
                      onClick={() => rimuoviEstero(t.id)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Annulla
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => marcaEstero(t.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-200 font-medium"
                    >
                      <Globe className="h-3 w-3" /> Estero
                    </button>
                    <button
                      onClick={() => apriTralasciaSingola(t.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-amber-100 hover:bg-amber-200 dark:bg-amber-900 dark:hover:bg-amber-800 text-amber-700 dark:text-amber-200 font-medium"
                    >
                      Tralascia
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 rounded bg-gray-100 dark:bg-gray-700 text-sm font-medium">Indietro</button>
        <button onClick={onNext} className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-1">
          Avanti <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Modale Tralascia */}
      {tralasciaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setTralasciaModal(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-1">Tralascia transazione</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Seleziona o scrivi una motivazione. La transazione resterà visibile in &ldquo;Tralasciati&rdquo;
              con questa motivazione.
            </p>
            <select
              value={tralasciaModal.motivo}
              onChange={e => setTralasciaModal(prev => prev ? { ...prev, motivo: e.target.value } : null)}
              className="w-full border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 mb-2"
            >
              <option value="">Seleziona motivazione…</option>
              {MOTIVI_PREDEFINITI.map(m => <option key={m} value={m}>{m}</option>)}
              <option value="Altro">Altro (scrivi)</option>
            </select>
            {tralasciaModal.motivo === 'Altro' && (
              <input
                type="text"
                value={tralasciaModal.custom}
                onChange={e => setTralasciaModal(prev => prev ? { ...prev, custom: e.target.value } : null)}
                placeholder="Scrivi la motivazione"
                className="w-full border rounded px-3 py-2 dark:bg-gray-700 dark:border-gray-600 mb-2"
              />
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setTralasciaModal(null)} className="px-4 py-2 rounded bg-gray-100 dark:bg-gray-700 text-sm">Annulla</button>
              <button onClick={submitTralascia} className="px-4 py-2 rounded bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium">Tralascia</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface FatturaEsteraForm {
  numero: string
  denominazione_fornitore: string
  data_emissione: string
  totale: number
  valuta: string
  importo_originale: number
  piva_fornitore: string
  note: string
}

function StepFattureEstere({
  row, onReloadRow, onReloadStats, onNext, onBack, showFeedback,
}: {
  row: PeriodoRow
  onReloadRow: () => Promise<void>
  onReloadStats: () => Promise<void>
  onNext: () => void
  onBack: () => void
  showFeedback: (k: 'ok' | 'err', t: string) => void
}) {
  const [trans, setTrans] = useState<TransScoperta[]>([])
  const [loading, setLoading] = useState(true)
  const [forms, setForms] = useState<Record<string, FatturaEsteraForm>>({})

  const reloadQueueDetails = useCallback(async () => {
    if (row.trans_estere_queue.length === 0) {
      setTrans([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const ids = row.trans_estere_queue.join(',')
      const res = await fetch(`/api/transazioni?ids=${ids}`)
      const data = await res.json()
      const list: TransScoperta[] = Array.isArray(data) ? data : []
      list.sort((a, b) => Math.abs(b.importo) - Math.abs(a.importo))
      setTrans(list)
      // Pre-compila form per ogni trans
      const newForms: Record<string, FatturaEsteraForm> = {}
      for (const t of list) {
        const importoAbs = Math.abs(t.importo)
        newForms[t.id] = forms[t.id] || {
          numero: '',
          denominazione_fornitore: t.controparte || '',
          data_emissione: t.data,
          totale: importoAbs,
          valuta: 'EUR',
          importo_originale: importoAbs,
          piva_fornitore: '',
          note: `Importata via wizard. Trans collegata: ${t.id.slice(0, 8)}`,
        }
      }
      setForms(newForms)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.trans_estere_queue.join(',')])

  useEffect(() => { reloadQueueDetails() }, [reloadQueueDetails])

  function updateForm(tId: string, field: keyof FatturaEsteraForm, value: string | number) {
    setForms(prev => ({ ...prev, [tId]: { ...prev[tId], [field]: value } }))
  }

  async function createFattura(tId: string) {
    const f = forms[tId]
    if (!f) return
    if (!f.numero.trim() || !f.denominazione_fornitore.trim() || !f.data_emissione || !f.totale) {
      showFeedback('err', 'Compila numero, fornitore, data e totale')
      return
    }
    try {
      const res = await fetch('/api/wizard/crea-fattura-estera', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transazione_id: tId,
          numero: f.numero,
          denominazione_fornitore: f.denominazione_fornitore,
          data_emissione: f.data_emissione,
          totale: Number(f.totale),
          valuta: f.valuta,
          importo_originale: Number(f.importo_originale),
          piva_fornitore: f.piva_fornitore || undefined,
          note: f.note || undefined,
          wizard_periodo_id: row.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', 'Fattura estera creata e collegata')
      await onReloadRow()
      await onReloadStats()
    } catch (e: unknown) {
      showFeedback('err', e instanceof Error ? e.message : 'Errore')
    }
  }

  async function rimuoviDallaCoda(tId: string) {
    try {
      const newQueue = row.trans_estere_queue.filter(x => x !== tId)
      const res = await fetch('/api/wizard/periodo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, trans_estere_queue: newQueue }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      await onReloadRow()
    } catch (e: unknown) {
      showFeedback('err', e instanceof Error ? e.message : 'Errore')
    }
  }

  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Step 5 — Carica fatture estere</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Per ogni trans marcata Estero allo Step 4, compila i campi della fattura del fornitore e
        clicca <strong>Crea fattura</strong>. La fattura viene creata e collegata alla trans (entrambe
        passano in stato &ldquo;riconciliata&rdquo;).
      </p>

      {loading ? (
        <p className="text-center text-gray-500 py-8">Caricamento coda…</p>
      ) : trans.length === 0 ? (
        <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 rounded p-6 text-center text-emerald-900 dark:text-emerald-100">
          ✓ Coda vuota. Tutte le fatture estere sono state caricate (o nessuna trans è marcata Estero).
        </div>
      ) : (
        <div className="space-y-4 mb-6 max-h-[600px] overflow-y-auto pr-2">
          {trans.map(t => {
            const f = forms[t.id] || {} as FatturaEsteraForm
            const importoAbs = Math.abs(t.importo)
            return (
              <div key={t.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="text-sm">
                    <span className={`font-bold ${t.tipo === 'entrata' ? 'text-green-700' : 'text-red-700'}`}>
                      {t.tipo === 'entrata' ? '+' : '−'}{formatCurrency(importoAbs)}
                    </span>
                    <span className="text-gray-500 mx-2">·</span>
                    <span className="text-gray-700 dark:text-gray-300">{new Date(t.data).toLocaleDateString('it-IT')}</span>
                    <span className="text-gray-500 mx-2">·</span>
                    <span className="capitalize text-gray-700 dark:text-gray-300">{t.conto}</span>
                    <span className="text-gray-500 mx-2">·</span>
                    <span className="text-gray-800 dark:text-gray-200">{t.controparte || '—'}</span>
                  </div>
                  <button
                    onClick={() => rimuoviDallaCoda(t.id)}
                    className="text-xs text-gray-500 hover:text-red-600"
                  >
                    Rimuovi dalla coda
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Numero fattura *</label>
                    <input
                      type="text"
                      value={f.numero || ''}
                      onChange={e => updateForm(t.id, 'numero', e.target.value)}
                      placeholder="es. INV-001"
                      className="w-full text-sm border rounded px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Fornitore *</label>
                    <input
                      type="text"
                      value={f.denominazione_fornitore || ''}
                      onChange={e => updateForm(t.id, 'denominazione_fornitore', e.target.value)}
                      className="w-full text-sm border rounded px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Data emissione *</label>
                    <input
                      type="date"
                      value={f.data_emissione || ''}
                      onChange={e => updateForm(t.id, 'data_emissione', e.target.value)}
                      className="w-full text-sm border rounded px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Totale EUR *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={f.totale || ''}
                      onChange={e => updateForm(t.id, 'totale', parseFloat(e.target.value))}
                      className="w-full text-sm border rounded px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Valuta originale</label>
                    <select
                      value={f.valuta || 'EUR'}
                      onChange={e => updateForm(t.id, 'valuta', e.target.value)}
                      className="w-full text-sm border rounded px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600"
                    >
                      <option value="EUR">EUR</option>
                      <option value="USD">USD</option>
                      <option value="GBP">GBP</option>
                      <option value="CHF">CHF</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase tracking-wide font-semibold text-gray-500 mb-1">P.IVA / VAT</label>
                    <input
                      type="text"
                      value={f.piva_fornitore || ''}
                      onChange={e => updateForm(t.id, 'piva_fornitore', e.target.value)}
                      placeholder="opzionale"
                      className="w-full text-sm border rounded px-2 py-1.5 dark:bg-gray-700 dark:border-gray-600"
                    />
                  </div>
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => createFattura(t.id)}
                    className="inline-flex items-center gap-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded"
                  >
                    <Check className="h-4 w-4" /> Crea fattura
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 rounded bg-gray-100 dark:bg-gray-700 text-sm font-medium">Indietro</button>
        <button onClick={onNext} className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-1">
          Avanti <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function StepGenericPlaceholder({
  n, title, desc, stats, onNext, onBack,
}: {
  n: number
  title: string
  desc: string
  stats: WizardStats | null
  onNext: () => void
  onBack?: () => void
}) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Step {n} — {title}</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{desc}</p>
      {n === 1 && stats && (
        <div className="space-y-2 mb-6">
          {Object.entries(stats.trans.perConto).length === 0 ? (
            <p className="text-sm text-gray-500">Nessun movimento bancario nel periodo.</p>
          ) : (
            Object.entries(stats.trans.perConto).map(([conto, v]) => (
              <div key={conto} className="bg-gray-50 dark:bg-gray-900 rounded p-3 flex justify-between items-center text-sm">
                <span className="font-medium capitalize">{conto}</span>
                <span className="text-xs">
                  {v.count} righe · <span className="text-green-700">+{formatCurrency(v.entrate)}</span> · <span className="text-red-700">−{formatCurrency(v.uscite)}</span>
                </span>
              </div>
            ))
          )}
        </div>
      )}
      <div className="flex justify-between">
        {onBack ? (
          <button onClick={onBack} className="px-4 py-2 rounded bg-gray-100 dark:bg-gray-700 text-sm font-medium">Indietro</button>
        ) : <span />}
        <button onClick={onNext} className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-1">
          Avanti <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function TileImport({ title, count, color, desc }: { title: string; count: number; color: 'emerald'|'orange'|'indigo'|'red'; desc: string }) {
  const cls = {
    emerald: 'bg-emerald-50 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100',
    orange: 'bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-700 text-orange-900 dark:text-orange-100',
    indigo: 'bg-indigo-50 dark:bg-indigo-950 border-indigo-300 dark:border-indigo-700 text-indigo-900 dark:text-indigo-100',
    red: 'bg-red-50 dark:bg-red-950 border-red-300 dark:border-red-700 text-red-900 dark:text-red-100',
  }[color]
  return (
    <div className={`border-2 rounded-lg p-4 ${cls}`}>
      <p className="text-xs font-bold uppercase tracking-wider">{title}</p>
      <p className="text-3xl font-bold mt-1">{count}</p>
      <p className="text-xs mt-1 opacity-80">{desc}</p>
    </div>
  )
}

function SummaryCard({ color, label, count, importo }: { color: 'red'|'amber'|'emerald'; label: string; count: number; importo: number | null }) {
  const cls = {
    red: 'bg-red-50 dark:bg-red-950 border-red-300 text-red-900 dark:text-red-100',
    amber: 'bg-amber-50 dark:bg-amber-950 border-amber-300 text-amber-900 dark:text-amber-100',
    emerald: 'bg-emerald-50 dark:bg-emerald-950 border-emerald-300 text-emerald-900 dark:text-emerald-100',
  }[color]
  return (
    <div className={`border rounded-lg p-4 ${cls}`}>
      <p className="text-xs font-bold uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold mt-1">{count}</p>
      {importo !== null && <p className="text-xs mt-2">{formatCurrency(importo)}</p>}
    </div>
  )
}

export default function WizardPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-gray-500">Caricamento wizard…</div>}>
      <WizardInner />
    </Suspense>
  )
}
