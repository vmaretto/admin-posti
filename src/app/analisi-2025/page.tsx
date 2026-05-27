'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownRight, Banknote, CheckCircle2, FileQuestion, Globe2, RefreshCw } from 'lucide-react'

type MonthBucket = { month: string; count: number; amount: number }
type CoverageSummary = {
  count: number
  amount: number
  first_date: string | null
  last_date: string | null
  months_present: string[]
  months_missing: string[]
}
type BankAccountCoverage = CoverageSummary & {
  conto: string
  entrate: number
  uscite: number
}
type InvoiceCoverage = CoverageSummary & {
  tipo: 'emessa' | 'ricevuta' | 'estero'
  first_number: string | null
  last_number: string | null
  last_subject: string | null
  gaps: string[]
  by_month: MonthBucket[]
}
type MissingDocumentCandidate = {
  subject: string
  kind: 'possibile_fattura_passiva' | 'possibile_fattura_estera' | 'da_classificare'
  amount: number
  count: number
  first_date: string | null
  last_date: string | null
  accounts: string[]
  reason: string
  priority: 'alta' | 'media' | 'bassa'
}
type AnalysisData = {
  periodo: string
  generated_at: string
  banca: CoverageSummary & {
    entrate: number
    uscite: number
    saldo: number
    by_account: BankAccountCoverage[]
    by_month: MonthBucket[]
  }
  fatture: {
    attive: InvoiceCoverage
    passive: InvoiceCoverage
    estere: InvoiceCoverage
  }
  documenti_mancanti: MissingDocumentCandidate[]
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount || 0)
}

function formatCurrencyExact(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount || 0)
}

function formatDate(date: string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('it-IT')
}

function shortMonth(month: string): string {
  const [, m] = month.split('-')
  return ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][Number(m) - 1] || month
}

function statusForLastDate(date: string | null): { label: string; className: string } {
  if (!date) return { label: 'Nessun dato 2025', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' }
  if (date >= '2025-12-01') return { label: 'Copre dicembre', className: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' }
  if (date >= '2025-10-01') return { label: 'Quasi completo', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' }
  return { label: 'Da verificare', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' }
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${className}`}>{children}</span>
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center gap-3 mb-5">
        <Icon className="h-5 w-5 text-indigo-600" />
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">{title}</h2>
      </div>
      {children}
    </section>
  )
}

function CoverageCard({ title, summary, subtitle }: { title: string; summary: CoverageSummary; subtitle?: string }) {
  const status = statusForLastDate(summary.last_date)
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-bold text-gray-900 dark:text-white">{title}</h3>
          {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>}
        </div>
        <Badge className={status.className}>{status.label}</Badge>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 text-sm">
        <div><p className="text-gray-500 dark:text-gray-400">Primo</p><p className="font-semibold text-gray-900 dark:text-white">{formatDate(summary.first_date)}</p></div>
        <div><p className="text-gray-500 dark:text-gray-400">Ultimo</p><p className="font-semibold text-gray-900 dark:text-white">{formatDate(summary.last_date)}</p></div>
        <div><p className="text-gray-500 dark:text-gray-400">Importo</p><p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(summary.amount)}</p></div>
        <div><p className="text-gray-500 dark:text-gray-400">Mesi mancanti</p><p className="font-semibold text-gray-900 dark:text-white">{summary.months_missing.length || '0'}</p></div>
      </div>
      {summary.months_missing.length > 0 && (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Mesi senza dati: {summary.months_missing.map(shortMonth).join(', ')}</p>
      )}
    </div>
  )
}

function InvoiceCard({ title, summary, icon: Icon }: { title: string; summary: InvoiceCoverage; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <SectionCard title={title} icon={Icon}>
      <CoverageCard summary={summary} title="Copertura temporale" subtitle={`${summary.count.toLocaleString('it-IT')} documenti registrati`} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Prima fattura</p>
          <p className="font-bold text-gray-900 dark:text-white mt-1">{summary.first_number || '—'}</p>
        </div>
        <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Ultima fattura</p>
          <p className="font-bold text-gray-900 dark:text-white mt-1">{summary.last_number || '—'}</p>
        </div>
        <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">Ultimo soggetto</p>
          <p className="font-bold text-gray-900 dark:text-white mt-1 truncate">{summary.last_subject || '—'}</p>
        </div>
      </div>
      <MonthStrip buckets={summary.by_month} />
      {summary.gaps.length > 0 && (
        <div className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4 text-sm text-amber-800 dark:text-amber-200">
          <p className="font-bold mb-1">Possibili buchi numerazione</p>
          <ul className="list-disc list-inside space-y-1">
            {summary.gaps.map((gap) => <li key={gap}>{gap}</li>)}
          </ul>
        </div>
      )}
    </SectionCard>
  )
}

function MonthStrip({ buckets }: { buckets: MonthBucket[] }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count))
  return (
    <div className="mt-5">
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Distribuzione mensile</p>
      <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
        {buckets.map((bucket) => (
          <div key={bucket.month} className="text-center">
            <div className="h-20 bg-gray-100 dark:bg-gray-700 rounded flex items-end overflow-hidden">
              <div
                className={`${bucket.count === 0 ? 'bg-red-300 dark:bg-red-700' : 'bg-indigo-500'} w-full rounded-t`}
                style={{ height: `${bucket.count === 0 ? 8 : Math.max(12, (bucket.count / max) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{shortMonth(bucket.month)}</p>
            <p className="text-xs font-bold text-gray-900 dark:text-white">{bucket.count}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function MissingDocuments({ items }: { items: MissingDocumentCandidate[] }) {
  const labels = {
    possibile_fattura_passiva: 'Possibile passiva',
    possibile_fattura_estera: 'Possibile estera',
    da_classificare: 'Da classificare',
  }
  const priorityClass = {
    alta: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
    media: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    bassa: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  }

  return (
    <SectionCard title="Possibili documenti da recuperare" icon={FileQuestion}>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Movimenti in uscita 2025 non riconciliati, ordinati per importo. È una lista di lavoro: va verificata con il commercialista.
      </p>
      <div className="space-y-3">
        {items.map((item, index) => (
          <div key={`${item.subject}-${index}`} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">#{index + 1}</Badge>
                  <Badge className={priorityClass[item.priority]}>Priorità {item.priority}</Badge>
                  <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">{labels[item.kind]}</Badge>
                </div>
                <h3 className="font-bold text-gray-900 dark:text-white mt-2 break-words">{item.subject}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{item.reason}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrencyExact(item.amount)}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{item.count} moviment{item.count === 1 ? 'o' : 'i'}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-sm text-gray-600 dark:text-gray-300">
              <span>Periodo: {formatDate(item.first_date)} → {formatDate(item.last_date)}</span>
              <span>Conti: {item.accounts.join(', ')}</span>
              <span>Ultimo movimento: {formatDate(item.last_date)}</span>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

export default function Analisi2025Page() {
  const [data, setData] = useState<AnalysisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/analisi-2025', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Errore caricamento analisi')
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Errore sconosciuto')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  if (loading) return <div className="flex items-center justify-center h-64"><RefreshCw className="h-10 w-10 animate-spin text-indigo-600" /></div>
  if (error || !data) return <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700"><AlertTriangle className="inline h-5 w-5 mr-2" />{error || 'Dati non disponibili'}</div>

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Check bilancio</p>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">Copertura documentale 2025</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-3xl">
            Vista per capire fino a dove arrivano banca, fatture attive, passive ed estere, e quali documenti potrebbero mancare.
          </p>
        </div>
        <button onClick={loadData} className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition">
          <RefreshCw className="h-4 w-4" /> Aggiorna
        </button>
      </div>

      <SectionCard title="Copertura banca" icon={Banknote}>
        <CoverageCard summary={data.banca} title="Tutti i conti bancari" subtitle={`Entrate ${formatCurrency(data.banca.entrate)} · Uscite ${formatCurrency(data.banca.uscite)} · Saldo ${formatCurrency(data.banca.saldo)}`} />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          {data.banca.by_account.map((account) => (
            <CoverageCard key={account.conto} summary={account} title={account.conto} subtitle={`Ultimo movimento: ${formatDate(account.last_date)}`} />
          ))}
        </div>
        <MonthStrip buckets={data.banca.by_month} />
      </SectionCard>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <InvoiceCard title="Fatture attive" summary={data.fatture.attive} icon={CheckCircle2} />
        <InvoiceCard title="Fatture passive" summary={data.fatture.passive} icon={ArrowDownRight} />
      </div>

      <InvoiceCard title="Fatture estere" summary={data.fatture.estere} icon={Globe2} />

      <MissingDocuments items={data.documenti_mancanti} />

      <div className="text-xs text-gray-400 dark:text-gray-500">
        Aggiornato: {new Date(data.generated_at).toLocaleString('it-IT')}. I suggerimenti sono euristici: servono per orientare il controllo, non modificano dati.
      </div>
    </div>
  )
}
