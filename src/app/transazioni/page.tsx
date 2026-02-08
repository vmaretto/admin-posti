'use client'

import { useEffect, useState, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { 
  ChevronDown, 
  ChevronUp, 
  Search, 
  ExternalLink,
  Users,
  Receipt,
  TrendingUp,
  CheckCircle,
  ArrowUpDown
} from 'lucide-react'

interface FatturaCollegata {
  id: string
  numero: string
  data_emissione: string
  totale: number
  tipo: 'emessa' | 'ricevuta'
}

interface Transazione {
  id: string
  data: string
  importo: number
  tipo: 'entrata' | 'uscita'
  descrizione: string
  controparte?: string
  conto: string
  riferimento?: string
  stato_riconciliazione: string
  note?: string
  fatture?: FatturaCollegata[]
}

interface Controparte {
  nome: string
  nome_normalizzato: string
  transazioni: Transazione[]
  totale_entrate: number
  totale_uscite: number
  count: number
  riconciliate: number
}

type SortField = 'nome' | 'importo' | 'count' | 'percentuale'
type SortOrder = 'asc' | 'desc'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(date: string): string {
  return format(new Date(date), 'dd MMM yyyy', { locale: it })
}

const contoLabels: Record<string, string> = {
  qonto: 'Qonto',
  paypal: 'PayPal',
  wise: 'Wise',
  banca_sella: 'Banca Sella',
  sella_conto: 'Sella Conto',
  sella_carta: 'Sella Carta',
  revolut: 'Revolut'
}

const contoColors: Record<string, string> = {
  qonto: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  paypal: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  wise: 'bg-green-500/20 text-green-300 border-green-500/30',
  banca_sella: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  sella_conto: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  sella_carta: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  revolut: 'bg-purple-500/20 text-purple-300 border-purple-500/30'
}

// Stat Card Component
function StatCard({ icon: Icon, label, value, subValue, color }: {
  icon: any
  label: string
  value: string | number
  subValue?: string
  color: string
}) {
  return (
    <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
          <p className="text-xl font-bold text-white">{value}</p>
          {subValue && <p className="text-xs text-gray-500">{subValue}</p>}
        </div>
      </div>
    </div>
  )
}

// Controparte Card Component
function ControparteCard({ 
  controparte, 
  isExpanded, 
  onToggle 
}: { 
  controparte: Controparte
  isExpanded: boolean
  onToggle: () => void
}) {
  const saldo = controparte.totale_entrate - controparte.totale_uscite
  const percentualeRiconciliata = controparte.count > 0 
    ? Math.round((controparte.riconciliate / controparte.count) * 100) 
    : 0

  return (
    <div className="bg-gray-800/50 rounded-xl border border-gray-700/50 overflow-hidden transition-all duration-200">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {/* Nome e conteggio */}
          <div className="flex-1 min-w-0 text-left">
            <h3 className="font-semibold text-white truncate" title={controparte.nome}>
              {controparte.nome}
            </h3>
            <p className="text-sm text-gray-400">
              {controparte.count} transazion{controparte.count === 1 ? 'e' : 'i'}
            </p>
          </div>

          {/* Saldo */}
          <div className="text-right">
            <p className={`font-bold ${saldo >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {saldo >= 0 ? '+' : ''}{formatCurrency(saldo)}
            </p>
            <div className="flex gap-2 text-xs text-gray-500">
              {controparte.totale_entrate > 0 && (
                <span className="text-green-500">↑ {formatCurrency(controparte.totale_entrate)}</span>
              )}
              {controparte.totale_uscite > 0 && (
                <span className="text-red-500">↓ {formatCurrency(controparte.totale_uscite)}</span>
              )}
            </div>
          </div>

          {/* Progress bar riconciliazione */}
          <div className="hidden sm:flex items-center gap-2 w-32">
            <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all ${percentualeRiconciliata === 100 ? 'bg-green-500' : 'bg-yellow-500'}`}
                style={{ width: `${percentualeRiconciliata}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 w-12 text-right">
              {controparte.riconciliate}/{controparte.count}
            </span>
          </div>
        </div>

        {/* Expand icon */}
        <div className="ml-4 text-gray-400">
          {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-gray-700/50">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-900/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Data</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Conto</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Descrizione</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-400 uppercase">Importo</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-400 uppercase">Stato</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-400 uppercase">Fatture</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/30">
                {controparte.transazioni.map((trans) => (
                  <tr key={trans.id} className="hover:bg-gray-700/20 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-300 whitespace-nowrap">
                      {formatDate(trans.data)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded border ${contoColors[trans.conto] || 'bg-gray-700 text-gray-300 border-gray-600'}`}>
                        {contoLabels[trans.conto] || trans.conto}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400 max-w-[250px] truncate" title={trans.descrizione}>
                      {trans.descrizione || '-'}
                    </td>
                    <td className={`px-4 py-3 text-sm font-semibold text-right whitespace-nowrap ${trans.tipo === 'entrata' ? 'text-green-400' : 'text-red-400'}`}>
                      {trans.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(trans.importo))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {trans.stato_riconciliazione === 'riconciliata' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
                          <CheckCircle className="h-3 w-3" />
                          OK
                        </span>
                      ) : trans.stato_riconciliazione === 'ignorata' ? (
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-600/50 text-gray-400 border border-gray-500/30">
                          Ignorata
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                          Da fare
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {trans.fatture && trans.fatture.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {trans.fatture.map((f) => (
                            <Link 
                              key={f.id}
                              href={`/fatture?id=${f.id}`}
                              className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 text-xs bg-indigo-500/10 px-2 py-1 rounded border border-indigo-500/20 hover:border-indigo-500/40 transition-colors"
                            >
                              <span>{f.numero}</span>
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function TransazioniContent() {
  const searchParams = useSearchParams()
  
  const [controparti, setControparti] = useState<Controparte[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<string>('')
  const [filtroConto, setFiltroConto] = useState<string>('')
  const [filtroStato, setFiltroStato] = useState<string>('')
  
  // Sorting
  const [sortField, setSortField] = useState<SortField>('importo')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  const fetchData = () => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('grouped', 'true')
    if (filtroConto) params.set('conto', filtroConto)
    if (filtroTipo) params.set('tipo', filtroTipo)
    if (filtroStato) params.set('stato', filtroStato)
    
    fetch(`/api/transazioni?${params}`)
      .then(res => res.json())
      .then(data => {
        setControparti(data.controparti || [])
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchData()
  }, [filtroConto, filtroTipo, filtroStato])

  // Toggle expand
  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Filter and sort controparti
  const filteredControparti = useMemo(() => {
    let result = [...controparti]
    
    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(c => 
        c.nome.toLowerCase().includes(query) ||
        c.nome_normalizzato.includes(query)
      )
    }
    
    // Sort
    result.sort((a, b) => {
      let comparison = 0
      
      switch (sortField) {
        case 'nome':
          comparison = a.nome.localeCompare(b.nome)
          break
        case 'importo':
          const saldoA = Math.abs(a.totale_entrate - a.totale_uscite)
          const saldoB = Math.abs(b.totale_entrate - b.totale_uscite)
          comparison = saldoB - saldoA
          break
        case 'count':
          comparison = b.count - a.count
          break
        case 'percentuale':
          const percA = a.count > 0 ? a.riconciliate / a.count : 0
          const percB = b.count > 0 ? b.riconciliate / b.count : 0
          comparison = percB - percA
          break
      }
      
      return sortOrder === 'asc' ? -comparison : comparison
    })
    
    return result
  }, [controparti, searchQuery, sortField, sortOrder])

  // Stats
  const stats = useMemo(() => {
    let totaleEntrate = 0
    let totaleUscite = 0
    let totaleTransazioni = 0
    let totaleRiconciliate = 0
    
    for (const c of controparti) {
      totaleEntrate += c.totale_entrate
      totaleUscite += c.totale_uscite
      totaleTransazioni += c.count
      totaleRiconciliate += c.riconciliate
    }
    
    return {
      controparti: controparti.length,
      transazioni: totaleTransazioni,
      saldo: totaleEntrate - totaleUscite,
      entrate: totaleEntrate,
      uscite: totaleUscite,
      percentualeRiconciliato: totaleTransazioni > 0 
        ? Math.round((totaleRiconciliate / totaleTransazioni) * 100) 
        : 0,
      riconciliate: totaleRiconciliate
    }
  }, [controparti])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Transazioni per Controparte</h1>
          <p className="text-gray-400 mt-1">Vista aggregata delle transazioni raggruppate per soggetto</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard 
            icon={Users}
            label="Controparti"
            value={stats.controparti}
            color="bg-blue-500/20 text-blue-400"
          />
          <StatCard 
            icon={Receipt}
            label="Transazioni"
            value={stats.transazioni}
            color="bg-purple-500/20 text-purple-400"
          />
          <StatCard 
            icon={TrendingUp}
            label="Saldo"
            value={formatCurrency(stats.saldo)}
            subValue={`↑${formatCurrency(stats.entrate)} ↓${formatCurrency(stats.uscite)}`}
            color={stats.saldo >= 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}
          />
          <StatCard 
            icon={CheckCircle}
            label="Riconciliato"
            value={`${stats.percentualeRiconciliato}%`}
            subValue={`${stats.riconciliate}/${stats.transazioni}`}
            color="bg-yellow-500/20 text-yellow-400"
          />
        </div>

        {/* Filters */}
        <div className="bg-gray-800/50 rounded-xl p-4 mb-6 border border-gray-700/50">
          <div className="flex flex-wrap gap-4">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Cerca controparte</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Nome controparte..."
                  className="w-full pl-10 pr-4 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50"
                />
              </div>
            </div>

            {/* Tipo */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Tipo</label>
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
                className="px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <option value="">Tutte</option>
                <option value="entrata">Entrate</option>
                <option value="uscita">Uscite</option>
              </select>
            </div>

            {/* Conto */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Conto</label>
              <select
                value={filtroConto}
                onChange={(e) => setFiltroConto(e.target.value)}
                className="px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <option value="">Tutti</option>
                <option value="qonto">Qonto</option>
                <option value="paypal">PayPal</option>
                <option value="sella_conto">Sella Conto</option>
                <option value="sella_carta">Sella Carta</option>
                <option value="revolut">Revolut</option>
              </select>
            </div>

            {/* Stato */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1 uppercase tracking-wide">Stato</label>
              <select
                value={filtroStato}
                onChange={(e) => setFiltroStato(e.target.value)}
                className="px-3 py-2 bg-gray-700/50 border border-gray-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                <option value="">Tutte</option>
                <option value="da_riconciliare">Da riconciliare</option>
                <option value="riconciliata">Riconciliate</option>
                <option value="ignorata">Ignorate</option>
              </select>
            </div>
          </div>

          {/* Sort buttons */}
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-700/50">
            <span className="text-xs text-gray-500 uppercase tracking-wide self-center mr-2">Ordina per:</span>
            {[
              { field: 'importo' as SortField, label: 'Importo' },
              { field: 'count' as SortField, label: 'N° Trans.' },
              { field: 'nome' as SortField, label: 'Nome' },
              { field: 'percentuale' as SortField, label: '% Riconciliato' },
            ].map(({ field, label }) => (
              <button
                key={field}
                onClick={() => handleSort(field)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                  sortField === field 
                    ? 'bg-indigo-500/30 text-indigo-300 border border-indigo-500/50' 
                    : 'bg-gray-700/30 text-gray-400 border border-gray-600/30 hover:bg-gray-700/50'
                }`}
              >
                {label}
                {sortField === field && (
                  <ArrowUpDown className="h-3 w-3" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
          </div>
        ) : filteredControparti.length === 0 ? (
          <div className="text-center py-12 bg-gray-800/30 rounded-xl border border-gray-700/50">
            <p className="text-gray-400">Nessuna controparte trovata</p>
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="mt-2 text-indigo-400 hover:text-indigo-300 text-sm"
              >
                Cancella ricerca
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredControparti.map((controparte) => (
              <ControparteCard
                key={controparte.nome_normalizzato}
                controparte={controparte}
                isExpanded={expandedIds.has(controparte.nome_normalizzato)}
                onToggle={() => toggleExpand(controparte.nome_normalizzato)}
              />
            ))}
          </div>
        )}

        {/* Count */}
        {!loading && filteredControparti.length > 0 && (
          <p className="text-center text-gray-500 text-sm mt-6">
            {filteredControparti.length} controparte{filteredControparti.length !== 1 ? 'i' : ''} 
            {searchQuery && ` (filtrate da ${controparti.length})`}
          </p>
        )}
      </div>
    </div>
  )
}

export default function TransazioniPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500"></div>
      </div>
    }>
      <TransazioniContent />
    </Suspense>
  )
}
