'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Download, FileSpreadsheet, AlertCircle } from 'lucide-react'
import { parsePeriodo, defaultPeriodoSlug } from '@/lib/periodo'

interface FatturaEstera {
  id: string
  numero: string
  data_emissione: string
  denominazione_fornitore: string
  totale: number
  valuta: string
  importo_originale: number
  stato_riconciliazione: string
  note: string
}

function formatCurrency(amount: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(amount)
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('it-IT')
}

function FattureEstereInner() {
  const searchParams = useSearchParams()
  const periodo = useMemo(
    () => parsePeriodo(searchParams.get('periodo') || defaultPeriodoSlug()),
    [searchParams],
  )
  const [fatture, setFatture] = useState<FatturaEstera[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    let url = '/api/fatture-estere'
    if (periodo.from && periodo.to) {
      url += `?from=${periodo.from}&to=${periodo.to}`
    }
    fetch(url)
      .then(res => res.json())
      .then(data => {
        setFatture(data)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }, [periodo.from, periodo.to])

  const exportToExcel = () => {
    // Create CSV content
    const headers = ['Numero', 'Data', 'Fornitore', 'Importo Originale', 'Valuta', 'Importo EUR', 'Stato', 'Note']
    const rows = fatture.map(f => [
      f.numero || '',
      f.data_emissione || '',
      f.denominazione_fornitore || '',
      f.importo_originale || f.totale || '',
      f.valuta || 'EUR',
      f.totale || '',
      f.stato_riconciliazione || '',
      f.note || ''
    ])
    
    const csvContent = [
      headers.join(';'),
      ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    ].join('\n')
    
    // Add BOM for Excel UTF-8
    const BOM = '\uFEFF'
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fatture-estere-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Fatture Estere</h1>
        <button
          onClick={exportToExcel}
          className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition"
        >
          <Download className="h-5 w-5" />
          Esporta Excel
        </button>
      </div>

      <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5" />
          <div>
            <p className="text-yellow-800 dark:text-yellow-200 font-medium">Attenzione</p>
            <p className="text-yellow-700 dark:text-yellow-300 text-sm">
              I dati sono estratti automaticamente dai PDF. Verifica che importi e date siano corretti.
              Esporta in Excel per una revisione più comoda.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Numero</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Data</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Fornitore</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Importo Orig.</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Valuta</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Importo EUR</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Stato</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {fatture.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white font-mono">{f.numero || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">{formatDate(f.data_emissione)}</td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{f.denominazione_fornitore || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300 text-right font-mono">
                    {f.importo_originale ? formatCurrency(f.importo_originale, f.valuta || 'EUR') : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      f.valuta === 'USD' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                      f.valuta === 'GBP' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                      'bg-gray-100 text-gray-800 dark:bg-gray-600 dark:text-gray-200'
                    }`}>
                      {f.valuta || 'EUR'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white text-right font-mono font-semibold">
                    {formatCurrency(f.totale || 0)}
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      f.stato_riconciliazione === 'riconciliata' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                      'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
                    }`}>
                      {f.stato_riconciliazione === 'riconciliata' ? '✓' : '○'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
        Totale: {fatture.length} fatture estere
      </div>
    </div>
  )
}

export default function FattureEsterePage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-gray-500">Caricamento…</div>}>
      <FattureEstereInner />
    </Suspense>
  )
}
