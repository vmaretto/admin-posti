'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface Soggetto {
  denominazione: string
  fatture: {
    id: string
    numero: string
    tipo: string
    totale: number
    data: string
    stato: string
  }[]
  transazioni: {
    id: string
    importo: number
    tipo: string
    data: string
    conto: string
    stato: string
  }[]
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
  }

  const filteredSoggetti = soggetti.filter(s => {
    // Search filter
    if (search && !s.denominazione.toLowerCase().includes(search.toLowerCase())) {
      return false
    }
    // Non-riconciliati filter
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
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Vista per Soggetto</h1>
      
      {/* Search & Filter */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 flex gap-4 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca soggetto..."
          className="flex-1 border rounded-md px-4 py-2"
        />
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={soloNonRiconciliati}
            onChange={(e) => setSoloNonRiconciliati(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600"
          />
          <span className="text-sm font-medium text-gray-700">Solo con non riconciliati</span>
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSoggetti.map((soggetto) => (
            <div key={soggetto.denominazione} className="bg-white rounded-lg shadow overflow-hidden">
              {/* Header row - clickable */}
              <div 
                className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                onClick={() => toggleExpand(soggetto.denominazione)}
              >
                <div className="flex items-center gap-3">
                  {expanded.has(soggetto.denominazione) ? (
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  )}
                  <div>
                    <p className="font-semibold text-gray-900">{soggetto.denominazione}</p>
                    <p className="text-sm text-gray-500">
                      {soggetto.fatture.length} fatture · {soggetto.transazioni.length} transazioni
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex gap-6">
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Fatture</p>
                      <p className="font-semibold">{formatCurrency(soggetto.totaleFatture)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Transazioni</p>
                      <p className="font-semibold">{formatCurrency(soggetto.totaleTransazioni)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 uppercase">Saldo</p>
                      <p className={`font-bold ${soggetto.saldo >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(soggetto.saldo)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Expanded details */}
              {expanded.has(soggetto.denominazione) && (
                <div className="border-t bg-gray-50 px-6 py-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Fatture */}
                    <div>
                      <h4 className="font-medium text-gray-700 mb-2">Fatture</h4>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {soggetto.fatture.length === 0 ? (
                          <p className="text-sm text-gray-400">Nessuna fattura</p>
                        ) : (
                          soggetto.fatture.map((f, idx) => (
                            <Link 
                              key={idx} 
                              href={`/fatture?id=${f.id}`}
                              className="flex justify-between text-sm bg-white rounded px-3 py-2 hover:bg-indigo-50 cursor-pointer transition group"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium group-hover:text-indigo-600">{f.numero}</span>
                                <span className="text-gray-500">{formatDate(f.data)}</span>
                                <ExternalLink className="h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100" />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 text-xs rounded ${
                                  f.stato === 'riconciliata' ? 'bg-green-100 text-green-700' :
                                  f.stato === 'da_riconciliare' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>{f.stato}</span>
                                <span className="font-medium">{formatCurrency(f.totale)}</span>
                              </div>
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                    
                    {/* Transazioni */}
                    <div>
                      <h4 className="font-medium text-gray-700 mb-2">Transazioni</h4>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {soggetto.transazioni.length === 0 ? (
                          <p className="text-sm text-gray-400">Nessuna transazione</p>
                        ) : (
                          soggetto.transazioni.map((t, idx) => (
                            <Link 
                              key={idx} 
                              href={`/transazioni?id=${t.id}`}
                              className="flex justify-between text-sm bg-white rounded px-3 py-2 hover:bg-indigo-50 cursor-pointer transition group"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium capitalize group-hover:text-indigo-600">{t.conto}</span>
                                <span className="text-gray-500">{formatDate(t.data)}</span>
                                <ExternalLink className="h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100" />
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`px-1.5 py-0.5 text-xs rounded ${
                                  t.stato === 'riconciliata' ? 'bg-green-100 text-green-700' :
                                  t.stato === 'da_riconciliare' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-gray-100 text-gray-700'
                                }`}>{t.stato}</span>
                                <span className={`font-medium ${t.tipo === 'entrata' ? 'text-green-600' : 'text-red-600'}`}>
                                  {t.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(t.importo))}
                                </span>
                              </div>
                            </Link>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
          
          {filteredSoggetti.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              Nessun soggetto trovato
            </div>
          )}
        </div>
      )}
    </div>
  )
}
