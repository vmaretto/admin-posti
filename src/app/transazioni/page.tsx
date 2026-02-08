'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { X, Save, ExternalLink } from 'lucide-react'

interface FatturaCollegata {
  id: string
  numero: string
  data_emissione: string
  totale: number
  tipo: 'emessa' | 'ricevuta'
}

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
  fatture?: FatturaCollegata[]  // N:1: più fatture possono essere collegate
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
  banca_sella: 'Banca Sella',
  sella_conto: 'Sella Conto',
  sella_carta: 'Sella Carta',
  revolut: 'Revolut'
}

const contoColors: Record<string, string> = {
  qonto: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  paypal: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  wise: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  banca_sella: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  sella_conto: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  sella_carta: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  revolut: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
}

function TransazioniContent() {
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('id')
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  
  const [transazioni, setTransazioni] = useState<Transazione[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroConto, setFiltroConto] = useState<string>('')
  const [filtroTipo, setFiltroTipo] = useState<string>('')
  const [filtroStato, setFiltroStato] = useState<string>('')
  
  // Edit modal state
  const [editingTrans, setEditingTrans] = useState<Transazione | null>(null)
  const [editStato, setEditStato] = useState<string>('')
  const [editNote, setEditNote] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [notFound, setNotFound] = useState(false)
  
  // Scroll to highlighted row (with longer delay for large lists)
  useEffect(() => {
    if (highlightId && !loading && transazioni.length > 0) {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        setTimeout(() => {
          const row = rowRefs.current.get(highlightId)
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' })
            // Flash effect
            row.classList.add('ring-4', 'ring-yellow-400')
            setTimeout(() => row.classList.remove('ring-4', 'ring-yellow-400'), 2000)
          } else {
            // If row not found in current view, the transaction might be filtered out
            const found = transazioni.find(t => t.id === highlightId)
            if (!found) {
              setNotFound(true)
            }
          }
        }, 300)
      })
    }
  }, [highlightId, loading, transazioni])

  const openEdit = (trans: Transazione, e: React.MouseEvent) => {
    // Don't open edit if clicking on a link
    if ((e.target as HTMLElement).closest('a')) return
    setEditingTrans(trans)
    setEditStato(trans.stato_riconciliazione)
    setEditNote(trans.note || '')
  }

  const closeEdit = () => {
    setEditingTrans(null)
    setEditStato('')
    setEditNote('')
  }

  const saveEdit = async () => {
    if (!editingTrans) return
    setSaving(true)
    
    try {
      const res = await fetch('/api/transazioni', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingTrans.id,
          stato_riconciliazione: editStato,
          note: editNote
        })
      })
      
      if (res.ok) {
        fetchTransazioni()
        closeEdit()
      }
    } catch (err) {
      console.error(err)
    }
    setSaving(false)
  }

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
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Riconciliata</span>
      case 'da_riconciliare':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Da riconciliare</span>
      case 'ignorata':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">Ignorata</span>
      default:
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">{stato}</span>
    }
  }

  const totaleEntrate = transazioni.filter(t => t.tipo === 'entrata').reduce((sum, t) => sum + t.importo, 0)
  const totaleUscite = transazioni.filter(t => t.tipo === 'uscita').reduce((sum, t) => sum + t.importo, 0)

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Transazioni</h1>
        <div className="text-right">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Entrate: <span className="font-bold text-green-600 dark:text-green-400">{formatCurrency(totaleEntrate)}</span>
            {' | '}
            Uscite: <span className="font-bold text-red-600 dark:text-red-400">{formatCurrency(totaleUscite)}</span>
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">{transazioni.length} transazioni</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6 flex gap-4 flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Conto</label>
          <select 
            value={filtroConto} 
            onChange={(e) => setFiltroConto(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="">Tutti</option>
            <option value="qonto">Qonto</option>
            <option value="paypal">PayPal</option>
            <option value="sella_conto">Sella Conto</option>
            <option value="sella_carta">Sella Carta</option>
            <option value="revolut">Revolut</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
          <select 
            value={filtroTipo} 
            onChange={(e) => setFiltroTipo(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
          >
            <option value="">Tutti</option>
            <option value="entrata">Entrate</option>
            <option value="uscita">Uscite</option>
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
            <option value="ignorata">Ignorate</option>
          </select>
        </div>
      </div>

      {/* Not found warning */}
      {notFound && highlightId && (
        <div className="bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 text-yellow-800 dark:text-yellow-200 px-4 py-3 rounded mb-4">
          ⚠️ Transazione non trovata nei risultati attuali. Prova a rimuovere i filtri.
        </div>
      )}

      {/* Table with horizontal scroll */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Data</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Conto</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Controparte</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap min-w-[200px]">Descrizione</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Importo</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Stato</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">Fattura</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap min-w-[150px]">Note</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {transazioni.map((trans) => (
                <tr 
                  key={trans.id}
                  ref={(el) => { if (el) rowRefs.current.set(trans.id, el) }}
                  onClick={(e) => openEdit(trans, e)}
                  className={`hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-all ${
                    highlightId === trans.id 
                      ? 'bg-yellow-200 dark:bg-yellow-900 ring-2 ring-yellow-400 ring-inset' 
                      : ''
                  }`}
                >
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDate(trans.data)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${contoColors[trans.conto] || 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'}`}>
                      {contoLabels[trans.conto] || trans.conto}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-[200px] truncate" title={trans.controparte || ''}>{trans.controparte || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-[300px] truncate" title={trans.descrizione || ''}>{trans.descrizione || '-'}</td>
                  <td className={`px-4 py-3 whitespace-nowrap text-sm font-semibold text-right ${trans.tipo === 'entrata' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {trans.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(trans.importo))}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-center">{getStatoBadge(trans.stato_riconciliazione)}</td>
                  <td className="px-4 py-3 text-sm">
                    {trans.fatture && trans.fatture.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {trans.fatture.map((f, idx) => (
                          <Link 
                            key={f.id}
                            href={`/fatture?id=${f.id}`}
                            className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline text-xs bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span>{f.numero}</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ))}
                        {trans.fatture.length > 1 && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">({trans.fatture.length})</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-[200px]">
                    <span className="block truncate" title={trans.note || ''}>{trans.note || '-'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {transazioni.length === 0 && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              Nessuna transazione trovata. Importa i dati dalla pagina Import.
            </div>
          )}
        </div>
      )}

      {/* Edit Modal */}
      {editingTrans && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
            <div className="flex justify-between items-center px-6 py-4 border-b dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Modifica Transazione</h3>
              <button onClick={closeEdit} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="px-6 py-4 space-y-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Transazione</p>
                <p className="font-medium text-gray-900 dark:text-white">{formatDate(editingTrans.data)}</p>
                <p className="text-sm text-gray-600 dark:text-gray-300">{editingTrans.controparte || 'N/A'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate" title={editingTrans.descrizione}>{editingTrans.descrizione}</p>
                <p className={`text-sm font-semibold mt-2 ${editingTrans.tipo === 'entrata' ? 'text-green-600' : 'text-red-600'}`}>
                  {editingTrans.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(editingTrans.importo))}
                </p>
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
                  <option value="ignorata">Ignorata</option>
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

export default function TransazioniPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div></div>}>
      <TransazioniContent />
    </Suspense>
  )
}
