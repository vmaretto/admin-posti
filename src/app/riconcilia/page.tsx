'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { Check, X, Zap, AlertCircle, FileText, RefreshCw } from 'lucide-react'

interface Candidato {
  transazione_id: string
  controparte: string
  importo: number
  data: string
  diff_importo: number
  diff_giorni: number
  score: number
}

interface Suggestion {
  fattura: {
    id: string
    numero: string
    soggetto: string
    importo: number
    data: string
    tipo: string
  }
  candidati: Candidato[]
}

interface FatturaSenzaMatch {
  id: string
  numero: string
  soggetto: string
  importo: number
  data: string
  tipo: string
}

interface AutoMatchResult {
  matched: number
  details: { fattura: string; transazione: string }[]
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(date: string): string {
  return format(new Date(date), 'dd MMM yyyy', { locale: it })
}

type TabType = 'auto-match' | 'da-confermare' | 'manuali'

export default function RiconciliaPage() {
  const [activeTab, setActiveTab] = useState<TabType>('da-confermare')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [fattureSenzaMatch, setFattureSenzaMatch] = useState<FatturaSenzaMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [autoMatchResult, setAutoMatchResult] = useState<AutoMatchResult | null>(null)
  const [autoMatchRunning, setAutoMatchRunning] = useState(false)
  const [skippedFatture, setSkippedFatture] = useState<Set<string>>(new Set())

  const loadData = async () => {
    setLoading(true)
    try {
      // Carica suggerimenti
      const resSugg = await fetch('/api/riconcilia/suggestions')
      const dataSugg = await resSugg.json()
      setSuggestions(dataSugg.suggestions || [])
      
      // Carica fatture senza match (da API grouped)
      const resGrouped = await fetch('/api/riconcilia/grouped?toleranceDays=120')
      const dataGrouped = await resGrouped.json()
      
      // Estrai fatture senza match da tutti i soggetti
      const senzaMatch: FatturaSenzaMatch[] = []
      for (const soggetto of dataGrouped.soggetti || []) {
        for (const f of soggetto.fattureSenzaMatch || []) {
          senzaMatch.push({
            ...f,
            soggetto: soggetto.denominazione
          })
        }
      }
      setFattureSenzaMatch(senzaMatch)
    } catch (err) {
      console.error(err)
      setMessage({ type: 'error', text: 'Errore nel caricamento dati' })
    }
    setLoading(false)
  }

  useEffect(() => {
    loadData()
  }, [])

  const runAutoMatch = async () => {
    setAutoMatchRunning(true)
    setAutoMatchResult(null)
    setMessage(null)
    
    try {
      const res = await fetch('/api/riconcilia/auto-match', { method: 'POST' })
      const data = await res.json()
      
      if (res.ok) {
        setAutoMatchResult(data)
        setMessage({ type: 'success', text: `✅ Auto-match completato: ${data.matched} riconciliazioni` })
        await loadData() // Ricarica per aggiornare liste
      } else {
        setMessage({ type: 'error', text: data.error || 'Errore auto-match' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Errore di connessione' })
    }
    
    setAutoMatchRunning(false)
  }

  const confirmSuggestion = async (fatturaId: string, transazioneId: string) => {
    setActionLoading(fatturaId)
    setMessage(null)
    
    try {
      const res = await fetch('/api/riconcilia/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fattura_ids: [fatturaId], 
          transazione_id: transazioneId 
        })
      })
      
      if (res.ok) {
        setMessage({ type: 'success', text: '✅ Riconciliazione confermata!' })
        await loadData()
      } else {
        const err = await res.json()
        setMessage({ type: 'error', text: err.error || 'Errore' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Errore di connessione' })
    }
    
    setActionLoading(null)
  }

  const skipFattura = (fatturaId: string) => {
    setSkippedFatture(prev => new Set([...prev, fatturaId]))
  }

  const filteredSuggestions = suggestions.filter(s => !skippedFatture.has(s.fattura.id))

  const tabs = [
    { id: 'auto-match' as const, label: 'Auto-match', icon: Zap },
    { id: 'da-confermare' as const, label: `Da confermare (${filteredSuggestions.length})`, icon: AlertCircle },
    { id: 'manuali' as const, label: `Manuali (${fattureSenzaMatch.length})`, icon: FileText },
  ]

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Riconcilia</h1>
        <button
          onClick={loadData}
          disabled={loading}
          className="p-2 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
          title="Ricarica"
        >
          <RefreshCw className={`h-5 w-5 text-gray-600 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
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

      {/* Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
        <nav className="-mb-px flex space-x-8">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition ${
                activeTab === tab.id
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 hover:border-gray-300'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <>
          {/* Tab Auto-match */}
          {activeTab === 'auto-match' && (
            <div className="space-y-6">
              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>Auto-match:</strong> Riconcilia automaticamente le fatture con transazioni che hanno soggetto identico, 
                  importo identico (diff ≤ 2€) e data compatibile (-30/+120 giorni).
                </p>
              </div>

              <button
                onClick={runAutoMatch}
                disabled={autoMatchRunning}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition disabled:opacity-50"
              >
                {autoMatchRunning ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    Esecuzione in corso...
                  </>
                ) : (
                  <>
                    <Zap className="h-5 w-5" />
                    Esegui Auto-match
                  </>
                )}
              </button>

              {autoMatchResult && (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                  <h3 className="font-semibold text-lg text-gray-900 dark:text-white mb-4">
                    Risultato: {autoMatchResult.matched} riconciliazioni automatiche
                  </h3>
                  {autoMatchResult.details.length > 0 ? (
                    <div className="space-y-2">
                      {autoMatchResult.details.map((d, i) => (
                        <div key={i} className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-700 rounded p-2">
                          <span className="text-gray-900 dark:text-white">Fattura {d.fattura}</span>
                          <span className="text-gray-500 dark:text-gray-400">→</span>
                          <span className="text-green-600 dark:text-green-400">{d.transazione}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400">
                      Nessuna riconciliazione automatica possibile. Controlla i suggerimenti nella tab "Da confermare".
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tab Da confermare */}
          {activeTab === 'da-confermare' && (
            <div className="space-y-4">
              {filteredSuggestions.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  🎉 Nessun suggerimento da confermare!
                </div>
              ) : (
                filteredSuggestions.map(suggestion => (
                  <div key={suggestion.fattura.id} className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                    {/* Fattura header */}
                    <div className="p-4 border-b dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 uppercase">
                            Fattura {suggestion.fattura.tipo}
                          </span>
                          <h3 className="font-semibold text-gray-900 dark:text-white mt-1">
                            {suggestion.fattura.numero}
                          </h3>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {suggestion.fattura.soggetto}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-gray-900 dark:text-white">
                            {formatCurrency(suggestion.fattura.importo)}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {formatDate(suggestion.fattura.data)}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Candidati */}
                    <div className="p-4">
                      <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-3">
                        {suggestion.candidati.length} transazione{suggestion.candidati.length !== 1 ? 'i' : ''} candidata{suggestion.candidati.length !== 1 ? 'e' : ''}:
                      </p>
                      <div className="space-y-2">
                        {suggestion.candidati.map(candidato => (
                          <div
                            key={candidato.transazione_id}
                            className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {formatCurrency(candidato.importo)}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  candidato.diff_importo <= 10 
                                    ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                    : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                                }`}>
                                  Δ {formatCurrency(candidato.diff_importo)}
                                </span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                                  score: {candidato.score}%
                                </span>
                              </div>
                              <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                {formatDate(candidato.data)} • {candidato.diff_giorni > 0 ? '+' : ''}{candidato.diff_giorni} giorni
                              </div>
                            </div>
                            <button
                              onClick={() => confirmSuggestion(suggestion.fattura.id, candidato.transazione_id)}
                              disabled={actionLoading === suggestion.fattura.id}
                              className="ml-4 p-2 rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800 transition disabled:opacity-50"
                              title="Conferma"
                            >
                              {actionLoading === suggestion.fattura.id ? (
                                <RefreshCw className="h-5 w-5 animate-spin" />
                              ) : (
                                <Check className="h-5 w-5" />
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Skip button */}
                    <div className="px-4 pb-4">
                      <button
                        onClick={() => skipFattura(suggestion.fattura.id)}
                        className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition"
                      >
                        <X className="h-4 w-4" />
                        Salta questa fattura
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab Manuali */}
          {activeTab === 'manuali' && (
            <div className="space-y-4">
              <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4 mb-6">
                <p className="text-sm text-orange-800 dark:text-orange-200">
                  <strong>Fatture senza suggerimenti:</strong> Queste fatture non hanno transazioni corrispondenti 
                  (soggetto diverso o non trovato). Devono essere riconciliate manualmente.
                </p>
              </div>

              {fattureSenzaMatch.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  🎉 Tutte le fatture hanno suggerimenti o sono riconciliate!
                </div>
              ) : (
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Numero</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Soggetto</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Data</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Importo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {fattureSenzaMatch.map(fattura => (
                        <tr key={fattura.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                            {fattura.numero}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                            {fattura.soggetto}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {formatDate(fattura.data)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-right font-medium text-gray-900 dark:text-white">
                            {formatCurrency(fattura.importo)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
