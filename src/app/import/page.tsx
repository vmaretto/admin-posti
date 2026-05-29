'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Upload, FileText, CheckCircle, AlertCircle, Trash2, Info } from 'lucide-react'

// Tipi "speciali" hardcoded (non sono conti bancari)
type SpecialType = 'fatture_emesse' | 'fatture_ricevute' | 'paypal_csv'

// Un tipo di import dinamico: include i SpecialType + un conto da conti_config.
// Esempio: { kind: 'special', key: 'fatture_emesse' } o { kind: 'conto', key: 'qonto', hasParser: true }
interface ImportOption {
  kind: 'special' | 'conto'
  key: string // identificatore (es. 'qonto', 'sella_conto', 'fatture_emesse')
  label: string
  hasParser: boolean // se true, l'upload funziona davvero
  format: 'pdf' | 'csv' // formato file accettato
  desc: string
}

interface ContoCfg {
  key: string
  label: string
  has_parser: boolean
}

const SPECIAL_OPTIONS: ImportOption[] = [
  { kind: 'special', key: 'fatture_emesse', label: 'Fatture emesse SDI', hasParser: true, format: 'csv', desc: 'CSV dal cassetto fiscale (separatore ";").' },
  { kind: 'special', key: 'fatture_ricevute', label: 'Fatture ricevute SDI', hasParser: true, format: 'csv', desc: 'CSV dal cassetto fiscale (separatore ";").' },
  { kind: 'special', key: 'paypal_csv', label: 'Transazioni PayPal (CSV)', hasParser: true, format: 'csv', desc: 'CSV export da PayPal con separatore ",".' },
]

// Parser conto noti: mappa conto.key → endpoint backend
const CONTO_ENDPOINT: Record<string, { url: string; format: 'pdf' | 'csv' }> = {
  qonto: { url: '/api/import/qonto', format: 'pdf' },
  // paypal in conti_config va comunque tramite l'endpoint paypal csv esistente
  paypal: { url: '/api/import/paypal', format: 'csv' },
}

function ImportPageInner() {
  const searchParams = useSearchParams()
  const typeParam = searchParams.get('type')
  const [conti, setConti] = useState<ContoCfg[]>([])
  const [loadingConti, setLoadingConti] = useState(true)
  const [selectedKey, setSelectedKey] = useState<string>(typeParam || 'fatture_emesse')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  // Carica i conti configurati dal DB
  useEffect(() => {
    fetch('/api/conti')
      .then(r => r.json())
      .then(d => {
        setConti(Array.isArray(d?.conti) ? d.conti : [])
        setLoadingConti(false)
      })
      .catch(() => setLoadingConti(false))
  }, [])

  // Costruisci la lista completa di opzioni (special + conti)
  const allOptions: ImportOption[] = useMemo(() => {
    const contoOpts: ImportOption[] = conti.map(c => {
      // Cerca il parser noto per questa key (sovrascrive c.has_parser se presente)
      const ep = CONTO_ENDPOINT[c.key]
      return {
        kind: 'conto',
        key: c.key,
        label: c.label,
        hasParser: ep ? true : !!c.has_parser,
        format: ep?.format || 'pdf',
        desc: ep
          ? `Estratto conto ${c.label} (${ep.format.toUpperCase()}). Parsing automatico.`
          : `Parser non disponibile per ${c.label} — mandami un sample (PDF o CSV) e te lo integro.`,
      }
    })
    return [...SPECIAL_OPTIONS, ...contoOpts]
  }, [conti])

  // Sincronizza con ?type=
  useEffect(() => {
    if (typeParam && allOptions.some(o => o.key === typeParam)) {
      setSelectedKey(typeParam)
    }
  }, [typeParam, allOptions])

  const current = allOptions.find(o => o.key === selectedKey) || SPECIAL_OPTIONS[0]

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setResult(null)
    }
  }

  const handleImport = async () => {
    if (!file) return
    if (!current.hasParser) {
      setResult({
        success: false,
        message: `Parser per "${current.label}" non ancora disponibile. Mandami il file (anche solo via chat) e lo integro nel prossimo deploy.`,
      })
      return
    }
    setLoading(true)
    setResult(null)
    try {
      let res: Response
      if (current.kind === 'conto') {
        // Upload via multipart (per PDF) o JSON (per CSV)
        const ep = CONTO_ENDPOINT[current.key]
        if (!ep) throw new Error('Endpoint conto non configurato')
        if (ep.format === 'pdf') {
          const form = new FormData()
          form.append('file', file)
          res = await fetch(ep.url, { method: 'POST', body: form })
        } else {
          const content = await file.text()
          res = await fetch(ep.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csvContent: content }),
          })
        }
      } else {
        // Special type
        const content = await file.text()
        let endpoint = ''
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let body: any = {}
        if (current.key === 'fatture_emesse' || current.key === 'fatture_ricevute') {
          endpoint = '/api/import/fatture-sdi'
          body = { csvContent: content, tipo: current.key === 'fatture_emesse' ? 'emessa' : 'ricevuta' }
        } else if (current.key === 'paypal_csv') {
          endpoint = '/api/import/paypal'
          body = { csvContent: content }
        }
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }
      const data = await res.json()
      if (res.ok) {
        const parts: string[] = []
        parts.push(`Importate ${data.imported} righe`)
        if (typeof data.skipped === 'number' && data.skipped > 0) parts.push(`${data.skipped} duplicati saltati`)
        if (typeof data.parsed === 'number' && data.parsed !== data.imported) parts.push(`(${data.parsed} totali nel file)`)
        if (data.periodo?.from) parts.push(`· periodo ${data.periodo.from} → ${data.periodo.to}`)
        setResult({ success: true, message: parts.join(' · ') })
        setFile(null)
      } else {
        setResult({ success: false, message: data.error || data.hint || 'Errore durante l\'import' })
      }
    } catch (err) {
      setResult({ success: false, message: String(err) })
    }
    setLoading(false)
  }

  const handleClearData = async (table: 'fatture' | 'transazioni') => {
    if (!confirm(`Sei sicuro di voler eliminare TUTTE le ${table}?`)) return
    setLoading(true)
    try {
      const res = await fetch(`/api/${table}`, { method: 'DELETE' })
      if (res.ok) setResult({ success: true, message: `Tutte le ${table} sono state eliminate` })
    } catch (err) {
      setResult({ success: false, message: String(err) })
    }
    setLoading(false)
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Import Dati</h1>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
        Seleziona la fonte e carica il file. Il parser, se disponibile, riconosce automaticamente il
        formato e inserisce le righe nel DB (idempotente: i duplicati vengono saltati).
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* CARD: Upload */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 dark:text-white">
            <Upload className="h-5 w-5" /> Importa
          </h2>

          {loadingConti ? (
            <p className="text-sm text-gray-500">Carico le fonti…</p>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Fonte
                </label>
                <select
                  value={selectedKey}
                  onChange={e => { setSelectedKey(e.target.value); setFile(null); setResult(null) }}
                  className="w-full border rounded-md px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  <optgroup label="Fatture">
                    {SPECIAL_OPTIONS.filter(o => o.key.startsWith('fatture')).map(o => (
                      <option key={o.key} value={o.key}>{o.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Movimenti bancari / carte">
                    {allOptions.filter(o => o.kind === 'conto' || o.key === 'paypal_csv').map(o => (
                      <option key={o.key} value={o.key}>
                        {o.label} {!o.hasParser ? '(parser non disponibile)' : ''}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Banner descrizione fonte selezionata */}
              <div className={`p-3 rounded-md border text-xs flex gap-2 items-start ${
                current.hasParser
                  ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                  : 'bg-amber-50 dark:bg-amber-950 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200'
              }`}>
                <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">{current.label}</p>
                  <p className="mt-0.5">{current.desc}</p>
                  {!current.hasParser && (
                    <p className="mt-2 text-amber-900 dark:text-amber-100 font-semibold">
                      ⚠ Per questa fonte il parser non è ancora pronto. Caricando il file qui ti viene
                      mostrato un avviso: mandami un sample (anche solo via chat) e te lo integro.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  File ({current.format.toUpperCase()})
                </label>
                <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
                  <input
                    type="file"
                    accept={current.format === 'pdf' ? '.pdf' : '.csv'}
                    onChange={handleFileChange}
                    className="hidden"
                    id="file-input"
                  />
                  <label htmlFor="file-input" className="cursor-pointer">
                    {file ? (
                      <div className="flex items-center justify-center gap-2">
                        <FileText className="h-6 w-6 text-indigo-600" />
                        <span className="font-medium dark:text-white">{file.name}</span>
                      </div>
                    ) : (
                      <div className="text-gray-500 dark:text-gray-400">
                        <Upload className="h-8 w-8 mx-auto mb-2" />
                        <p>Clicca per selezionare un file {current.format.toUpperCase()}</p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <button
                onClick={handleImport}
                disabled={!file || loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Importazione…' : 'Importa'}
              </button>
            </div>
          )}
        </div>

        {/* CARD: Info formati supportati */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 dark:text-white">Stato fonti</h2>
          <div className="space-y-2">
            {allOptions.map(o => (
              <div
                key={o.key}
                className={`p-3 rounded-md text-xs flex items-center gap-3 border ${
                  o.hasParser
                    ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800'
                    : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700'
                }`}
              >
                {o.hasParser ? (
                  <CheckCircle className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-gray-400 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium dark:text-white">{o.label}</p>
                  <p className="text-gray-500 dark:text-gray-400 text-[11px]">{o.desc}</p>
                </div>
                <span className={`text-[10px] uppercase font-bold rounded px-2 py-0.5 whitespace-nowrap ${
                  o.hasParser
                    ? 'bg-emerald-200 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-100'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}>
                  {o.hasParser ? '✓ ok' : 'manca'}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
            La lista delle fonti viene da <code>conti_config</code>. Aggiungi/rimuovi fonti dal wizard Step 1.
          </p>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className={`mt-6 p-4 rounded-lg flex items-center gap-3 ${
          result.success
            ? 'bg-green-50 border border-green-200 dark:bg-green-950 dark:border-green-800'
            : 'bg-red-50 border border-red-200 dark:bg-red-950 dark:border-red-800'
        }`}>
          {result.success
            ? <CheckCircle className="h-6 w-6 text-green-600" />
            : <AlertCircle className="h-6 w-6 text-red-600" />}
          <span className={result.success ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'}>
            {result.message}
          </span>
        </div>
      )}

      {/* Danger Zone */}
      <div className="mt-8 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-4 flex items-center gap-2">
          <Trash2 className="h-5 w-5" /> Zona Pericolo
        </h2>
        <p className="text-red-700 dark:text-red-300 text-sm mb-4">
          Queste azioni sono irreversibili. Usa con cautela.
        </p>
        <div className="flex gap-4">
          <button
            onClick={() => handleClearData('fatture')}
            disabled={loading}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md disabled:opacity-50"
          >
            Elimina tutte le fatture
          </button>
          <button
            onClick={() => handleClearData('transazioni')}
            disabled={loading}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md disabled:opacity-50"
          >
            Elimina tutte le transazioni
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ImportPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-gray-500">Caricamento…</div>}>
      <ImportPageInner />
    </Suspense>
  )
}
