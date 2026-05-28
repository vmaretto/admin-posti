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

interface WizardStats {
  periodo: { from: string; to: string }
  trans: {
    totale: number
    perConto: Record<string, { count: number; entrate: number; uscite: number }>
    scoperte: number
    scoperteImporto: number
    riconciliate: number
  }
  fatture: {
    totale: number
    emesse: number
    ricevute: number
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
            <StepGenericPlaceholder
              n={1}
              title="Movimenti bancari del periodo"
              desc='Una tile per conto. Mostra quante righe ci sono nel DB per il periodo. Caricamento via /import (per ora). I parser per Qonto, Sella, Wise verranno aggiunti dopo che mi mandi i sample.'
              stats={stats}
              onNext={() => setStep(2)}
            />
          )}

          {/* STEP 2 — Fatture italiane */}
          {stepCorrente === 2 && (
            <StepFattureIT stats={stats} onNext={() => setStep(3)} onBack={() => setStep(1)} />
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

          {/* STEP 4 — Classificazione (placeholder per ora) */}
          {stepCorrente === 4 && (
            <StepGenericPlaceholder
              n={4}
              title="Classifica le trans scoperte"
              desc="Per ogni transazione del periodo non ancora coperta da fattura scegli: è un fornitore estero (entra nella coda Step 5), oppure tralasciala con motivazione. Implementazione in arrivo."
              stats={stats}
              onNext={() => setStep(5)}
              onBack={() => setStep(3)}
            />
          )}

          {/* STEP 5 — Carica fatture estere (placeholder) */}
          {stepCorrente === 5 && (
            <StepGenericPlaceholder
              n={5}
              title="Carica le fatture estere mancanti"
              desc="Per ogni trans marcata come estera allo Step 4, si apre un mini-form pre-compilato (data, importo, fornitore) per inserire la fattura. Implementazione in arrivo."
              stats={stats}
              onNext={() => setStep(6)}
              onBack={() => setStep(4)}
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

function StepFattureIT({
  stats, onNext, onBack,
}: { stats: WizardStats | null; onNext: () => void; onBack: () => void }) {
  return (
    <div>
      <h2 className="text-xl font-bold mb-1">Step 2 — Fatture italiane SDI</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Conteggi nel periodo. Per importare nuove SDI usa <Link href="/import" className="text-indigo-600 hover:underline">/import</Link>.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <TileImport
          title="Fatture emesse"
          count={stats?.fatture.emesse ?? 0}
          color="emerald"
          desc="Attive — clienti / ricavi"
        />
        <TileImport
          title="Fatture ricevute"
          count={stats?.fatture.ricevute ?? 0}
          color="orange"
          desc="Passive — fornitori / costi"
        />
      </div>
      <div className="flex justify-between">
        <button onClick={onBack} className="px-4 py-2 rounded bg-gray-100 dark:bg-gray-700 text-sm font-medium">Indietro</button>
        <button onClick={onNext} className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium inline-flex items-center gap-1">
          Avanti <ChevronRight className="h-4 w-4" />
        </button>
      </div>
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
