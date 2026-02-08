'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { CheckCircle, ChevronDown, ChevronRight, Link2 } from 'lucide-react'

interface Fattura {
  id: string
  numero: string
  totale: number
  data: string
  denominazione: string
  tipo: string
  suggestionCount: number
}

interface Suggestion {
  id: string
  data: string
  importo: number
  controparte: string
  conto: string
  daysDiff: number
  amountDiff: number
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(date: string): string {
  return format(new Date(date), 'dd MMM yyyy', { locale: it })
}

export default function RiconciliaPage() {
  const [fatture, setFatture] = useState<Fattura[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)

  const loadFatture = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/riconcilia?toleranceDays=100')
      const data = await res.json()
      setFatture(data.fatture || [])
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadFatture()
  }, [])

  const toggleExpand = async (fatturaId: string) => {
    if (expandedId === fatturaId) {
      setExpandedId(null)
      setSuggestions([])
      return
    }
    
    setExpandedId(fatturaId)
    setLoadingSuggestions(true)
    setSuggestions([])
    
    try {
      const res = await fetch(`/api/riconcilia?fatturaId=${fatturaId}&toleranceDays=100`)
      const data = await res.json()
      setSuggestions(data.suggestions || [])
    } catch (err) {
      console.error(err)
    }
    setLoadingSuggestions(false)
  }

  const linkTransaction = async (fatturaId: string, transazioneId: string) => {
    setLinking(transazioneId)
    setMessage(null)
    
    try {
      const res = await fetch('/api/riconcilia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fatturaId, transazioneId })
      })
      
      if (res.ok) {
        setMessage({ type: 'success', text: '✅ Riconciliazione completata!' })
        setExpandedId(null)
        setSuggestions([])
        // Ricarica lista
        loadFatture()
      } else {
        const err = await res.json()
        setMessage({ type: 'error', text: err.error || 'Errore' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Errore di connessione' })
    }
    setLinking(null)
  }

  const withSuggestions = fatture.filter(f => f.suggestionCount > 0)
  const withoutSuggestions = fatture.filter(f => f.suggestionCount === 0)

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Riconcilia</h1>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {fatture.length} fatture da riconciliare • {withSuggestions.length} con suggerimenti
        </div>
      </div>

      {/* Info box */}
      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          <strong>Regole match:</strong> Soggetto deve corrispondere • Importo ±2% o €5 • Data ±100 giorni
        </p>
      </div>

      {/* Message */}
      {message && (
        <div className={`border rounded-lg p-4 mb-6 ${
          message.type === 'success' 
            ? 'bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200' 
            : 'bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
        }`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Fatture con suggerimenti */}
          {withSuggestions.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                Con suggerimenti ({withSuggestions.length})
              </h2>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y dark:divide-gray-700">
                {withSuggestions.map(fattura => (
                  <div key={fattura.id}>
                    {/* Fattura row */}
                    <div 
                      className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                      onClick={() => toggleExpand(fattura.id)}
                    >
                      <div className="flex items-center gap-3">
                        {expandedId === fattura.id ? (
                          <ChevronDown className="h-5 w-5 text-gray-400" />
                        ) : (
                          <ChevronRight className="h-5 w-5 text-gray-400" />
                        )}
                        <div>
                          <span className="font-medium text-gray-900 dark:text-white">{fattura.numero}</span>
                          <span className="text-gray-500 dark:text-gray-400 ml-2">{fattura.denominazione}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-gray-500 dark:text-gray-400">{formatDate(fattura.data)}</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(fattura.totale)}</span>
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                          {fattura.suggestionCount} match
                        </span>
                      </div>
                    </div>
                    
                    {/* Suggestions */}
                    {expandedId === fattura.id && (
                      <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 border-t dark:border-gray-700">
                        {loadingSuggestions ? (
                          <div className="flex justify-center py-4">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
                          </div>
                        ) : suggestions.length > 0 ? (
                          <div className="space-y-2">
                            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                              Seleziona la transazione da collegare:
                            </p>
                            {suggestions.map(s => (
                              <div 
                                key={s.id}
                                className="bg-white dark:bg-gray-800 rounded-lg p-3 flex items-center justify-between hover:ring-2 hover:ring-indigo-500 cursor-pointer transition"
                                onClick={() => linkTransaction(fattura.id, s.id)}
                              >
                                <div className="flex items-center gap-3">
                                  <Link2 className="h-4 w-4 text-indigo-500" />
                                  <div>
                                    <span className="font-medium capitalize text-gray-900 dark:text-white">{s.conto}</span>
                                    <span className="text-gray-500 dark:text-gray-400 ml-2">{s.controparte}</span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4 text-sm">
                                  <span className="text-gray-500 dark:text-gray-400">{formatDate(s.data)}</span>
                                  <span className="text-gray-500 dark:text-gray-400">Δ{s.daysDiff}gg</span>
                                  <span className="font-semibold text-green-600 dark:text-green-400">{formatCurrency(s.importo)}</span>
                                  {linking === s.id && (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400 py-2">
                            Nessun suggerimento disponibile
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fatture senza suggerimenti */}
          {withoutSuggestions.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                ⚠️ Senza suggerimenti ({withoutSuggestions.length})
              </h2>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
                <div className="max-h-64 overflow-y-auto divide-y dark:divide-gray-700">
                  {withoutSuggestions.slice(0, 50).map(fattura => (
                    <div key={fattura.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-white">{fattura.numero}</span>
                        <span className="text-gray-500 dark:text-gray-400 ml-2 text-sm">{fattura.denominazione}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-gray-500 dark:text-gray-400">{formatDate(fattura.data)}</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(fattura.totale)}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {withoutSuggestions.length > 50 && (
                  <div className="px-4 py-2 text-center text-gray-500 dark:text-gray-400 text-sm border-t dark:border-gray-700">
                    ... e altre {withoutSuggestions.length - 50} fatture
                  </div>
                )}
              </div>
            </div>
          )}

          {fatture.length === 0 && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              🎉 Tutte le fatture sono riconciliate!
            </div>
          )}
        </div>
      )}
    </div>
  )
}
