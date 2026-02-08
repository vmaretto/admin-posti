'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'

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
}

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
  banca_sella: 'Banca Sella'
}

const contoColors: Record<string, string> = {
  qonto: 'bg-indigo-100 text-indigo-800',
  paypal: 'bg-blue-100 text-blue-800',
  wise: 'bg-green-100 text-green-800',
  banca_sella: 'bg-orange-100 text-orange-800'
}

export default function TransazioniPage() {
  const [transazioni, setTransazioni] = useState<Transazione[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroConto, setFiltroConto] = useState<string>('')
  const [filtroTipo, setFiltroTipo] = useState<string>('')
  const [filtroStato, setFiltroStato] = useState<string>('')

  const fetchTransazioni = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtroConto) params.set('conto', filtroConto)
    if (filtroTipo) params.set('tipo', filtroTipo)
    if (filtroStato) params.set('stato', filtroStato)
    
    fetch(`/api/transazioni?${params}`)
      .then(res => res.json())
      .then(data => {
        setTransazioni(data)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchTransazioni()
  }, [filtroConto, filtroTipo, filtroStato])

  const getStatoBadge = (stato: string) => {
    switch (stato) {
      case 'riconciliata':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800">Riconciliata</span>
      case 'da_riconciliare':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">Da riconciliare</span>
      default:
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">{stato}</span>
    }
  }

  const totaleEntrate = transazioni.filter(t => t.tipo === 'entrata').reduce((sum, t) => sum + t.importo, 0)
  const totaleUscite = transazioni.filter(t => t.tipo === 'uscita').reduce((sum, t) => sum + t.importo, 0)

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Transazioni</h1>
        <div className="text-right">
          <p className="text-sm text-gray-500">
            Entrate: <span className="font-bold text-green-600">{formatCurrency(totaleEntrate)}</span>
            {' | '}
            Uscite: <span className="font-bold text-red-600">{formatCurrency(totaleUscite)}</span>
          </p>
          <p className="text-sm text-gray-500">{transazioni.length} transazioni</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 flex gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Conto</label>
          <select 
            value={filtroConto} 
            onChange={(e) => setFiltroConto(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm"
          >
            <option value="">Tutti</option>
            <option value="qonto">Qonto</option>
            <option value="paypal">PayPal</option>
            <option value="wise">Wise</option>
            <option value="banca_sella">Banca Sella</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
          <select 
            value={filtroTipo} 
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm"
          >
            <option value="">Tutti</option>
            <option value="entrata">Entrate</option>
            <option value="uscita">Uscite</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Stato</label>
          <select 
            value={filtroStato} 
            onChange={(e) => setFiltroStato(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm"
          >
            <option value="">Tutti</option>
            <option value="da_riconciliare">Da riconciliare</option>
            <option value="riconciliata">Riconciliate</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conto</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Controparte</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descrizione</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Importo</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Stato</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Note</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {transazioni.map((trans) => (
                <tr key={trans.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(trans.data)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${contoColors[trans.conto] || 'bg-gray-100 text-gray-800'}`}>
                      {contoLabels[trans.conto] || trans.conto}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900 max-w-xs truncate">{trans.controparte || '-'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">{trans.descrizione || '-'}</td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm font-semibold text-right ${trans.tipo === 'entrata' ? 'text-green-600' : 'text-red-600'}`}>
                    {trans.tipo === 'entrata' ? '+' : '-'}{formatCurrency(trans.importo)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">{getStatoBadge(trans.stato_riconciliazione)}</td>
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate" title={trans.note || ''}>{trans.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {transazioni.length === 0 && (
            <div className="text-center py-12 text-gray-500">
              Nessuna transazione trovata. Importa i dati dalla pagina Import.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
