'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { X, Save, ExternalLink } from 'lucide-react'

interface TransazioneCollegata {
  id: string
  data: string
  importo: number
  conto: string
  controparte?: string
}

interface Fattura {
  id: string
  tipo: 'emessa' | 'ricevuta'
  tipo_documento: string
  numero: string
  data_emissione: string
  denominazione_fornitore?: string
  denominazione_cliente?: string
  imponibile: number
  imposta: number
  totale: number
  stato_riconciliazione: string
  note?: string
  transazione?: TransazioneCollegata[]
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
  sella_conto: 'Sella',
  sella_carta: 'Sella Carta',
  revolut: 'Revolut'
}

function FattureContent() {
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('id')
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  
  const [fatture, setFatture] = useState<Fattura[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState<string>('')
  const [filtroStato, setFiltroStato] = useState<string>('')
  const [editingFattura, setEditingFattura] = useState<Fattura | null>(null)
  const [editStato, setEditStato] = useState<string>('')
  const [editNote, setEditNote] = useState<string>('')
  const [saving, setSaving] = useState(false)
  
  useEffect(() => {
    if (highlightId && !loading && fatture.length > 0) {
      setTimeout(() => {
        const row = rowRefs.current.get(highlightId)
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 100)
    }
  }, [highlightId, loading, fatture])

  const openEdit = (fattura: Fattura, e: React.MouseEvent) => {
    // Don't open edit if clicking on a link
    if ((e.target as HTMLElement).closest('a')) return
    setEditingFattura(fattura)
    setEditStato(fattura.stato_riconciliazione)
    setEditNote(fattura.note || '')
  }

  const closeEdit = () => {
    setEditingFattura(null)
    setEditStato('')
    setEditNote('')
  }

  const saveEdit = async () => {
    if (!editingFattura) return
    setSaving(true)
    
    try {
      const res = await fetch('/api/fatture', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingFattura.id,
          stato_riconciliazione: editStato,
          note: editNote
        })
      })
      
      if (res.ok) {
        fetchFatture()
        closeEdit()
      }
    } catch (err) {
      console.error(err)
    }
    setSaving(false)
  }

  const fetchFatture = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtroTipo) params.set('tipo', filtroTipo)
    if (filtroStato) params.set('stato', filtroStato)
    
    fetch(`/api/fatture?${params}`)
      .then(res => res.json())
      .then(data => {
        setFatture(data)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }

  useEffect(() => {
    fetchFatture()
  }, [filtroTipo, filtroStato])

  const getStatoBadge = (stato: string) => {
    switch (stato) {
      case 'riconciliata':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Riconciliata</span>
      case 'da_riconciliare':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Da riconciliare</span>
      case 'non_trovata':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Non trovata</span>
      default:
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">{stato}</span>
    }
  }

  const totale = fatture.reduce((sum, f) => sum + f.totale, 0)

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Fatture</h1>
        <div className="text-right">
          <p className="text-sm text-gray-500 dark:text-gray-400">Totale: <span className="font-bold text-lg text-gray-900 dark:text-white">{formatCurrency(totale)}</span></p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{fatture.length} fatture</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6 flex gap-4 flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
          <select 
            value={filtroTipo} 
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="">Tutte</option>
            <option value="emessa">Emesse</option>
            <option value="ricevuta">Ricevute</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Stato</label>
          <select 
            value={filtroStato} 
            onChange={(e) => setFiltroStato(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="">Tutti</option>
            <option value="da_riconciliare">Da riconciliare</option>
            <option value="riconciliata">Riconciliate</option>
            <option value="non_trovata">Non trovate</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Tipo</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Stato</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Numero</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Data</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Controparte</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Totale</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Transazione</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Note</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {fatture.map((fattura) => {
                const trans = fattura.transazione?.[0]
                return (
                  <tr 
                    key={fattura.id} 
                    ref={(el) => { if (el) rowRefs.current.set(fattura.id, el) }}
                    className={`hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-all ${
                      highlightId === fattura.id 
                        ? 'bg-yellow-200 dark:bg-yellow-900 ring-2 ring-yellow-400 ring-inset' 
                        : ''
                    }`}
                    onClick={(e) => openEdit(fattura, e)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${fattura.tipo === 'emessa' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'}`}>
                        {fattura.tipo === 'emessa' ? '↑' : '↓'}
                      </span>
                      {fattura.tipo_documento === 'nota_credito' && (
                        <span className="ml-1 px-1 py-0.5 text-xs font-medium rounded bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-300">NC</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-center">{getStatoBadge(fattura.stato_riconciliazione)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{fattura.numero}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDate(fattura.data_emissione)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-[200px] truncate" title={fattura.tipo === 'emessa' ? fattura.denominazione_cliente : fattura.denominazione_fornitore}>
                      {fattura.tipo === 'emessa' ? fattura.denominazione_cliente : fattura.denominazione_fornitore}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white text-right">{formatCurrency(fattura.totale)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      {trans ? (
                        <Link 
                          href={`/transazioni?id=${trans.id}`}
                          className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700">{contoLabels[trans.conto] || trans.conto}</span>
                          <span>{formatDate(trans.data)}</span>
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-[150px] truncate" title={fattura.note || ''}>{fattura.note || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {fatture.length === 0 && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              Nessuna fattura trovata. Importa i dati dalla pagina Import.
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editingFattura && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex justify-between items-center px-6 py-4 border-b dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Modifica Fattura</h3>
              <button onClick={closeEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="px-6 py-4 space-y-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Fattura</p>
                <p className="font-medium text-gray-900 dark:text-white">{editingFattura.numero}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {editingFattura.tipo === 'emessa' ? editingFattura.denominazione_cliente : editingFattura.denominazione_fornitore}
                </p>
                <p className="text-sm font-semibold mt-1 text-gray-900 dark:text-white">{formatCurrency(editingFattura.totale)}</p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Stato Riconciliazione
                </label>
                <select
                  value={editStato}
                  onChange={(e) => setEditStato(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  <option value="da_riconciliare">Da riconciliare</option>
                  <option value="riconciliata">Riconciliata</option>
                  <option value="non_trovata">Non trovata</option>
                  <option value="parziale">Parziale</option>
                  <option value="contestata">Contestata</option>
                  <option value="annullata">Annullata</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Note
                </label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 h-24 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="Aggiungi note..."
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-2 px-6 py-4 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-lg">
              <button
                onClick={closeEdit}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Annulla
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Salvataggio...' : 'Salva'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function FatturePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div></div>}>
      <FattureContent />
    </Suspense>
  )
}
