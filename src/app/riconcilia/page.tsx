'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { Check, X, ChevronDown, ChevronRight, Link2 } from 'lucide-react'

interface Match {
  fattura: {
    id: string
    numero: string
    totale: number
    data: string
  }
  suggestions: {
    id: string
    data: string
    importo: number
    controparte: string
    conto: string
    daysDiff: number
    amountDiff: number
    score: number
  }[]
}

interface SoggettoGroup {
  denominazione: string
  matches: Match[]
  fattureSenzaMatch: {
    id: string
    numero: string
    totale: number
    data: string
  }[]
  transazioniOrfane: {
    id: string
    data: string
    importo: number
    conto: string
  }[]
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(date: string): string {
  return format(new Date(date), 'dd MMM yyyy', { locale: it })
}

export default function RiconciliaPage() {
  const [soggetti, setSoggetti] = useState<SoggettoGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedTrans, setSelectedTrans] = useState<Record<string, string>>({}) // fatturaId -> transazioneId
  const [linking, setLinking] = useState<string | null>(null)
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/riconcilia/grouped?toleranceDays=100')
      const data = await res.json()
      setSoggetti(data.soggetti || [])
      
      // Pre-seleziona la prima suggestion per ogni match
      const preSelected: Record<string, string> = {}
      for (const s of data.soggetti || []) {
        for (const m of s.matches) {
          if (m.suggestions.length > 0) {
            preSelected[m.fattura.id] = m.suggestions[0].id
          }
        }
      }
      setSelectedTrans(preSelected)
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
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

  const selectTransaction = (fatturaId: string, transazioneId: string) => {
    setSelectedTrans(prev => ({ ...prev, [fatturaId]: transazioneId }))
  }

  const linkMatch = async (fatturaId: string, soggettoDenom: string) => {
    const transazioneId = selectedTrans[fatturaId]
    if (!transazioneId) return
    
    setLinking(fatturaId)
    setMessage(null)
    
    try {
      const res = await fetch('/api/riconcilia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fatturaId, transazioneId })
      })
      
      if (res.ok) {
        setMessage({ type: 'success', text: '✅ Riconciliazione completata!' })
        // Mantieni il soggetto espanso
        const currentExpanded = new Set(expanded)
        currentExpanded.add(soggettoDenom)
        await loadData()
        setExpanded(currentExpanded)
      } else {
        const err = await res.json()
        setMessage({ type: 'error', text: err.error || 'Errore' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Errore di connessione' })
    }
    setLinking(null)
  }

  const skipFattura = async (fatturaId: string, soggettoDenom: string) => {
    // Marca come "non_trovata"
    try {
      await fetch('/api/fatture', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: fatturaId, stato_riconciliazione: 'non_trovata' })
      })
      // Mantieni il soggetto espanso
      const currentExpanded = new Set(expanded)
      currentExpanded.add(soggettoDenom)
      await loadData()
      setExpanded(currentExpanded)
    } catch (err) {
      console.error(err)
    }
  }

  const totalMatches = soggetti.reduce((sum, s) => sum + s.matches.length, 0)
  const totalSenzaMatch = soggetti.reduce((sum, s) => sum + s.fattureSenzaMatch.length, 0)

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Riconcilia</h1>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {totalMatches} con match • {totalSenzaMatch} senza match
        </div>
      </div>

      {/* Info */}
      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800 dark:text-blue-200">
          <strong>Regole:</strong> Soggetto deve corrispondere • Importo ±2% o €5 • Data ±100 giorni
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
      ) : soggetti.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          🎉 Tutte le fatture sono riconciliate!
        </div>
      ) : (
        <div className="space-y-3">
          {soggetti.map(soggetto => (
            <div key={soggetto.denominazione} className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
              {/* Header soggetto */}
              <div 
                className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 border-b dark:border-gray-700"
                onClick={() => toggleExpand(soggetto.denominazione)}
              >
                <div className="flex items-center gap-3">
                  {expanded.has(soggetto.denominazione) ? (
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  )}
                  <span className="font-semibold text-gray-900 dark:text-white">{soggetto.denominazione}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {soggetto.matches.length > 0 && (
                    <span className="px-2 py-1 rounded-full bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                      {soggetto.matches.length} match
                    </span>
                  )}
                  {soggetto.fattureSenzaMatch.length > 0 && (
                    <span className="px-2 py-1 rounded-full bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200">
                      {soggetto.fattureSenzaMatch.length} senza match
                    </span>
                  )}
                </div>
              </div>

              {/* Contenuto espanso */}
              {expanded.has(soggetto.denominazione) && (
                <div className="divide-y dark:divide-gray-700">
                  {/* Match proposti */}
                  {soggetto.matches.map(match => (
                    <div key={match.fattura.id} className="p-4">
                      <div className="flex gap-4 items-start">
                        {/* Fattura */}
                        <div className="flex-1 bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3">
                          <div className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase mb-1">Fattura</div>
                          <div className="font-semibold text-gray-900 dark:text-white">{match.fattura.numero}</div>
                          <div className="flex justify-between mt-1 text-sm">
                            <span className="text-gray-500 dark:text-gray-400">{formatDate(match.fattura.data)}</span>
                            <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(match.fattura.totale)}</span>
                          </div>
                        </div>

                        {/* Arrow */}
                        <div className="flex items-center justify-center pt-6">
                          <Link2 className="h-5 w-5 text-gray-400" />
                        </div>

                        {/* Transazioni suggerite */}
                        <div className="flex-1">
                          {match.suggestions.length === 1 ? (
                            // Match unico - mostra direttamente
                            <div className="bg-green-50 dark:bg-green-900/30 rounded-lg p-3">
                              <div className="text-xs font-medium text-green-600 dark:text-green-400 uppercase mb-1">
                                Transazione (score: {match.suggestions[0].score}%)
                              </div>
                              <div className="font-semibold capitalize text-gray-900 dark:text-white">{match.suggestions[0].conto}</div>
                              <div className="flex justify-between mt-1 text-sm">
                                <span className="text-gray-500 dark:text-gray-400">
                                  {formatDate(match.suggestions[0].data)} • Δ{match.suggestions[0].daysDiff}gg
                                </span>
                                <span className="font-medium text-green-600 dark:text-green-400">{formatCurrency(match.suggestions[0].importo)}</span>
                              </div>
                            </div>
                          ) : (
                            // Match multipli - permetti selezione
                            <div className="space-y-2">
                              <div className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase">
                                Seleziona transazione ({match.suggestions.length} opzioni)
                              </div>
                              {match.suggestions.map(s => (
                                <div 
                                  key={s.id}
                                  className={`rounded-lg p-3 cursor-pointer transition border-2 ${
                                    selectedTrans[match.fattura.id] === s.id
                                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                                      : 'border-transparent bg-gray-50 dark:bg-gray-700 hover:border-gray-300'
                                  }`}
                                  onClick={() => selectTransaction(match.fattura.id, s.id)}
                                >
                                  <div className="flex justify-between items-center">
                                    <div>
                                      <span className="font-medium capitalize text-gray-900 dark:text-white">{s.conto}</span>
                                      <span className="text-xs ml-2 text-gray-500">score: {s.score}%</span>
                                    </div>
                                    <span className="font-medium text-green-600 dark:text-green-400">{formatCurrency(s.importo)}</span>
                                  </div>
                                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    {formatDate(s.data)} • Δ{s.daysDiff}gg
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col gap-2 pt-2">
                          <button
                            onClick={() => linkMatch(match.fattura.id, soggetto.denominazione)}
                            disabled={linking === match.fattura.id || !selectedTrans[match.fattura.id]}
                            className="p-2 rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800 disabled:opacity-50"
                            title="Accetta"
                          >
                            {linking === match.fattura.id ? (
                              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600"></div>
                            ) : (
                              <Check className="h-5 w-5" />
                            )}
                          </button>
                          <button
                            onClick={() => skipFattura(match.fattura.id, soggetto.denominazione)}
                            className="p-2 rounded-full bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800"
                            title="Salta"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Fatture senza match */}
                  {soggetto.fattureSenzaMatch.length > 0 && (
                    <div className="p-4 bg-orange-50 dark:bg-orange-900/20">
                      <div className="text-sm font-medium text-orange-800 dark:text-orange-200 mb-2">
                        ⚠️ Fatture senza transazione corrispondente
                      </div>
                      <div className="space-y-2">
                        {soggetto.fattureSenzaMatch.map(f => (
                          <div key={f.id} className="flex justify-between items-center text-sm bg-white dark:bg-gray-800 rounded p-2">
                            <div>
                              <span className="font-medium text-gray-900 dark:text-white">{f.numero}</span>
                              <span className="text-gray-500 dark:text-gray-400 ml-2">{formatDate(f.data)}</span>
                            </div>
                            <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(f.totale)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
