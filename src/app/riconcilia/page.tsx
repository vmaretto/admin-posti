'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { CheckCircle, Search, Zap } from 'lucide-react'

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
  const [applied, setApplied] = useState(false)
  const [toleranceDays, setToleranceDays] = useState(30)

  const searchMatches = async (apply: boolean = false) => {
    setLoading(true)
    setApplied(false)
    
    const params = new URLSearchParams()
    params.set('dryRun', (!apply).toString())
    params.set('toleranceDays', toleranceDays.toString())
    
    try {
      const res = await fetch(`/api/riconcilia?${params}`)
      const data = await res.json()
      setMatches(data.matches || [])
      if (apply) setApplied(true)
    } catch (err) {
      console.error(err)
    }
    setLoading(false)
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Riconciliazione Automatica</h1>
      
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Parametri Ricerca</h2>
        <div className="flex gap-4 items-end">
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
            onClick={() => searchMatches(false)}
            disabled={loading}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            Cerca Match
          </button>
          {matches.length > 0 && !applied && (
            <button
              onClick={() => searchMatches(true)}
              disabled={loading}
              className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              <Zap className="h-4 w-4" />
              Applica Tutti ({matches.length})
            </button>
          )}
        </div>
        
        <p className="mt-4 text-sm text-gray-500">
          La ricerca trova fatture e transazioni con lo stesso importo entro il periodo di tolleranza specificato.
          Le fatture emesse vengono matchate con entrate, le ricevute con uscite.
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      )}

      {applied && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-center gap-3">
          <CheckCircle className="h-6 w-6 text-green-600" />
          <span className="text-green-800 font-medium">
            {matches.length} riconciliazioni applicate con successo!
          </span>
        </div>
      )}

      {!loading && matches.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h3 className="font-semibold">Match trovati: {matches.length}</h3>
          </div>
          <div className="divide-y">
            {matches.map((match, idx) => (
              <div key={idx} className="p-4 hover:bg-gray-50">
                <div className="grid grid-cols-2 gap-4">
                  {/* Fattura */}
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-xs font-medium text-blue-600 uppercase mb-2">Fattura</div>
                    <div className="font-semibold">{match.fattura.numero}</div>
                    <div className="text-sm text-gray-600">{match.fattura.denominazione}</div>
                    <div className="flex justify-between mt-2">
                      <span className="text-sm text-gray-500">{formatDate(match.fattura.data)}</span>
                      <span className="font-semibold">{formatCurrency(match.fattura.totale)}</span>
                    </div>
                  </div>
                  
                  {/* Transazione */}
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="text-xs font-medium text-green-600 uppercase mb-2">Transazione</div>
                    <div className="font-semibold capitalize">{match.transazione.conto}</div>
                    <div className="text-sm text-gray-600">{match.transazione.controparte}</div>
                    <div className="flex justify-between mt-2">
                      <span className="text-sm text-gray-500">{formatDate(match.transazione.data)}</span>
                      <span className="font-semibold">{formatCurrency(match.transazione.importo)}</span>
                    </div>
                  </div>
                </div>
                <div className="text-center mt-2 text-sm text-gray-500">
                  Differenza: {match.daysDiff} giorni
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && matches.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          Clicca "Cerca Match" per trovare corrispondenze automatiche tra fatture e transazioni.
        </div>
      )}
    </div>
  )
}
