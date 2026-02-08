'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { CheckCircle, Search, Zap, X, Check, XCircle } from 'lucide-react'

interface Match {
  fattura: {
    id: string
    numero: string
    totale: number
    data: string
    denominazione: string
  }
  transazione: {
    id: string
    importo: number
    data: string
    controparte: string
    conto: string
  }
  daysDiff: number
  accepted?: boolean
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(date: string): string {
  return format(new Date(date), 'dd MMM yyyy', { locale: it })
}

export default function RiconciliaPage() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)
  const [toleranceDays, setToleranceDays] = useState(30)

  const searchMatches = async () => {
    setLoading(true)
    setMessage(null)
    
    const params = new URLSearchParams()
    params.set('dryRun', 'true')
    params.set('toleranceDays', toleranceDays.toString())
    
    try {
      const res = await fetch(`/api/riconcilia?${params}`)
      const data = await res.json()
      // Initialize all matches as accepted by default
      const matchesWithState = (data.matches || []).map((m: Match) => ({ ...m, accepted: true }))
      setMatches(matchesWithState)
    } catch (err) {
      console.error(err)
      setMessage({ type: 'error', text: 'Errore durante la ricerca' })
    }
    setLoading(false)
  }

  const toggleMatch = (index: number) => {
    setMatches(prev => prev.map((m, i) => 
      i === index ? { ...m, accepted: !m.accepted } : m
    ))
  }

  const acceptAll = () => {
    setMatches(prev => prev.map(m => ({ ...m, accepted: true })))
  }

  const rejectAll = () => {
    setMatches(prev => prev.map(m => ({ ...m, accepted: false })))
  }

  const applyMatches = async () => {
    const accepted = matches.filter(m => m.accepted)
    if (accepted.length === 0) {
      setMessage({ type: 'error', text: 'Nessun match selezionato' })
      return
    }

    setApplying(true)
    setMessage(null)

    try {
      // Apply each accepted match
      for (const match of accepted) {
        await fetch('/api/riconcilia', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fatturaId: match.fattura.id,
            transazioneId: match.transazione.id
          })
        })
      }

      // Mark rejected as non_trovata
      const rejected = matches.filter(m => !m.accepted)
      for (const match of rejected) {
        await fetch('/api/riconcilia/reject', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fatturaId: match.fattura.id,
            transazioneId: match.transazione.id
          })
        })
      }

      setMessage({ type: 'success', text: `${accepted.length} riconciliazioni applicate, ${rejected.length} rifiutate` })
      setMatches([])
    } catch (err) {
      console.error(err)
      setMessage({ type: 'error', text: 'Errore durante l\'applicazione' })
    }
    setApplying(false)
  }

  const acceptedCount = matches.filter(m => m.accepted).length
  const rejectedCount = matches.filter(m => !m.accepted).length

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Riconciliazione Automatica</h1>
      
      {/* Search Panel */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Parametri Ricerca</h2>
        <div className="flex gap-4 items-end flex-wrap">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tolleranza giorni
            </label>
            <input
              type="number"
              value={toleranceDays}
              onChange={(e) => setToleranceDays(parseInt(e.target.value) || 30)}
              className="border rounded-md px-3 py-2 w-24"
              min="1"
              max="365"
            />
          </div>
          <button
            onClick={searchMatches}
            disabled={loading}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            Cerca Match
          </button>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          La ricerca trova fatture e transazioni con lo stesso importo (±2% o €5) entro il periodo di tolleranza.
          Le fatture emesse vengono matchate con entrate, le ricevute con uscite.
        </p>
      </div>

      {/* Message */}
      {message && (
        <div className={`border rounded-lg p-4 mb-6 flex items-center gap-3 ${
          message.type === 'success' 
            ? 'bg-green-50 border-green-200' 
            : 'bg-red-50 border-red-200'
        }`}>
          {message.type === 'success' 
            ? <CheckCircle className="h-6 w-6 text-green-600" />
            : <XCircle className="h-6 w-6 text-red-600" />
          }
          <span className={message.type === 'success' ? 'text-green-800' : 'text-red-800'}>
            {message.text}
          </span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      )}

      {/* Results */}
      {!loading && matches.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {/* Header with actions */}
          <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center flex-wrap gap-4">
            <div>
              <h3 className="font-semibold">Match trovati: {matches.length}</h3>
              <p className="text-sm text-gray-500">
                {acceptedCount} accettati, {rejectedCount} rifiutati
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={acceptAll}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-green-100 text-green-700 rounded-md hover:bg-green-200"
              >
                <Check className="h-4 w-4" />
                Accetta Tutti
              </button>
              <button
                onClick={rejectAll}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-md hover:bg-red-200"
              >
                <X className="h-4 w-4" />
                Rifiuta Tutti
              </button>
              <button
                onClick={applyMatches}
                disabled={applying || acceptedCount === 0}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-1.5 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                <Zap className="h-4 w-4" />
                {applying ? 'Applicando...' : `Applica (${acceptedCount})`}
              </button>
            </div>
          </div>

          {/* Match list */}
          <div className="divide-y">
            {matches.map((match, idx) => (
              <div 
                key={idx} 
                className={`p-4 transition-colors ${
                  match.accepted ? 'bg-white' : 'bg-gray-100 opacity-60'
                }`}
              >
                <div className="flex gap-4">
                  {/* Accept/Reject button */}
                  <div className="flex items-center">
                    <button
                      onClick={() => toggleMatch(idx)}
                      className={`p-2 rounded-full transition-colors ${
                        match.accepted 
                          ? 'bg-green-100 text-green-600 hover:bg-green-200' 
                          : 'bg-red-100 text-red-600 hover:bg-red-200'
                      }`}
                    >
                      {match.accepted ? <Check className="h-5 w-5" /> : <X className="h-5 w-5" />}
                    </button>
                  </div>

                  {/* Match details */}
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Fattura */}
                    <div className="bg-blue-50 rounded-lg p-4">
                      <div className="text-xs font-medium text-blue-600 uppercase mb-2">Fattura</div>
                      <div className="font-semibold">{match.fattura.numero}</div>
                      <div className="text-sm text-gray-600 truncate">{match.fattura.denominazione}</div>
                      <div className="flex justify-between mt-2">
                        <span className="text-sm text-gray-500">{formatDate(match.fattura.data)}</span>
                        <span className="font-semibold">{formatCurrency(match.fattura.totale)}</span>
                      </div>
                    </div>
                    
                    {/* Transazione */}
                    <div className="bg-green-50 rounded-lg p-4">
                      <div className="text-xs font-medium text-green-600 uppercase mb-2">Transazione</div>
                      <div className="font-semibold capitalize">{match.transazione.conto}</div>
                      <div className="text-sm text-gray-600 truncate">{match.transazione.controparte}</div>
                      <div className="flex justify-between mt-2">
                        <span className="text-sm text-gray-500">{formatDate(match.transazione.data)}</span>
                        <span className="font-semibold">{formatCurrency(match.transazione.importo)}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-center mt-2 text-sm text-gray-500 ml-12">
                  Differenza: {match.daysDiff} giorni | 
                  Δ importo: {formatCurrency(Math.abs(match.fattura.totale - match.transazione.importo))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && matches.length === 0 && !message && (
        <div className="text-center py-12 text-gray-500">
          Clicca "Cerca Match" per trovare corrispondenze automatiche tra fatture e transazioni.
        </div>
      )}
    </div>
  )
}
