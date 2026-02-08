'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { ChevronDown, ChevronRight, ExternalLink, Link2 } from 'lucide-react'
import Link from 'next/link'

interface Fattura {
  id: string
  numero: string
  tipo: string
  totale: number
  data: string
  stato: string
  transazione_id?: string  // ID della transazione collegata
}

interface Transazione {
  id: string
  importo: number
  tipo: string
  data: string
  conto: string
  stato: string
  fattura_id?: string  // ID della fattura collegata
}

interface Soggetto {
  denominazione: string
  fatture: Fattura[]
  transazioni: Transazione[]
  totaleFatture: number
  totaleTransazioni: number
  saldo: number
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(date: string): string {
  return format(new Date(date), 'dd MMM yyyy', { locale: it })
}

export default function SoggettiPage() {
  const [soggetti, setSoggetti] = useState<Soggetto[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [soloNonRiconciliati, setSoloNonRiconciliati] = useState(false)
  const [highlightFattura, setHighlightFattura] = useState<string | null>(null)
  const [highlightTransazione, setHighlightTransazione] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/soggetti')
      .then(res => res.json())
      .then(data => {
        setSoggetti(data)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }, [])

  const toggleExpand = (denom: string) => {
    const newExpanded = new Set(expanded)
    if (newExpanded.has(denom)) {
      newExpanded.delete(denom)
    } else {
      newExpanded.add(denom)
    }
    setExpanded(newExpanded)
    // Clear highlights when closing
    if (newExpanded.has(denom) === false) {
      setHighlightFattura(null)
      setHighlightTransazione(null)
    }
  }

  // Click on fattura to highlight corresponding transazione
  const handleFatturaClick = (fattura: Fattura, transazioni: Transazione[]) => {
    // Find transaction linked to this fattura
    const linkedTrans = transazioni.find(t => t.fattura_id === fattura.id)
    if (linkedTrans) {
      setHighlightTransazione(linkedTrans.id)
      setHighlightFattura(fattura.id)
      // Clear after 3 seconds
      setTimeout(() => {
        setHighlightTransazione(null)
        setHighlightFattura(null)
      }, 3000)
    }
  }

  // Click on transazione to highlight corresponding fattura
  const handleTransazioneClick = (transazione: Transazione) => {
    if (transazione.fattura_id) {
      setHighlightFattura(transazione.fattura_id)
      setHighlightTransazione(transazione.id)
      // Clear after 3 seconds
      setTimeout(() => {
        setHighlightFattura(null)
        setHighlightTransazione(null)
      }, 3000)
    }
  }

  const filteredSoggetti = soggetti.filter(s => {
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
  })

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">Vista per Soggetto</h1>
      
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
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {soggetto.fatture.length === 0 ? (
                          <p className="text-sm text-gray-400">Nessuna fattura</p>
                        ) : (
                          soggetto.fatture.map((f) => {
                            const isLinked = soggetto.transazioni.some(t => t.fattura_id === f.id)
                            const isHighlighted = highlightFattura === f.id
                            return (
                              <div 
                                key={f.id} 
                                className={`flex justify-between text-sm rounded px-3 py-2 transition group ${
                                  isHighlighted 
                                    ? 'bg-yellow-200 dark:bg-yellow-900 ring-2 ring-yellow-400' 
                                    : 'bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-gray-700'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {isLinked && (
                                    <button
                                      onClick={(e) => { e.preventDefault(); handleFatturaClick(f, soggetto.transazioni) }}
                                      className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400"
                                      title="Mostra transazione collegata"
                                    >
                                      <Link2 className="h-4 w-4" />
                                    </button>
                                  )}
                                  <Link 
                                    href={`/fatture?id=${f.id}`}
                                    className="font-medium hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
                                  >
                                    {f.numero}
                                  </Link>
                                  <span className="text-gray-500 dark:text-gray-400">{formatDate(f.data)}</span>
                                  <Link href={`/fatture?id=${f.id}`}>
                                    <ExternalLink className="h-3 w-3 text-gray-400 hover:text-indigo-600" />
                                  </Link>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 text-xs rounded ${
                                    f.stato === 'riconciliata' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                                    f.stato === 'da_riconciliare' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                                    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                  }`}>{f.stato.replace('_', ' ')}</span>
                                  <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(f.totale)}</span>
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
                      <div className="space-y-1 max-h-64 overflow-y-auto">
                        {soggetto.transazioni.length === 0 ? (
                          <p className="text-sm text-gray-400">Nessuna transazione</p>
                        ) : (
                          soggetto.transazioni.map((t) => {
                            const isLinked = !!t.fattura_id
                            const isHighlighted = highlightTransazione === t.id
                            return (
                              <div 
                                key={t.id} 
                                className={`flex justify-between text-sm rounded px-3 py-2 transition group ${
                                  isHighlighted 
                                    ? 'bg-yellow-200 dark:bg-yellow-900 ring-2 ring-yellow-400' 
                                    : 'bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-gray-700'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {isLinked && (
                                    <button
                                      onClick={(e) => { e.preventDefault(); handleTransazioneClick(t) }}
                                      className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400"
                                      title="Mostra fattura collegata"
                                    >
                                      <Link2 className="h-4 w-4" />
                                    </button>
                                  )}
                                  <Link 
                                    href={`/transazioni?id=${t.id}`}
                                    className="font-medium capitalize hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
                                  >
                                    {t.conto}
                                  </Link>
                                  <span className="text-gray-500 dark:text-gray-400">{formatDate(t.data)}</span>
                                  <Link href={`/transazioni?id=${t.id}`}>
                                    <ExternalLink className="h-3 w-3 text-gray-400 hover:text-indigo-600" />
                                  </Link>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 text-xs rounded ${
                                    t.stato === 'riconciliata' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                                    t.stato === 'da_riconciliare' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                                    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                  }`}>{t.stato.replace('_', ' ')}</span>
                                  <span className={`font-medium ${t.tipo === 'entrata' ? 'text-green-600' : 'text-red-600'}`}>
                                    {t.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(t.importo))}
                                  </span>
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
