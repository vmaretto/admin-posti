'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { X, Save, ExternalLink, ChevronDown, ChevronRight, Search, Users, FileText, Euro, CheckCircle } from 'lucide-react'

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

interface SoggettoGroup {
  nome: string
  nome_normalizzato: string
  fatture: Fattura[]
  totale: number
  count: number
  riconciliate: number
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

type SortKey = 'nome' | 'totale' | 'count' | 'percentuale'
type SortDir = 'asc' | 'desc'

function FattureContent() {
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('id')
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map())
  
  const [soggetti, setSoggetti] = useState<SoggettoGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroTipo, setFiltroTipo] = useState<string>('')
  const [filtroStato, setFiltroStato] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [expandedSoggetti, setExpandedSoggetti] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('totale')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  
  // Edit modal state
  const [editingFattura, setEditingFattura] = useState<Fattura | null>(null)
  const [editStato, setEditStato] = useState<string>('')
  const [editNote, setEditNote] = useState<string>('')
  const [saving, setSaving] = useState(false)
  
  useEffect(() => {
    if (highlightId && !loading && soggetti.length > 0) {
      // Trova il soggetto che contiene questa fattura e espandilo
      for (const s of soggetti) {
        if (s.fatture.some(f => f.id === highlightId)) {
          setExpandedSoggetti(prev => new Set([...prev, s.nome_normalizzato]))
          break
        }
      }
      setTimeout(() => {
        const row = rowRefs.current.get(highlightId)
        if (row) {
          row.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }, 200)
    }
  }, [highlightId, loading, soggetti])

  const toggleSoggetto = (nomeNorm: string) => {
    setExpandedSoggetti(prev => {
      const next = new Set(prev)
      if (next.has(nomeNorm)) {
        next.delete(nomeNorm)
      } else {
        next.add(nomeNorm)
      }
      return next
    })
  }

  const openEdit = (fattura: Fattura, e: React.MouseEvent) => {
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
    params.set('grouped', 'true')
    if (filtroTipo) params.set('tipo', filtroTipo)
    if (filtroStato) params.set('stato', filtroStato)
    
    fetch(`/api/fatture?${params}`)
      .then(res => res.json())
      .then(data => {
        setSoggetti(data.soggetti || [])
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

  // Filter soggetti by search
  const filteredSoggetti = soggetti.filter(s => 
    searchQuery === '' || 
    s.nome.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.nome_normalizzato.includes(searchQuery.toLowerCase())
  )

  // Sort soggetti
  const sortedSoggetti = [...filteredSoggetti].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case 'nome':
        cmp = a.nome.localeCompare(b.nome)
        break
      case 'totale':
        cmp = a.totale - b.totale
        break
      case 'count':
        cmp = a.count - b.count
        break
      case 'percentuale':
        const pA = a.count > 0 ? a.riconciliate / a.count : 0
        const pB = b.count > 0 ? b.riconciliate / b.count : 0
        cmp = pA - pB
        break
    }
    return sortDir === 'desc' ? -cmp : cmp
  })

  // Stats
  const totaleSoggetti = filteredSoggetti.length
  const totaleFatture = filteredSoggetti.reduce((sum, s) => sum + s.count, 0)
  const totaleImporto = filteredSoggetti.reduce((sum, s) => sum + s.totale, 0)
  const totaleRiconciliate = filteredSoggetti.reduce((sum, s) => sum + s.riconciliate, 0)
  const percRiconciliato = totaleFatture > 0 ? (totaleRiconciliate / totaleFatture * 100).toFixed(1) : '0'

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const SortIndicator = ({ active, dir }: { active: boolean, dir: SortDir }) => {
    if (!active) return null
    return <span className="ml-1">{dir === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Fatture per Soggetto</h1>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <Users className="h-4 w-4" />
            Soggetti
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{totaleSoggetti}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <FileText className="h-4 w-4" />
            Fatture
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{totaleFatture}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <Euro className="h-4 w-4" />
            Importo Totale
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(totaleImporto)}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm mb-1">
            <CheckCircle className="h-4 w-4" />
            Riconciliato
          </div>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{percRiconciliato}%</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{totaleRiconciliate}/{totaleFatture}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cerca Soggetto</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Nome soggetto..."
                className="w-full pl-10 pr-3 py-2 border rounded-md text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
          </div>
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
      </div>

      {/* Sort bar */}
      <div className="flex gap-2 mb-4 text-sm">
        <span className="text-gray-500 dark:text-gray-400">Ordina per:</span>
        <button onClick={() => handleSort('nome')} className={`px-2 py-1 rounded ${sortKey === 'nome' ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
          Nome<SortIndicator active={sortKey === 'nome'} dir={sortDir} />
        </button>
        <button onClick={() => handleSort('totale')} className={`px-2 py-1 rounded ${sortKey === 'totale' ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
          Importo<SortIndicator active={sortKey === 'totale'} dir={sortDir} />
        </button>
        <button onClick={() => handleSort('count')} className={`px-2 py-1 rounded ${sortKey === 'count' ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
          N. Fatture<SortIndicator active={sortKey === 'count'} dir={sortDir} />
        </button>
        <button onClick={() => handleSort('percentuale')} className={`px-2 py-1 rounded ${sortKey === 'percentuale' ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
          % Riconciliato<SortIndicator active={sortKey === 'percentuale'} dir={sortDir} />
        </button>
      </div>

      {/* Soggetti List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedSoggetti.map((soggetto) => {
            const isExpanded = expandedSoggetti.has(soggetto.nome_normalizzato)
            const percRic = soggetto.count > 0 ? (soggetto.riconciliate / soggetto.count * 100) : 0
            
            return (
              <div key={soggetto.nome_normalizzato} className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                {/* Header */}
                <button
                  onClick={() => toggleSoggetto(soggetto.nome_normalizzato)}
                  className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? (
                      <ChevronDown className="h-5 w-5 text-gray-400" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-gray-400" />
                    )}
                    <div className="text-left">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{soggetto.nome}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {soggetto.count} fattur{soggetto.count === 1 ? 'a' : 'e'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="font-bold text-gray-900 dark:text-white">{formatCurrency(soggetto.totale)}</p>
                    </div>
                    <div className="w-32 hidden sm:block">
                      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                        <span>{soggetto.riconciliate}/{soggetto.count}</span>
                        <span>{percRic.toFixed(0)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all ${percRic === 100 ? 'bg-green-500' : percRic > 0 ? 'bg-yellow-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                          style={{ width: `${percRic}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </button>

                {/* Fatture Table (expanded) */}
                {isExpanded && (
                  <div className="border-t dark:border-gray-700 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                      <thead className="bg-gray-50 dark:bg-gray-900">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Tipo</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Stato</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Numero</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Data</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Totale</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Transazione</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {soggetto.fatture.map((fattura) => {
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
                              <td className="px-4 py-2 whitespace-nowrap">
                                <span className={`px-2 py-1 text-xs font-medium rounded ${fattura.tipo === 'emessa' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'}`}>
                                  {fattura.tipo === 'emessa' ? '↑' : '↓'}
                                </span>
                                {fattura.tipo_documento === 'nota_credito' && (
                                  <span className="ml-1 px-1 py-0.5 text-xs font-medium rounded bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-300">NC</span>
                                )}
                              </td>
                              <td className="px-4 py-2 whitespace-nowrap text-center">{getStatoBadge(fattura.stato_riconciliazione)}</td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{fattura.numero}</td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{formatDate(fattura.data_emissione)}</td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white text-right">{formatCurrency(fattura.totale)}</td>
                              <td className="px-4 py-2 whitespace-nowrap text-sm">
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
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}

          {sortedSoggetti.length === 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow text-center py-12 text-gray-500 dark:text-gray-400">
              {searchQuery ? 'Nessun soggetto trovato.' : 'Nessuna fattura. Importa i dati dalla pagina Import.'}
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
