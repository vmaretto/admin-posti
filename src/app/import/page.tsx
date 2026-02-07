'use client'

import { useState } from 'react'
import { Upload, FileText, CheckCircle, AlertCircle, Trash2 } from 'lucide-react'

type ImportType = 'fatture_emesse' | 'fatture_ricevute' | 'paypal'

export default function ImportPage() {
  const [selectedType, setSelectedType] = useState<ImportType>('fatture_emesse')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string; count?: number } | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setResult(null)
    }
  }

  const handleImport = async () => {
    if (!file) return
    
    setLoading(true)
    setResult(null)
    
    try {
      const content = await file.text()
      
      let endpoint = ''
      let body: Record<string, unknown> = {}
      
      if (selectedType === 'fatture_emesse' || selectedType === 'fatture_ricevute') {
        endpoint = '/api/import/fatture-sdi'
        body = {
          csvContent: content,
          tipo: selectedType === 'fatture_emesse' ? 'emessa' : 'ricevuta'
        }
      } else if (selectedType === 'paypal') {
        endpoint = '/api/import/paypal'
        body = { csvContent: content }
      }
      
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      
      const data = await res.json()
      
      if (res.ok) {
        setResult({
          success: true,
          message: `Importate ${data.imported} righe con successo`,
          count: data.imported
        })
        setFile(null)
      } else {
        setResult({
          success: false,
          message: data.error || 'Errore durante l\'import'
        })
      }
    } catch (err) {
      setResult({
        success: false,
        message: String(err)
      })
    }
    
    setLoading(false)
  }

  const handleClearData = async (table: 'fatture' | 'transazioni') => {
    if (!confirm(`Sei sicuro di voler eliminare TUTTE le ${table}?`)) return
    
    setLoading(true)
    try {
      const res = await fetch(`/api/${table}`, { method: 'DELETE' })
      if (res.ok) {
        setResult({
          success: true,
          message: `Tutte le ${table} sono state eliminate`
        })
      }
    } catch (err) {
      setResult({
        success: false,
        message: String(err)
      })
    }
    setLoading(false)
  }

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Import Dati</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Import Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Importa CSV
          </h2>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tipo di dati
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as ImportType)}
                className="w-full border rounded-md px-3 py-2"
              >
                <option value="fatture_emesse">Fatture Emesse (SDI)</option>
                <option value="fatture_ricevute">Fatture Ricevute (SDI)</option>
                <option value="paypal">Transazioni PayPal</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                File CSV
              </label>
              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileChange}
                  className="hidden"
                  id="file-input"
                />
                <label htmlFor="file-input" className="cursor-pointer">
                  {file ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText className="h-6 w-6 text-indigo-600" />
                      <span className="font-medium">{file.name}</span>
                    </div>
                  ) : (
                    <div className="text-gray-500">
                      <Upload className="h-8 w-8 mx-auto mb-2" />
                      <p>Clicca per selezionare un file CSV</p>
                    </div>
                  )}
                </label>
              </div>
            </div>
            
            <button
              onClick={handleImport}
              disabled={!file || loading}
              className="w-full bg-indigo-600 text-white py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Importazione...' : 'Importa'}
            </button>
          </div>
        </div>
        
        {/* Info Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Formati Supportati</h2>
          
          <div className="space-y-4 text-sm">
            <div className="p-4 bg-blue-50 rounded-lg">
              <h3 className="font-semibold text-blue-800 mb-2">Fatture SDI (Emesse/Ricevute)</h3>
              <p className="text-blue-700">
                CSV dal cassetto fiscale con separatore <code className="bg-blue-100 px-1 rounded">;</code>
              </p>
              <p className="text-blue-600 text-xs mt-1">
                Campi: Tipo, Numero, Data, PIVA, Denominazione, Imponibile, Imposta
              </p>
            </div>
            
            <div className="p-4 bg-green-50 rounded-lg">
              <h3 className="font-semibold text-green-800 mb-2">PayPal</h3>
              <p className="text-green-700">
                CSV export da PayPal con separatore <code className="bg-green-100 px-1 rounded">,</code>
              </p>
              <p className="text-green-600 text-xs mt-1">
                Campi: Data, Nome, Tipo, Stato, Netto, Codice transazione
              </p>
            </div>
            
            <div className="p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold text-gray-800 mb-2">Coming Soon</h3>
              <ul className="text-gray-600 list-disc list-inside">
                <li>Estratti conto Qonto (PDF)</li>
                <li>Estratti conto Wise (PDF)</li>
                <li>Estratti conto Banca Sella (PDF)</li>
                <li>Fatture estere (PDF)</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      
      {/* Result */}
      {result && (
        <div className={`mt-6 p-4 rounded-lg flex items-center gap-3 ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          {result.success ? (
            <CheckCircle className="h-6 w-6 text-green-600" />
          ) : (
            <AlertCircle className="h-6 w-6 text-red-600" />
          )}
          <span className={result.success ? 'text-green-800' : 'text-red-800'}>
            {result.message}
          </span>
        </div>
      )}
      
      {/* Danger Zone */}
      <div className="mt-8 bg-red-50 border border-red-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-red-800 mb-4 flex items-center gap-2">
          <Trash2 className="h-5 w-5" />
          Zona Pericolo
        </h2>
        <p className="text-red-700 text-sm mb-4">
          Queste azioni sono irreversibili. Usa con cautela.
        </p>
        <div className="flex gap-4">
          <button
            onClick={() => handleClearData('fatture')}
            disabled={loading}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            Elimina tutte le fatture
          </button>
          <button
            onClick={() => handleClearData('transazioni')}
            disabled={loading}
            className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            Elimina tutte le transazioni
          </button>
        </div>
      </div>
    </div>
  )
}
