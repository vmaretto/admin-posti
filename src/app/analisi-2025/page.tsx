'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownRight, Banknote, CheckCircle2, Edit3, FileText, GitBranch, Globe2, RefreshCw } from 'lucide-react'

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
type InvoiceLite = {
  id: string
  numero: string | null
  data: string | null
  amount: number
  subject: string
  stato: string | null
  matched_transaction_ids: string[]
}
type TransactionLite = {
  id: string
  data: string | null
  amount: number
  tipo: string | null
  conto: string | null
  controparte: string
  descrizione: string | null
  stato: string | null
  matched_invoice_ids: string[]
  matched_invoices: InvoiceLite[]
  ok_without_invoice: boolean
}
type SupplierInvoiceCoverage = CoverageSummary & {
  subject: string
  normalized_subject: string
  invoices: InvoiceLite[]
  unmatched: InvoiceLite[]
}
type InvoiceCoverage = CoverageSummary & {
  tipo: 'emessa' | 'ricevuta' | 'estero'
  by_month: MonthBucket[]
  by_supplier: SupplierInvoiceCoverage[]
  unmatched: InvoiceLite[]
}
type TransactionSupplierGroup = CoverageSummary & {
  subject: string
  normalized_subject: string
  descriptions: string[]
  accounts: string[]
  entrate: number
  uscite: number
  riconciliate: number
  aperte: number
  ok_without_invoice_count: number
  transactions: TransactionLite[]
  unmatched_invoices: InvoiceLite[]
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
  transazioni: {
    by_supplier: TransactionSupplierGroup[]
    ok_without_invoice: TransactionLite[]
  }
  fatture: {
    attive: InvoiceCoverage
    passive: InvoiceCoverage
    estere: InvoiceCoverage
  }
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

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-200 hover:border-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition">
      {children}
    </Link>
  )
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
      <MonthPills present={summary.months_present} missing={summary.months_missing} />
    </div>
  )
}

function MonthPills({ present, missing }: { present: string[]; missing: string[] }) {
  const presentSet = new Set(present)
  const missingSet = new Set(missing)
  const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`)
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {months.map((month) => {
        const ok = presentSet.has(month)
        const ko = missingSet.has(month)
        return (
          <span key={month} className={`px-2 py-1 rounded text-xs font-bold ${ok ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : ko ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'}`}>
            {shortMonth(month)}
          </span>
        )
      })}
    </div>
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

function MatchStatus({ matchedCount, stato }: { matchedCount: number; stato: string | null }) {
  if (stato === 'riconciliata' && matchedCount > 0) {
    return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200">OK · fattura collegata</Badge>
  }
  if (stato === 'riconciliata' && matchedCount === 0) {
    return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">OK senza fattura</Badge>
  }
  return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Da associare</Badge>
}

function SupplierInvoiceSection({ title, summary, icon: Icon, editHref }: { title: string; summary: InvoiceCoverage; icon: React.ComponentType<{ className?: string }>; editHref: string }) {
  return (
    <SectionCard title={title} icon={Icon}>
      <CoverageCard summary={summary} title="Copertura temporale" subtitle={`${summary.count.toLocaleString('it-IT')} documenti registrati`} />
      <MonthStrip buckets={summary.by_month} />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Fornitori / soggetti e mesi coperti</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">Per ogni soggetto: mesi presenti, mesi mancanti e fatture senza movimento collegato.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionLink href={editHref}><Edit3 className="h-3.5 w-3.5" /> Modifica elenco</ActionLink>
          <ActionLink href="/riconcilia"><GitBranch className="h-3.5 w-3.5" /> Nuovo match</ActionLink>
        </div>
      </div>

      <div className="space-y-3 mt-4">
        {summary.by_supplier.slice(0, 30).map((supplier) => (
          <div key={supplier.normalized_subject} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
              <div className="min-w-0">
                <h4 className="font-bold text-gray-900 dark:text-white break-words">{supplier.subject}</h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {supplier.count} document{supplier.count === 1 ? 'o' : 'i'} · {formatCurrencyExact(supplier.amount)} · periodo {formatDate(supplier.first_date)} → {formatDate(supplier.last_date)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {supplier.unmatched.length > 0 ? (
                  <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{supplier.unmatched.length} senza movimento</Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200">Tutto associato</Badge>
                )}
                <ActionLink href={editHref}><Edit3 className="h-3.5 w-3.5" /> Modifica</ActionLink>
                <ActionLink href="/riconcilia"><GitBranch className="h-3.5 w-3.5" /> Match</ActionLink>
              </div>
            </div>
            <MonthPills present={supplier.months_present} missing={supplier.months_missing} />
            {supplier.unmatched.length > 0 && (
              <div className="mt-3 rounded-lg bg-white dark:bg-gray-950 border border-amber-200 dark:border-amber-900 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-2">Fatture rimaste senza movimento</p>
                <div className="space-y-2">
                  {supplier.unmatched.slice(0, 6).map((invoice) => (
                    <div key={invoice.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-sm">
                      <span className="text-gray-700 dark:text-gray-200">
                        {formatDate(invoice.data)} · {invoice.numero || 'senza numero'} · {formatCurrencyExact(invoice.amount)}
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <MatchStatus matchedCount={invoice.matched_transaction_ids.length} stato={invoice.stato} />
                        <ActionLink href={editHref}>Modifica</ActionLink>
                        <ActionLink href="/riconcilia">Nuovo match</ActionLink>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  )
}

function TransactionsSection({ groups, anomalies }: { groups: TransactionSupplierGroup[]; anomalies: TransactionLite[] }) {
  return (
    <SectionCard title="Transazioni per fornitore / controparte" icon={FileText}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 mb-4">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Le transazioni sono raggruppate per fornitore/controparte. Se una transazione è in stato OK, qui deve comparire almeno una fattura collegata.
          </p>
          {anomalies.length > 0 && (
            <p className="mt-2 text-sm font-semibold text-red-700 dark:text-red-300">
              Attenzione: {anomalies.length} transazion{anomalies.length === 1 ? 'e' : 'i'} in stato OK non hanno fattura collegata.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionLink href="/transazioni"><Edit3 className="h-3.5 w-3.5" /> Modifica transazioni</ActionLink>
          <ActionLink href="/riconcilia"><GitBranch className="h-3.5 w-3.5" /> Nuovo match</ActionLink>
        </div>
      </div>

      <div className="space-y-3">
        {groups.slice(0, 40).map((group) => (
          <div key={group.normalized_subject} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
            <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-white break-words">{group.subject}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {group.count} transazion{group.count === 1 ? 'e' : 'i'} · entrate {formatCurrencyExact(group.entrate)} · uscite {formatCurrencyExact(group.uscite)} · conti {group.accounts.join(', ')}
                </p>
                {group.descriptions.length > 0 && (
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
                    Descrizioni: {group.descriptions.join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200">{group.riconciliate} OK</Badge>
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{group.aperte} aperte</Badge>
                {group.ok_without_invoice_count > 0 && <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200">{group.ok_without_invoice_count} OK senza fattura</Badge>}
                {group.unmatched_invoices.length > 0 && <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">{group.unmatched_invoices.length} fatture senza movimento</Badge>}
                <ActionLink href="/transazioni"><Edit3 className="h-3.5 w-3.5" /> Modifica</ActionLink>
                <ActionLink href="/riconcilia"><GitBranch className="h-3.5 w-3.5" /> Match</ActionLink>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {group.transactions.slice(0, 5).map((transaction) => (
                <div key={transaction.id} className="rounded-lg bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-700 p-3 text-sm">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-white">
                        {formatDate(transaction.data)} · {transaction.conto || 'n/d'} · {formatCurrencyExact(transaction.amount)} · {transaction.tipo || 'n/d'}
                      </p>
                      <p className="text-gray-500 dark:text-gray-400 mt-1">{transaction.descrizione || transaction.controparte}</p>
                      {transaction.matched_invoices.length > 0 && (
                        <p className="text-gray-600 dark:text-gray-300 mt-1">
                          Fatture collegate: {transaction.matched_invoices.map((invoice) => `${invoice.numero || 's/n'} ${formatCurrencyExact(invoice.amount)}`).join(' · ')}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <MatchStatus matchedCount={transaction.matched_invoice_ids.length} stato={transaction.stato} />
                      <ActionLink href="/transazioni">Modifica</ActionLink>
                      <ActionLink href="/riconcilia">Nuovo match</ActionLink>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {group.unmatched_invoices.length > 0 && (
              <div className="mt-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300 mb-2">Fatture dello stesso soggetto senza movimento collegato</p>
                <div className="space-y-1 text-sm text-blue-900 dark:text-blue-100">
                  {group.unmatched_invoices.slice(0, 6).map((invoice) => (
                    <div key={invoice.id} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <span>{formatDate(invoice.data)} · {invoice.numero || 'senza numero'} · {formatCurrencyExact(invoice.amount)}</span>
                      <div className="flex flex-wrap gap-2">
                        <ActionLink href="/fatture">Modifica fattura</ActionLink>
                        <ActionLink href="/riconcilia">Associa</ActionLink>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">Copertura e match documentale 2025</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-3xl">
            Vista operativa per controllare mesi coperti, movimenti collegati, fatture senza movimento e casi da associare/modificare.
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

      <TransactionsSection groups={data.transazioni.by_supplier} anomalies={data.transazioni.ok_without_invoice} />

      <SupplierInvoiceSection title="Fatture attive italiane" summary={data.fatture.attive} icon={CheckCircle2} editHref="/fatture" />
      <SupplierInvoiceSection title="Fatture passive italiane" summary={data.fatture.passive} icon={ArrowDownRight} editHref="/fatture" />
      <SupplierInvoiceSection title="Fatture estere" summary={data.fatture.estere} icon={Globe2} editHref="/fatture-estere" />

      <div className="text-xs text-gray-400 dark:text-gray-500">
        Aggiornato: {new Date(data.generated_at).toLocaleString('it-IT')}. I pulsanti aprono le viste esistenti per modificare dati o creare un nuovo match.
      </div>
    </div>
  )
}
