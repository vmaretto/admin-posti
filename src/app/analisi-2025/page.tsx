'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Banknote, CheckCircle2, FileText, RefreshCw, Target } from 'lucide-react'

type GroupedItem = {
  name: string
  amount: number
  count: number
  detail: string
}

type AnalysisData = {
  periodo: string
  banca: {
    transazioni: number
    entrate: number
    uscite: number
    saldo: number
    riconciliate: number
    aperte: number
    importo_aperto: number
  }
  fatture: {
    totali: number
    attive: number
    passive: number
    riconciliate: number
    aperte: number
    importo_riconciliato: number
    importo_aperto: number
  }
  top_transazioni_aperte: GroupedItem[]
  top_fatture_aperte: GroupedItem[]
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatCurrencyExact(amount: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'indigo',
}: {
  label: string
  value: string
  detail: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'indigo' | 'green' | 'red' | 'amber' | 'blue'
}) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    green: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{value}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">{detail}</p>
        </div>
        <div className={`p-3 rounded-xl ${tones[tone]}`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  )
}

function RankingCard({ title, items, accent }: { title: string; items: GroupedItem[]; accent: 'blue' | 'amber' }) {
  const max = Math.max(1, ...items.map((item) => item.amount))
  const bar = accent === 'blue' ? 'bg-blue-600' : 'bg-amber-500'
  const badge = accent === 'blue'
    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">{title}</h2>
      <div className="space-y-4">
        {items.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400">Nessuna voce aperta.</p>
        ) : (
          items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="p-4 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <span className={`inline-flex text-xs font-bold px-2 py-1 rounded-full ${badge}`}>#{index + 1}</span>
                  <h3 className="font-semibold text-gray-900 dark:text-white mt-2 break-words">{item.name}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{item.detail}</p>
                </div>
                <div className="text-right font-bold text-gray-900 dark:text-white whitespace-nowrap">
                  {formatCurrencyExact(item.amount)}
                </div>
              </div>
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full mt-3 overflow-hidden">
                <div className={`${bar} h-2 rounded-full`} style={{ width: `${Math.max(6, (item.amount / max) * 100)}%` }} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
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

  useEffect(() => {
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-10 w-10 animate-spin text-indigo-600" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-6 text-red-700 dark:text-red-300">
        <div className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-5 w-5" />
          Errore nel caricamento
        </div>
        <p className="mt-2">{error}</p>
      </div>
    )
  }

  const transactionProgress = data.banca.transazioni > 0
    ? Math.round((data.banca.riconciliate / data.banca.transazioni) * 100)
    : 0
  const invoiceProgress = data.fatture.totali > 0
    ? Math.round((data.fatture.riconciliate / data.fatture.totali) * 100)
    : 0

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">Analisi amministrativa</p>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-1">Bilancio / Prima nota {data.periodo}</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-2 max-w-3xl">
            Vista operativa dentro admin-pOsti per chiudere la riconciliazione banca-fatture: prima i blocchi più grandi,
            poi la lista residua da mandare o recuperare per il commercialista.
          </p>
        </div>
        <button
          onClick={loadData}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition"
        >
          <RefreshCw className="h-4 w-4" />
          Aggiorna
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <StatCard
          icon={Banknote}
          label="Movimenti banca 2025"
          value={data.banca.transazioni.toLocaleString('it-IT')}
          detail={`Entrate ${formatCurrency(data.banca.entrate)} · Uscite ${formatCurrency(data.banca.uscite)}`}
          tone="blue"
        />
        <StatCard
          icon={ArrowUpRight}
          label="Fatture attive"
          value={formatCurrency(data.fatture.attive)}
          detail="Fatture emesse nel periodo"
          tone="green"
        />
        <StatCard
          icon={ArrowDownRight}
          label="Fatture passive"
          value={formatCurrency(data.fatture.passive)}
          detail="Fatture ricevute nel periodo"
          tone="amber"
        />
        <StatCard
          icon={Target}
          label="Saldo movimenti"
          value={formatCurrency(data.banca.saldo)}
          detail="Entrate meno uscite bancarie"
          tone={data.banca.saldo >= 0 ? 'green' : 'red'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Stato riconciliazione</h2>
          </div>
          <div className="space-y-5">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600 dark:text-gray-400">Fatture riconciliate</span>
                <span className="font-semibold text-gray-900 dark:text-white">{invoiceProgress}%</span>
              </div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-3 bg-indigo-600 rounded-full" style={{ width: `${invoiceProgress}%` }} />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                {data.fatture.riconciliate.toLocaleString('it-IT')} di {data.fatture.totali.toLocaleString('it-IT')} · aperte {data.fatture.aperte.toLocaleString('it-IT')}
              </p>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-600 dark:text-gray-400">Transazioni riconciliate</span>
                <span className="font-semibold text-gray-900 dark:text-white">{transactionProgress}%</span>
              </div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-3 bg-blue-600 rounded-full" style={{ width: `${transactionProgress}%` }} />
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                {data.banca.riconciliate.toLocaleString('it-IT')} di {data.banca.transazioni.toLocaleString('it-IT')} · aperte {data.banca.aperte.toLocaleString('it-IT')}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="h-5 w-5 text-amber-600" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Aree aperte</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20">
              <p className="text-sm text-blue-700 dark:text-blue-300">Movimenti aperti</p>
              <p className="text-2xl font-bold text-blue-800 dark:text-blue-200 mt-1">{formatCurrency(data.banca.importo_aperto)}</p>
              <p className="text-xs text-blue-700/80 dark:text-blue-300/80 mt-1">{data.banca.aperte.toLocaleString('it-IT')} righe</p>
            </div>
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20">
              <p className="text-sm text-amber-700 dark:text-amber-300">Fatture aperte</p>
              <p className="text-2xl font-bold text-amber-800 dark:text-amber-200 mt-1">{formatCurrency(data.fatture.importo_aperto)}</p>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-1">{data.fatture.aperte.toLocaleString('it-IT')} documenti</p>
            </div>
          </div>
          <div className="mt-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/50 border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Regola pratica: partire dai primi soggetti in classifica. Se una riga è un incasso già fatturato,
              va abbinata; se è trasferimento/imposta/personale, va esclusa dalla lista documenti da recuperare.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <RankingCard title="Top movimenti bancari aperti" items={data.top_transazioni_aperte} accent="blue" />
        <RankingCard title="Top fatture aperte" items={data.top_fatture_aperte} accent="amber" />
      </div>
    </div>
  )
}
