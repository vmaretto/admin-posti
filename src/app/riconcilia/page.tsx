'use client'

import { useEffect, useState, useCallback } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { Check, Zap, AlertCircle, FileText, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'

// Types
interface Fattura {
  id: string
  numero: string
  soggetto: string
  importo: number
  data: string
  tipo: string
}

interface Transazione {
  id: string
  controparte: string
  importo: number
  data: string
  tipo: string
  conto: string
}

interface Candidato {
  transazione_id: string
  controparte: string
  importo: number
  data: string
  conto: string
  diff_importo: number
  diff_giorni: number
  score: number
}

interface FatturaConCandidati {
  fattura: Fattura
  candidati: Candidato[]
}

interface SoggettoSuggestion {
  soggetto: string
  soggetto_normalized: string
  tipo: 'emessa' | 'ricevuta'
  fatture: FatturaConCandidati[]
  transazioni: Transazione[]
  totale_fatture: number
  totale_transazioni: number
}

interface FatturaManuale {
  fattura: Fattura
  transazioni_simili: Candidato[]
}

interface SoggettoManuale {
  soggetto: string
  soggetto_normalized: string
  tipo: 'emessa' | 'ricevuta'
  fatture: FatturaManuale[]
  totale_fatture: number
}

interface AutoMatchDetail {
  fattura_ids: string[]
  transazione_id: string
  importo_fatture: number
  importo_transazione: number
  soggetto: string
  differenza: number
}

interface AutoMatchResult {
  matched: number
  details: AutoMatchDetail[]
}

// Helpers
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(date: string): string {
  return format(new Date(date), 'dd MMM yyyy', { locale: it })
}

type TabType = 'auto-match' | 'da-confermare' | 'manuali'

// Component: Soggetto Card per Tab "Da confermare"
function SoggettoCard({
  soggetto,
  onConfirm,
  actionLoading
}: {
  soggetto: SoggettoSuggestion
  onConfirm: (fatturaIds: string[], transazioneId: string) => void
  actionLoading: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [selectedFatture, setSelectedFatture] = useState<Set<string>>(new Set())
  const [selectedTransazione, setSelectedTransazione] = useState<string | null>(null)

  const toggleFattura = (id: string) => {
    const newSet = new Set(selectedFatture)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    setSelectedFatture(newSet)
  }

  const handleConfirm = () => {
    if (selectedFatture.size === 0 || !selectedTransazione) return
    onConfirm(Array.from(selectedFatture), selectedTransazione)
  }

  const selectedTotal = Array.from(selectedFatture).reduce((sum, id) => {
    const f = soggetto.fatture.find(fc => fc.fattura.id === id)
    return sum + (f?.fattura.importo || 0)
  }, 0)

  const selectedTrans = soggetto.transazioni.find(t => t.id === selectedTransazione)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden mb-4">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition"
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium px-2 py-1 rounded ${
            soggetto.tipo === 'emessa' 
              ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
              : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
          }`}>
            {soggetto.tipo === 'emessa' ? 'ENTRATA' : 'USCITA'}
          </span>
          <h3 className="font-semibold text-gray-900 dark:text-white">{soggetto.soggetto}</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <div className="text-gray-500 dark:text-gray-400">
              {soggetto.fatture.length} fattura{soggetto.fatture.length !== 1 ? 'e' : ''} • {soggetto.transazioni.length} transazion{soggetto.transazioni.length !== 1 ? 'i' : 'e'}
            </div>
            <div className={`font-medium ${
              Math.abs(soggetto.totale_fatture - soggetto.totale_transazioni) < 10
                ? 'text-green-600 dark:text-green-400'
                : 'text-yellow-600 dark:text-yellow-400'
            }`}>
              Fatture: {formatCurrency(soggetto.totale_fatture)} / Trans: {formatCurrency(soggetto.totale_transazioni)}
            </div>
          </div>
          {expanded ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="p-4">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Fatture */}
            <div>
              <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Fatture</h4>
              <div className="space-y-2">
                {soggetto.fatture.map(fc => (
                  <label
                    key={fc.fattura.id}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                      selectedFatture.has(fc.fattura.id)
                        ? 'bg-indigo-50 dark:bg-indigo-900/30 border-2 border-indigo-500'
                        : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFatture.has(fc.fattura.id)}
                      onChange={() => toggleFattura(fc.fattura.id)}
                      className="h-4 w-4 text-indigo-600 rounded"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-white truncate">
                        {fc.fattura.numero}
                      </div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(fc.fattura.data)}
                      </div>
                    </div>
                    <div className="font-semibold text-gray-900 dark:text-white">
                      {formatCurrency(fc.fattura.importo)}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Transazioni */}
            <div>
              <h4 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Transazioni</h4>
              <div className="space-y-2">
                {soggetto.transazioni.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setSelectedTransazione(t.id === selectedTransazione ? null : t.id)}
                    className={`w-full text-left p-3 rounded-lg transition ${
                      selectedTransazione === t.id
                        ? 'bg-green-50 dark:bg-green-900/30 border-2 border-green-500'
                        : 'bg-gray-50 dark:bg-gray-700 border-2 border-transparent hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">
                          {formatCurrency(t.importo)}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {formatDate(t.data)}
                        </div>
                      </div>
                      {t.conto && (
                        <span className="text-xs px-2 py-1 bg-gray-200 dark:bg-gray-600 rounded text-gray-600 dark:text-gray-300">
                          {t.conto}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Confirm bar */}
          {selectedFatture.size > 0 && selectedTransazione && (
            <div className="mt-4 p-3 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium text-indigo-900 dark:text-indigo-200">
                  {selectedFatture.size} fattura{selectedFatture.size !== 1 ? 'e' : ''} selezionata{selectedFatture.size !== 1 ? 'e' : ''}
                </span>
                <span className="text-indigo-700 dark:text-indigo-300 ml-2">
                  Totale: {formatCurrency(selectedTotal)}
                </span>
                {selectedTrans && (
                  <span className={`ml-2 ${
                    Math.abs(selectedTotal - selectedTrans.importo) < 3
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-yellow-600 dark:text-yellow-400'
                  }`}>
                    (Δ {formatCurrency(Math.abs(selectedTotal - selectedTrans.importo))})
                  </span>
                )}
              </div>
              <button
                onClick={handleConfirm}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50"
              >
                {actionLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Conferma associazione
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Component: Soggetto Card per Tab "Manuali"
function SoggettoManualeCard({
  soggetto,
  onConfirm,
  actionLoading
}: {
  soggetto: SoggettoManuale
  onConfirm: (fatturaId: string, transazioneId: string) => void
  actionLoading: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [expandedFattura, setExpandedFattura] = useState<string | null>(null)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden mb-4">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between bg-orange-50 dark:bg-orange-900/30 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition"
      >
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium px-2 py-1 rounded ${
            soggetto.tipo === 'emessa' 
              ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
              : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
          }`}>
            {soggetto.tipo === 'emessa' ? 'ENTRATA' : 'USCITA'}
          </span>
          <h3 className="font-semibold text-gray-900 dark:text-white">{soggetto.soggetto}</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <div className="text-gray-500 dark:text-gray-400">
              {soggetto.fatture.length} fattura{soggetto.fatture.length !== 1 ? 'e' : ''} senza match
            </div>
            <div className="font-medium text-orange-600 dark:text-orange-400">
              {formatCurrency(soggetto.totale_fatture)}
            </div>
          </div>
          {expanded ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
        </div>
      </button>

      {expanded && (
        <div className="p-4 space-y-3">
          {soggetto.fatture.map(fm => (
            <div key={fm.fattura.id} className="border dark:border-gray-700 rounded-lg overflow-hidden">
              {/* Fattura header */}
              <button
                onClick={() => setExpandedFattura(expandedFattura === fm.fattura.id ? null : fm.fattura.id)}
                className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-gray-900 dark:text-white">{fm.fattura.numero}</span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">{formatDate(fm.fattura.data)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(fm.fattura.importo)}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {fm.transazioni_simili.length} possibil{fm.transazioni_simili.length !== 1 ? 'i' : 'e'}
                  </span>
                  {expandedFattura === fm.fattura.id ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                </div>
              </button>

              {/* Transazioni simili */}
              {expandedFattura === fm.fattura.id && (
                <div className="p-3 space-y-2">
                  {fm.transazioni_simili.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
                      Nessuna transazione con importo simile trovata
                    </p>
                  ) : (
                    fm.transazioni_simili.map(ts => (
                      <div
                        key={ts.transazione_id}
                        className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 dark:text-white">
                              {formatCurrency(ts.importo)}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              ts.diff_importo <= 10 
                                ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                                : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                            }`}>
                              Δ {formatCurrency(ts.diff_importo)}
                            </span>
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            <span className="font-medium">{ts.controparte}</span>
                            <span className="mx-2">•</span>
                            <span>{formatDate(ts.data)}</span>
                            <span className="mx-2">•</span>
                            <span>{ts.diff_giorni > 0 ? '+' : ''}{ts.diff_giorni}g</span>
                            {ts.conto && (
                              <>
                                <span className="mx-2">•</span>
                                <span>{ts.conto}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => onConfirm(fm.fattura.id, ts.transazione_id)}
                          disabled={actionLoading}
                          className="ml-4 p-2 rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800 transition disabled:opacity-50"
                          title="Associa"
                        >
                          {actionLoading ? (
                            <RefreshCw className="h-5 w-5 animate-spin" />
                          ) : (
                            <Check className="h-5 w-5" />
                          )}
                        </button>
                      </div>
                    ))
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

// Main Page
export default function RiconciliaPage() {
  const [activeTab, setActiveTab] = useState<TabType>('da-confermare')
  const [suggestions, setSuggestions] = useState<SoggettoSuggestion[]>([])
  const [manuali, setManuali] = useState<SoggettoManuale[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [autoMatchResult, setAutoMatchResult] = useState<AutoMatchResult | null>(null)
  const [autoMatchRunning, setAutoMatchRunning] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/riconcilia/suggestions')
      const data = await res.json()
      setSuggestions(data.suggestions || [])
      setManuali(data.manuali || [])
    } catch (err) {
      console.error(err)
      setMessage({ type: 'error', text: 'Errore nel caricamento dati' })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  const runAutoMatch = async () => {
    setAutoMatchRunning(true)
    setAutoMatchResult(null)
    setMessage(null)
    
    try {
      const res = await fetch('/api/riconcilia/auto', { method: 'POST' })
      const data = await res.json()
      
      if (res.ok) {
        setAutoMatchResult(data)
        setMessage({ type: 'success', text: `✅ Auto-match completato: ${data.matched} riconciliazioni` })
        await loadData()
      } else {
        setMessage({ type: 'error', text: data.error || 'Errore auto-match' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Errore di connessione' })
    }
    
    setAutoMatchRunning(false)
  }

  const confirmAssociation = async (fatturaIds: string[], transazioneId: string) => {
    setActionLoading(true)
    setMessage(null)
    
    try {
      const res = await fetch('/api/riconcilia/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          fattura_ids: fatturaIds, 
          transazione_id: transazioneId 
        })
      })
      
      if (res.ok) {
        setMessage({ type: 'success', text: `✅ ${fatturaIds.length} fattura${fatturaIds.length !== 1 ? 'e' : ''} riconciliata${fatturaIds.length !== 1 ? 'e' : ''}!` })
        await loadData()
      } else {
        const err = await res.json()
        setMessage({ type: 'error', text: err.error || 'Errore' })
      }
    } catch (err) {
      setMessage({ type: 'error', text: 'Errore di connessione' })
    }
    
    setActionLoading(false)
  }

  const countFattureSuggestions = suggestions.reduce((sum, s) => sum + s.fatture.length, 0)
  const countFattureManuali = manuali.reduce((sum, s) => sum + s.fatture.length, 0)

  const tabs = [
    { id: 'auto-match' as const, label: 'Auto-match', icon: Zap },
    { id: 'da-confermare' as const, label: `Da confermare (${countFattureSuggestions})`, icon: AlertCircle },
    { id: 'manuali' as const, label: `Manuali (${countFattureManuali})`, icon: FileText },
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
        <nav className="-mb-px flex space-x-4 md:space-x-8 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm transition whitespace-nowrap ${
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
                  importo identico (diff ≤ 2€) e data compatibile (-30/+120 giorni). Supporta anche N:1 (somma di fatture = 1 transazione).
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
                        <div key={i} className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-700 rounded p-3 flex-wrap gap-2">
                          <div>
                            <span className="font-medium text-gray-900 dark:text-white">{d.soggetto}</span>
                            <span className="text-gray-500 dark:text-gray-400 ml-2">
                              ({d.fattura_ids.length} fattur{d.fattura_ids.length !== 1 ? 'e' : 'a'})
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-900 dark:text-white">{formatCurrency(d.importo_fatture)}</span>
                            <span className="text-gray-400">→</span>
                            <span className="text-green-600 dark:text-green-400">{formatCurrency(d.importo_transazione)}</span>
                            {d.differenza > 0 && (
                              <span className="text-xs text-yellow-600 dark:text-yellow-400">
                                (Δ {formatCurrency(d.differenza)})
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 dark:text-gray-400">
                      Nessuna riconciliazione automatica possibile. Controlla i suggerimenti nella tab &quot;Da confermare&quot;.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tab Da confermare */}
          {activeTab === 'da-confermare' && (
            <div>
              {suggestions.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  🎉 Nessun suggerimento da confermare!
                </div>
              ) : (
                suggestions.map(soggetto => (
                  <SoggettoCard
                    key={`${soggetto.soggetto_normalized}_${soggetto.tipo}`}
                    soggetto={soggetto}
                    onConfirm={confirmAssociation}
                    actionLoading={actionLoading}
                  />
                ))
              )}
            </div>
          )}

          {/* Tab Manuali */}
          {activeTab === 'manuali' && (
            <div>
              <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-800 rounded-lg p-4 mb-6">
                <p className="text-sm text-orange-800 dark:text-orange-200">
                  <strong>Fatture senza suggerimenti:</strong> Queste fatture non hanno transazioni dello stesso soggetto. 
                  Vengono proposte transazioni con importo simile (anche di altri soggetti) per associazione manuale.
                </p>
              </div>

              {manuali.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  🎉 Tutte le fatture hanno suggerimenti o sono riconciliate!
                </div>
              ) : (
                manuali.map(soggetto => (
                  <SoggettoManualeCard
                    key={`${soggetto.soggetto_normalized}_${soggetto.tipo}`}
                    soggetto={soggetto}
                    onConfirm={(fatturaId, transazioneId) => confirmAssociation([fatturaId], transazioneId)}
                    actionLoading={actionLoading}
                  />
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
