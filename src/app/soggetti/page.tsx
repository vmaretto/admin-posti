'use client'

// Disabilita il prerender statico: la pagina usa useSearchParams() (richiede
// rendering dinamico) e dipende comunque da chiamate runtime al backend.
export const dynamic = 'force-dynamic'

import { useEffect, useState, useMemo, useRef, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { parsePeriodo, defaultPeriodoSlug } from '@/lib/periodo'
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Link2,
  Unlink,
  Zap,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  GripVertical,
  Check,
  X,
  Sparkles,
  Plus,
  GitMerge,
  Trash2,
  Receipt,
  RotateCcw,
  Archive,
  Pencil,
} from 'lucide-react'
import Link from 'next/link'

interface Fattura {
  id: string
  numero: string
  tipo: 'emessa' | 'ricevuta' | string
  tipo_documento?: 'fattura' | 'nota_credito' | string
  totale: number
  imponibile?: number
  imposta?: number
  data: string
  data_ricezione?: string | null
  stato: string
  denominazione_cliente?: string | null
  denominazione_fornitore?: string | null
  piva_cliente?: string | null
  piva_fornitore?: string | null
  fonte?: string | null
  note?: string | null
  transazione_id?: string
}

interface Transazione {
  id: string
  importo: number
  importo_signed?: number
  tipo: 'entrata' | 'uscita' | string
  data: string
  conto: string
  descrizione?: string
  controparte?: string
  riferimento?: string | null
  note?: string | null
  stato: string
  fatture_ids?: string[]
}

interface Soggetto {
  key: string // chiave normalizzata, identificatore unico
  denominazione: string
  fatture: Fattura[]
  transazioni: Transazione[]
  totaleFatture: number
  totaleTransazioni: number
  noteCreditoCount?: number
  saldo: number
  // Metriche di "scopertura" calcolate lato server (vedi /api/soggetti).
  transScoperteCount?: number
  transScoperteImporto?: number
  fattureScoperteCount?: number
  fattureScoperteImporto?: number
}

interface KpiData {
  transScoperte: { count: number; importoEntrate: number; importoUscite: number; totale: number }
  fattureScoperte: { count: number; importoAttive: number; importoPassive: number; totale: number }
  riconciliate: { transCount: number; fattureCount: number; importoTrans: number; importoFatture: number }
}

interface FatturaTralasciata {
  id: string
  numero: string
  tipo: string
  tipo_documento?: string
  totale: number
  data: string
  denominazione: string
  motivo: string
}

interface TransTralasciata {
  id: string
  importo: number
  tipo: string
  data: string
  conto: string
  descrizione?: string | null
  controparte?: string | null
  motivo: string
}

interface Orfana {
  id: string
  importo: number
  tipo: 'entrata' | 'uscita' | string
  data: string
  conto: string
  descrizione?: string | null
  controparte?: string | null
  stato: string
}

interface OrfanaGroup {
  key: string
  label: string
  varianti: string[]
  count: number
  totale: number
  suggestion: { soggetto: string; confidence: number } | null
  transazioni: Orfana[]
}

interface AuditSection {
  totalInDb: number
  totalFetched?: number
  inSoggetti: number
  inOrfani?: number
  inTralasciati: number
  accounted: number
  missing: number
  missingIds: string[]
}
interface Audit {
  transazioni: AuditSection
  fatture: AuditSection
}

interface SoggettiResponse {
  soggetti: Soggetto[]
  orfaneGroups: OrfanaGroup[]
  tralasciati?: { fatture: FatturaTralasciata[]; transazioni: TransTralasciata[] }
  audit?: Audit
  kpi?: KpiData
}

type DragSource =
  | { kind: 'fattura'; id: string; soggetto: string }
  | { kind: 'transazione'; id: string; soggetto: string }
  | null

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function formatDate(date: string): string {
  return format(new Date(date), 'dd MMM yyyy', { locale: it })
}

// Pulisce descrizioni/testi che a volte arrivano come stringa "false" o "null"
// (probabilmente import buggato dai CSV bancari). Se è uno di questi, ritorna ''.
function cleanText(s: string | null | undefined): string {
  if (!s) return ''
  const t = String(s).trim()
  if (!t) return ''
  const low = t.toLowerCase()
  if (low === 'false' || low === 'null' || low === 'undefined' || low === 'n/a') return ''
  return t
}

function TipoFatturaBadge({ tipo }: { tipo: string }) {
  if (tipo === 'emessa') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300" title="Fattura emessa (attiva)">
        <ArrowDownLeft className="h-3 w-3" /> Attiva
      </span>
    )
  }
  if (tipo === 'ricevuta') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300" title="Fattura ricevuta (passiva)">
        <ArrowUpRight className="h-3 w-3" /> Passiva
      </span>
    )
  }
  return null
}

function NotaCreditoBadge({ tipoDocumento }: { tipoDocumento?: string }) {
  if (tipoDocumento !== 'nota_credito') return null
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300"
      title="Nota di credito (storno)"
    >
      <Receipt className="h-3 w-3" /> NC
    </span>
  )
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="text-xs">
      <span className="text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}: </span>
      <span className="text-gray-900 dark:text-gray-100 font-medium">{value}</span>
    </div>
  )
}

function FatturaDetail({ f }: { f: Fattura }) {
  return (
    <div className="bg-gray-100 dark:bg-gray-900 rounded p-3 mt-1 grid grid-cols-2 gap-x-4 gap-y-1 border border-gray-200 dark:border-gray-700">
      <DetailField label="Numero" value={f.numero} />
      <DetailField label="Tipo" value={f.tipo === 'emessa' ? 'Attiva (emessa)' : 'Passiva (ricevuta)'} />
      <DetailField label="Documento" value={f.tipo_documento === 'nota_credito' ? 'Nota di credito' : 'Fattura'} />
      <DetailField label="Stato" value={f.stato.replace('_', ' ')} />
      <DetailField label="Data emissione" value={formatDate(f.data)} />
      {f.data_ricezione && <DetailField label="Data ricezione" value={formatDate(f.data_ricezione)} />}
      {f.tipo === 'emessa' ? (
        <>
          <DetailField label="Cliente" value={f.denominazione_cliente} />
          <DetailField label="P.IVA cliente" value={f.piva_cliente} />
        </>
      ) : (
        <>
          <DetailField label="Fornitore" value={f.denominazione_fornitore} />
          <DetailField label="P.IVA fornitore" value={f.piva_fornitore} />
        </>
      )}
      <DetailField label="Imponibile" value={typeof f.imponibile === 'number' ? formatCurrency(f.imponibile) : null} />
      <DetailField label="IVA" value={typeof f.imposta === 'number' ? formatCurrency(f.imposta) : null} />
      <DetailField label="Totale" value={formatCurrency(f.totale)} />
      <DetailField label="Fonte" value={f.fonte} />
      {f.note && (
        <div className="col-span-2 text-xs whitespace-pre-wrap break-words border-t pt-2 mt-1 dark:border-gray-700">
          <span className="text-gray-500 dark:text-gray-400 uppercase tracking-wide">Note: </span>
          <span className="text-gray-900 dark:text-gray-100">{f.note}</span>
        </div>
      )}
    </div>
  )
}

function TransazioneDetail({ t }: { t: Transazione }) {
  const importoSigned = typeof t.importo_signed === 'number' ? t.importo_signed : (t.tipo === 'entrata' ? t.importo : -t.importo)
  return (
    <div className="bg-gray-100 dark:bg-gray-900 rounded p-3 mt-1 grid grid-cols-2 gap-x-4 gap-y-1 border border-gray-200 dark:border-gray-700">
      <DetailField label="Conto" value={t.conto} />
      <DetailField label="Data" value={formatDate(t.data)} />
      <DetailField label="Tipo" value={t.tipo === 'entrata' ? 'Entrata' : 'Uscita'} />
      <DetailField label="Stato" value={t.stato.replace('_', ' ')} />
      <DetailField label="Importo" value={formatCurrency(importoSigned)} />
      <DetailField label="Controparte" value={cleanText(t.controparte)} />
      <DetailField label="Riferimento" value={cleanText(t.riferimento)} />
      {cleanText(t.descrizione) && (
        <div className="col-span-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400 uppercase tracking-wide">Descrizione: </span>
          <span className="text-gray-900 dark:text-gray-100 break-words">{cleanText(t.descrizione)}</span>
        </div>
      )}
      {t.note && (
        <div className="col-span-2 text-xs whitespace-pre-wrap break-words border-t pt-2 mt-1 dark:border-gray-700">
          <span className="text-gray-500 dark:text-gray-400 uppercase tracking-wide">Note: </span>
          <span className="text-gray-900 dark:text-gray-100">{t.note}</span>
        </div>
      )}
    </div>
  )
}

// Wrapper richiesto da Next.js 16: useSearchParams() dentro la pagina deve
// stare dentro un Suspense boundary, altrimenti il build (anche turbopack)
// fallisce con prerender-error.
export default function SoggettiPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-gray-500">Caricamento…</div>}>
      <SoggettiPageInner />
    </Suspense>
  )
}

function SoggettiPageInner() {
  // Periodo attivo (selezionato dal PeriodoPicker globale, vive in ?periodo=).
  const searchParams = useSearchParams()
  const periodo = useMemo(
    () => parsePeriodo(searchParams.get('periodo') || defaultPeriodoSlug()),
    [searchParams],
  )

  const [soggetti, setSoggetti] = useState<Soggetto[]>([])
  const [orfaneGroups, setOrfaneGroups] = useState<OrfanaGroup[]>([])
  const [tralasciati, setTralasciati] = useState<{ fatture: FatturaTralasciata[]; transazioni: TransTralasciata[] }>({ fatture: [], transazioni: [] })
  const [audit, setAudit] = useState<Audit | null>(null)
  const [kpi, setKpi] = useState<KpiData | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [tralasciatiOpen, setTralasciatiOpen] = useState(true)
  // Quali sotto-gruppi per motivo sono espansi nella sezione tralasciati
  const [tralasciatiMotivoOpen, setTralasciatiMotivoOpen] = useState<Set<string>>(new Set())
  function toggleTralasciatiMotivo(motivo: string) {
    setTralasciatiMotivoOpen(prev => {
      const next = new Set(prev)
      if (next.has(motivo)) next.delete(motivo)
      else next.add(motivo)
      return next
    })
  }
  // Riga espansa per dettagli inline: key = "f:{id}" o "t:{id}"
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  function toggleRowExpand(rowKey: string) {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(rowKey)) next.delete(rowKey)
      else next.add(rowKey)
      return next
    })
  }
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [soloNonRiconciliati, setSoloNonRiconciliati] = useState(false)
  // PRIORITÀ TRANS: di default mostro solo i soggetti che hanno transazioni
  // scoperte (cioè cash flow non documentato). L'utente può disattivare per
  // vedere tutto, incluse le fatture senza pagamento (poss. finanziamento socio).
  const [soloConTransScoperte, setSoloConTransScoperte] = useState(true)
  const [highlightFattura, setHighlightFattura] = useState<string | null>(null)
  const [highlightTransazione, setHighlightTransazione] = useState<string | null>(null)

  const dragSource = useRef<DragSource>(null)
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)

  const [autoMatching, setAutoMatching] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [orfaneOpen, setOrfaneOpen] = useState(true)

  // For "Crea nuovo soggetto" per group
  const [newSoggettoInput, setNewSoggettoInput] = useState<Record<string, string>>({})

  // Modal "Match con nota opzionale"
  const [matchModal, setMatchModal] = useState<{
    fatturaId: string
    transazioneId: string
    soggetto: string
    note: string
  } | null>(null)

  // Modal "Tralascia con motivazione"
  type IgnoraTarget =
    | { kind: 'group'; group: OrfanaGroup }
    | { kind: 'trans'; id: string; label: string; importo: number; data: string }
    | { kind: 'fattura'; id: string; label: string; importo: number; data: string }
    | { kind: 'soggetto'; soggetto: Soggetto }
    | { kind: 'multi-soggetto'; soggetti: Soggetto[] }
    | { kind: 'multi-righe'; fattureIds: string[]; transIds: string[] }
  const [ignoraModal, setIgnoraModal] = useState<{ target: IgnoraTarget; motivo: string; custom: string } | null>(null)

  // Modal "Accorpa soggetti" (1 a 1)
  const [mergeModal, setMergeModal] = useState<{ from: Soggetto; toDenom: string } | null>(null)

  // Modal "Accorpa N soggetti selezionati"
  const [multiMergeModal, setMultiMergeModal] = useState<{ from: Soggetto[]; toDenom: string } | null>(null)

  // Selezione multipla GRUPPI ORFANI (transazioni senza soggetto)
  const [selectedOrfani, setSelectedOrfani] = useState<Set<string>>(new Set())

  // Modal "Assegna N gruppi orfani al soggetto target"
  const [multiAssignModal, setMultiAssignModal] = useState<{ groups: OrfanaGroup[]; toDenom: string } | null>(null)

  // Selezione multipla di SINGOLE TRANSAZIONI orfane (dentro i gruppi espansi)
  const [selectedOrphanTrans, setSelectedOrphanTrans] = useState<Set<string>>(new Set())

  // Modal "Sposta N transazioni orfane sotto un soggetto"
  const [multiAssignTransModal, setMultiAssignTransModal] = useState<{ rows: Orfana[]; toDenom: string } | null>(null)

  // Modal "Sposta righe (fatture+trans) selezionate dentro soggetti in altro soggetto"
  const [moveRigheModal, setMoveRigheModal] = useState<{ fattureIds: string[]; transIds: string[]; toDenom: string } | null>(null)

  // Modal "Rinomina soggetto"
  const [renameModal, setRenameModal] = useState<{ soggetto: Soggetto; newName: string } | null>(null)

  // Selezione multipla di singole righe (fatture + transazioni) per bulk tralascia
  const [selectedFatture, setSelectedFatture] = useState<Set<string>>(new Set())
  const [selectedTrans, setSelectedTrans] = useState<Set<string>>(new Set())

  function toggleSelectFattura(id: string) {
    setSelectedFatture(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleSelectTrans(id: string) {
    setSelectedTrans(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function deselezionaTutteRighe() {
    setSelectedFatture(new Set())
    setSelectedTrans(new Set())
  }

  const MOTIVI_PREDEFINITI = [
    'Importo piccolo',
    'Spesa sbagliata',
    'Stipendi',
    'Imposte e tasse',
    'Commissioni bancarie',
    'Spostamento tra conti',
    'Movimento personale',
  ]

  function showFeedback(kind: 'ok' | 'err', text: string) {
    setFeedback({ kind, text })
    setTimeout(() => setFeedback(null), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Se il periodo ha un range, lo passo all'API per filtrare lato Supabase.
      let url = '/api/soggetti'
      if (periodo.from && periodo.to) {
        url += `?from=${periodo.from}&to=${periodo.to}`
      }
      const res = await fetch(url)
      const data: SoggettiResponse = await res.json()
      setSoggetti(data.soggetti || [])
      setOrfaneGroups(data.orfaneGroups || [])
      setTralasciati(data.tralasciati || { fatture: [], transazioni: [] })
      setAudit(data.audit || null)
      setKpi(data.kpi || null)
    } catch (e) {
      console.error(e)
      showFeedback('err', 'Errore nel caricamento')
    } finally {
      setLoading(false)
    }
  }, [periodo.from, periodo.to])

  function toggleSelectSoggetto(key: string) {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selezionaTuttiVisibili() {
    setSelectedKeys(new Set(filteredSoggetti.map(s => s.key)))
  }

  function deselezionaTutti() {
    setSelectedKeys(new Set())
  }

  function openIgnoraSelezionati() {
    if (selectedKeys.size === 0) return
    const selezionati = soggetti.filter(s => selectedKeys.has(s.key))
    if (selezionati.length === 0) return
    // Riusa il modal ignora con un kind multi
    setIgnoraModal({
      target: { kind: 'multi-soggetto', soggetti: selezionati },
      motivo: '',
      custom: '',
    })
  }

  function openMultiMerge() {
    if (selectedKeys.size < 2) {
      showFeedback('err', 'Seleziona almeno 2 soggetti per l’accorpamento')
      return
    }
    const selezionati = soggetti.filter(s => selectedKeys.has(s.key))
    if (selezionati.length < 2) return
    // Default target: il primo selezionato (in genere quello più "pulito" come nome)
    setMultiMergeModal({ from: selezionati, toDenom: '' })
  }

  async function submitMultiMerge() {
    if (!multiMergeModal) return
    const target = multiMergeModal.toDenom.trim()
    if (!target) {
      showFeedback('err', 'Indica il soggetto destinazione')
      return
    }
    try {
      // Tutte le fatture e transazioni dei N soggetti finiscono sotto il target
      const fattureIds = multiMergeModal.from.flatMap(s => s.fatture.map(f => f.id))
      const transIds = multiMergeModal.from.flatMap(s => s.transazioni.map(t => t.id))
      const fromKeys = multiMergeModal.from.map(s => s.key)
      const res = await fetch('/api/soggetti/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_keys: fromKeys,
          to: target,
          fattura_ids: fattureIds,
          transazione_ids: transIds,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback(
        'ok',
        `Accorpati ${multiMergeModal.from.length} soggetti in "${target}" (${data.fatture_aggiornate} fatture · ${data.transazioni_aggiornate} transazioni)`,
      )
      setMultiMergeModal(null)
      setSelectedKeys(new Set())
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  // ----- Selezione multipla gruppi orfani -----

  function toggleSelectOrfana(key: string) {
    setSelectedOrfani(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function selezionaTuttiOrfaniVisibili() {
    setSelectedOrfani(new Set(filteredOrfaneGroups.map(g => g.key)))
  }

  function deselezionaOrfani() {
    setSelectedOrfani(new Set())
  }

  function openMultiAssign() {
    if (selectedOrfani.size === 0) return
    const groups = filteredOrfaneGroups.filter(g => selectedOrfani.has(g.key))
    if (groups.length === 0) return
    setMultiAssignModal({ groups, toDenom: '' })
  }

  async function submitMultiAssign() {
    if (!multiAssignModal) return
    const target = multiAssignModal.toDenom.trim()
    if (!target) {
      showFeedback('err', 'Indica il soggetto destinazione')
      return
    }
    try {
      const transIds = multiAssignModal.groups.flatMap(g => g.transazioni.map(t => t.id))
      // createNew: true se il target non è già un soggetto esistente (autocompletamento miss)
      const isExisting = soggettiDenoms.some(d => d.toLowerCase().trim() === target.toLowerCase().trim())
      const res = await fetch('/api/transazioni/assign-soggetto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transazione_ids: transIds, soggetto: target, createNew: !isExisting }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback(
        'ok',
        `${transIds.length} transazioni di ${multiAssignModal.groups.length} gruppi assegnate a "${target}"`,
      )
      setMultiAssignModal(null)
      setSelectedOrfani(new Set())
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  function openIgnoraOrfaniSelezionati() {
    if (selectedOrfani.size === 0) return
    const groups = filteredOrfaneGroups.filter(g => selectedOrfani.has(g.key))
    if (groups.length === 0) return
    const transIds = groups.flatMap(g => g.transazioni.map(t => t.id))
    // Riuso il kind 'multi-righe' che già gestisce ignora batch di trans/fatture
    setIgnoraModal({
      target: { kind: 'multi-righe', fattureIds: [], transIds },
      motivo: '',
      custom: '',
    })
  }

  // ----- Selezione multipla di SINGOLE TRANSAZIONI ORFANE -----
  // (sottoinsieme di righe scelte all'interno dei gruppi, anche da gruppi diversi)

  function toggleSelectOrphanTrans(id: string) {
    setSelectedOrphanTrans(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function deselezionaOrphanTrans() {
    setSelectedOrphanTrans(new Set())
  }

  // Risale dalle trans selezionate alle righe Orfana (per riepilogo nel modal)
  function getSelectedOrphanRows(): Orfana[] {
    const all: Orfana[] = []
    for (const g of orfaneGroups) {
      for (const t of g.transazioni) {
        if (selectedOrphanTrans.has(t.id)) all.push(t)
      }
    }
    return all
  }

  function openMultiAssignTrans() {
    const rows = getSelectedOrphanRows()
    if (rows.length === 0) return
    setMultiAssignTransModal({ rows, toDenom: '' })
  }

  async function submitMultiAssignTrans() {
    if (!multiAssignTransModal) return
    const target = multiAssignTransModal.toDenom.trim()
    if (!target) {
      showFeedback('err', 'Indica il soggetto destinazione')
      return
    }
    try {
      const transIds = multiAssignTransModal.rows.map(t => t.id)
      const isExisting = soggettiDenoms.some(d => d.toLowerCase().trim() === target.toLowerCase().trim())
      const res = await fetch('/api/transazioni/assign-soggetto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transazione_ids: transIds, soggetto: target, createNew: !isExisting }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', `${transIds.length} transazioni assegnate a "${target}"`)
      setMultiAssignTransModal(null)
      setSelectedOrphanTrans(new Set())
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  function openIgnoraOrphanTransSelezionate() {
    if (selectedOrphanTrans.size === 0) return
    const transIds = Array.from(selectedOrphanTrans)
    setIgnoraModal({
      target: { kind: 'multi-righe', fattureIds: [], transIds },
      motivo: '',
      custom: '',
    })
  }

  async function ripristinaFattura(id: string) {
    try {
      const res = await fetch(`/api/fatture/ignora?ids=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', 'Fattura ripristinata')
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  async function ripristinaTransazione(id: string) {
    try {
      const res = await fetch(`/api/transazioni/ignora?ids=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', 'Transazione ripristinata')
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const toggleExpand = (denom: string) => {
    const next = new Set(expanded)
    if (next.has(denom)) next.delete(denom)
    else next.add(denom)
    setExpanded(next)
    if (!next.has(denom)) {
      setHighlightFattura(null)
      setHighlightTransazione(null)
    }
  }

  const toggleGroupExpand = (key: string) => {
    const next = new Set(expandedGroups)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setExpandedGroups(next)
  }

  const handleFatturaClick = (fattura: Fattura, transazioni: Transazione[]) => {
    const linked = transazioni.find(t => t.fatture_ids?.includes(fattura.id))
    if (linked) {
      setHighlightTransazione(linked.id)
      setHighlightFattura(fattura.id)
      setTimeout(() => {
        setHighlightTransazione(null)
        setHighlightFattura(null)
      }, 3000)
    }
  }

  const handleTransazioneClick = (transazione: Transazione) => {
    if (transazione.fatture_ids && transazione.fatture_ids.length > 0) {
      setHighlightFattura(transazione.fatture_ids[0])
      setHighlightTransazione(transazione.id)
      setTimeout(() => {
        setHighlightFattura(null)
        setHighlightTransazione(null)
      }, 3000)
    }
  }

  // ---- Drag & Drop ----
  const onDragStart = (src: NonNullable<DragSource>, e: React.DragEvent) => {
    dragSource.current = src
    e.dataTransfer.effectAllowed = 'link'
    e.dataTransfer.setData('text/plain', `${src.kind}:${src.id}`)
  }
  const onDragEnd = () => {
    dragSource.current = null
    setDropTargetId(null)
  }
  function canDrop(src: NonNullable<DragSource>, target: NonNullable<DragSource>): { ok: boolean; reason?: string } {
    if (src.kind === target.kind) return { ok: false, reason: 'Trascina una fattura su una transazione (o viceversa)' }
    if (src.soggetto !== target.soggetto) return { ok: false, reason: 'Soggetto diverso: non si può abbinare' }
    return { ok: true }
  }
  const onDragOver = (target: NonNullable<DragSource>, e: React.DragEvent) => {
    const src = dragSource.current
    if (!src) return
    if (canDrop(src, target).ok) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'link'
      setDropTargetId(target.id)
    }
  }
  const onDragLeave = (target: NonNullable<DragSource>) => {
    if (dropTargetId === target.id) setDropTargetId(null)
  }
  const onDrop = async (target: NonNullable<DragSource>, e: React.DragEvent) => {
    e.preventDefault()
    const src = dragSource.current
    setDropTargetId(null)
    dragSource.current = null
    if (!src) return
    const check = canDrop(src, target)
    if (!check.ok) {
      showFeedback('err', check.reason || 'Operazione non valida')
      return
    }
    const fatturaId = src.kind === 'fattura' ? src.id : target.id
    const transazioneId = src.kind === 'transazione' ? src.id : target.id
    // Apri il modal per chiedere una nota (opzionale)
    setMatchModal({ fatturaId, transazioneId, soggetto: target.soggetto, note: '' })
  }

  async function confirmMatch(skipNote = false) {
    if (!matchModal) return
    try {
      const body: { fatturaId: string; transazioneId: string; note?: string } = {
        fatturaId: matchModal.fatturaId,
        transazioneId: matchModal.transazioneId,
      }
      if (!skipNote && matchModal.note.trim()) body.note = matchModal.note.trim()
      const res = await fetch('/api/riconcilia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', body.note ? 'Match creato con nota' : 'Match creato')
      setMatchModal(null)
      await load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore nel match'
      showFeedback('err', msg)
    }
  }

  async function handleUnmatch(fatturaId: string) {
    if (!confirm('Vuoi davvero scollegare questa fattura dalla transazione?')) return
    try {
      const res = await fetch(`/api/riconcilia?fatturaId=${fatturaId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', 'Match rimosso')
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  async function handleAutoMatch() {
    setAutoMatching(true)
    try {
      const res = await fetch('/api/riconcilia/auto', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', `Match automatici: ${data.matched || 0}`)
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    } finally {
      setAutoMatching(false)
    }
  }

  async function assignGroupToSoggetto(group: OrfanaGroup, soggetto: string, createNew = false) {
    try {
      const ids = group.transazioni.map(t => t.id)
      const res = await fetch('/api/transazioni/assign-soggetto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transazione_ids: ids, soggetto, createNew }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', `${ids.length} transazioni assegnate a "${soggetto}"`)
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  function openIgnoraGroup(group: OrfanaGroup) {
    setIgnoraModal({ target: { kind: 'group', group }, motivo: '', custom: '' })
  }

  function openIgnoraTrans(t: Orfana | Transazione, controparte?: string) {
    setIgnoraModal({
      target: {
        kind: 'trans',
        id: t.id,
        label: ('controparte' in t ? t.controparte : controparte) || (t as Orfana).descrizione || t.conto,
        importo: t.importo,
        data: t.data,
      },
      motivo: '',
      custom: '',
    })
  }

  function openIgnoraFattura(f: Fattura) {
    setIgnoraModal({
      target: {
        kind: 'fattura',
        id: f.id,
        label: f.numero,
        importo: f.totale,
        data: f.data,
      },
      motivo: '',
      custom: '',
    })
  }

  function openIgnoraSoggetto(s: Soggetto) {
    setIgnoraModal({
      target: { kind: 'soggetto', soggetto: s },
      motivo: '',
      custom: '',
    })
  }

  function openMergeModal(s: Soggetto) {
    setMergeModal({ from: s, toDenom: '' })
  }

  function openRenameModal(s: Soggetto) {
    setRenameModal({ soggetto: s, newName: s.denominazione })
  }

  async function submitRename() {
    if (!renameModal) return
    const newName = renameModal.newName.trim()
    if (!newName || newName === renameModal.soggetto.denominazione) {
      setRenameModal(null)
      return
    }
    try {
      // Riusa /api/soggetti/merge: sposta tutte le righe del soggetto verso il nuovo nome
      const res = await fetch('/api/soggetti/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_key: renameModal.soggetto.key,
          to: newName,
          fattura_ids: renameModal.soggetto.fatture.map(f => f.id),
          transazione_ids: renameModal.soggetto.transazioni.map(t => t.id),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', `Soggetto rinominato in "${newName}" (${data.fatture_aggiornate} fatture, ${data.transazioni_aggiornate} transazioni)`)
      setRenameModal(null)
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  function openIgnoraRigheSelezionate() {
    const fattureIds = Array.from(selectedFatture)
    const transIds = Array.from(selectedTrans)
    if (fattureIds.length === 0 && transIds.length === 0) return
    setIgnoraModal({
      target: { kind: 'multi-righe', fattureIds, transIds },
      motivo: '',
      custom: '',
    })
  }

  function openMoveRigheSelezionate() {
    const fattureIds = Array.from(selectedFatture)
    const transIds = Array.from(selectedTrans)
    if (fattureIds.length === 0 && transIds.length === 0) return
    setMoveRigheModal({ fattureIds, transIds, toDenom: '' })
  }

  async function submitMoveRighe() {
    if (!moveRigheModal) return
    const target = moveRigheModal.toDenom.trim()
    if (!target) {
      showFeedback('err', 'Indica il soggetto destinazione')
      return
    }
    try {
      const isExisting = soggettiDenoms.some(d => d.toLowerCase().trim() === target.toLowerCase().trim())
      const calls: Promise<Response>[] = []
      // Transazioni: cambio della controparte → uso /api/transazioni/assign-soggetto
      if (moveRigheModal.transIds.length > 0) {
        calls.push(fetch('/api/transazioni/assign-soggetto', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transazione_ids: moveRigheModal.transIds,
            soggetto: target,
            createNew: !isExisting,
          }),
        }))
      }
      // Fatture: cambio denominazione cliente/fornitore → /api/soggetti/merge con fattura_ids
      if (moveRigheModal.fattureIds.length > 0) {
        calls.push(fetch('/api/soggetti/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: target,
            fattura_ids: moveRigheModal.fattureIds,
          }),
        }))
      }
      const results = await Promise.all(calls)
      for (const r of results) {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          throw new Error(d.error || `Errore ${r.status}`)
        }
      }
      showFeedback(
        'ok',
        `Spostati ${moveRigheModal.fattureIds.length} fatture e ${moveRigheModal.transIds.length} transazioni in "${target}"`,
      )
      setMoveRigheModal(null)
      deselezionaTutteRighe()
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  async function submitMerge() {
    if (!mergeModal || !mergeModal.toDenom) return
    try {
      const res = await fetch('/api/soggetti/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_key: mergeModal.from.key,
          to: mergeModal.toDenom,
          fattura_ids: mergeModal.from.fatture.map(f => f.id),
          transazione_ids: mergeModal.from.transazioni.map(t => t.id),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', `Accorpati: ${data.fatture_aggiornate} fatture e ${data.transazioni_aggiornate} transazioni in "${mergeModal.toDenom}"`)
      setMergeModal(null)
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  async function submitIgnora() {
    if (!ignoraModal) return
    const motivoFinal = ignoraModal.motivo === 'Altro' ? ignoraModal.custom.trim() : ignoraModal.motivo
    if (!motivoFinal) {
      showFeedback('err', 'Seleziona o scrivi una motivazione')
      return
    }
    try {
      if (ignoraModal.target.kind === 'multi-righe') {
        const fattureIds = ignoraModal.target.fattureIds
        const transIds = ignoraModal.target.transIds
        const calls: Promise<Response>[] = []
        if (fattureIds.length > 0) {
          calls.push(fetch('/api/fatture/ignora', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fattura_ids: fattureIds, motivo: motivoFinal }),
          }))
        }
        if (transIds.length > 0) {
          calls.push(fetch('/api/transazioni/ignora', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transazione_ids: transIds, motivo: motivoFinal }),
          }))
        }
        const results = await Promise.all(calls)
        for (const r of results) {
          if (!r.ok) {
            const d = await r.json().catch(() => ({}))
            throw new Error(d.error || `Errore ${r.status}`)
          }
        }
        showFeedback('ok', `Tralasciate ${fattureIds.length} fatture e ${transIds.length} transazioni (${motivoFinal})`)
        setIgnoraModal(null)
        deselezionaTutteRighe()
        setSelectedOrfani(new Set()) // ramo riusato anche dall'azione bulk sui gruppi orfani
        setSelectedOrphanTrans(new Set()) // e dall'azione bulk sulle singole righe orfane
        await load()
        return
      }

      if (ignoraModal.target.kind === 'multi-soggetto') {
        // Tralascia molti soggetti in batch
        const fattureIds = ignoraModal.target.soggetti.flatMap(s => s.fatture.map(f => f.id))
        const transIds = ignoraModal.target.soggetti.flatMap(s => s.transazioni.map(t => t.id))
        const calls: Promise<Response>[] = []
        if (fattureIds.length > 0) {
          calls.push(fetch('/api/fatture/ignora', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fattura_ids: fattureIds, motivo: motivoFinal }),
          }))
        }
        if (transIds.length > 0) {
          calls.push(fetch('/api/transazioni/ignora', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transazione_ids: transIds, motivo: motivoFinal }),
          }))
        }
        const results = await Promise.all(calls)
        for (const r of results) {
          if (!r.ok) {
            const d = await r.json().catch(() => ({}))
            throw new Error(d.error || `Errore ${r.status}`)
          }
        }
        const n = ignoraModal.target.soggetti.length
        showFeedback('ok', `${n} soggetti tralasciati: ${fattureIds.length} fatture + ${transIds.length} transazioni (${motivoFinal})`)
        setIgnoraModal(null)
        setSelectedKeys(new Set())
        await load()
        return
      }

      if (ignoraModal.target.kind === 'soggetto') {
        // Tralascia intero soggetto: batch su fatture e transazioni in parallelo
        const fattureIds = ignoraModal.target.soggetto.fatture.map(f => f.id)
        const transIds = ignoraModal.target.soggetto.transazioni.map(t => t.id)
        const calls: Promise<Response>[] = []
        if (fattureIds.length > 0) {
          calls.push(fetch('/api/fatture/ignora', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fattura_ids: fattureIds, motivo: motivoFinal }),
          }))
        }
        if (transIds.length > 0) {
          calls.push(fetch('/api/transazioni/ignora', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transazione_ids: transIds, motivo: motivoFinal }),
          }))
        }
        const results = await Promise.all(calls)
        for (const r of results) {
          if (!r.ok) {
            const d = await r.json().catch(() => ({}))
            throw new Error(d.error || `Errore ${r.status}`)
          }
        }
        showFeedback('ok', `Soggetto "${ignoraModal.target.soggetto.denominazione}" tralasciato: ${fattureIds.length} fatture + ${transIds.length} transazioni (${motivoFinal})`)
        setIgnoraModal(null)
        await load()
        return
      }

      let url = ''
      let body: object = {}
      let count = 0
      let label = ''
      if (ignoraModal.target.kind === 'group') {
        url = '/api/transazioni/ignora'
        const ids = ignoraModal.target.group.transazioni.map(t => t.id)
        body = { transazione_ids: ids, motivo: motivoFinal }
        count = ids.length
        label = count === 1 ? 'transazione tralasciata' : 'transazioni tralasciate'
      } else if (ignoraModal.target.kind === 'trans') {
        url = '/api/transazioni/ignora'
        body = { transazione_ids: [ignoraModal.target.id], motivo: motivoFinal }
        count = 1
        label = 'transazione tralasciata'
      } else {
        url = '/api/fatture/ignora'
        body = { fattura_ids: [ignoraModal.target.id], motivo: motivoFinal }
        count = 1
        label = 'fattura tralasciata'
      }
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Errore')
      showFeedback('ok', `${count} ${label} (${motivoFinal})`)
      setIgnoraModal(null)
      await load()
    } catch (err: unknown) {
      showFeedback('err', err instanceof Error ? err.message : 'Errore')
    }
  }

  const filteredSoggetti = useMemo(() => soggetti.filter(s => {
    if (search) {
      const q = search.toLowerCase()
      // Match su denominazione del soggetto, oppure su qualsiasi numero/importo/controparte
      // delle sue fatture/transazioni
      const inDenom = s.denominazione.toLowerCase().includes(q)
      const inFatture = s.fatture.some(f =>
        (f.numero || '').toLowerCase().includes(q) ||
        String(f.totale).includes(q) ||
        (f.denominazione_cliente || '').toLowerCase().includes(q) ||
        (f.denominazione_fornitore || '').toLowerCase().includes(q)
      )
      const inTrans = s.transazioni.some(t =>
        (t.controparte || '').toLowerCase().includes(q) ||
        (t.descrizione || '').toLowerCase().includes(q) ||
        String(t.importo).includes(q)
      )
      if (!inDenom && !inFatture && !inTrans) return false
    }
    if (soloNonRiconciliati) {
      // Mostra solo soggetti che hanno almeno una fattura o transazione "da_riconciliare"
      // (le riconciliate e le tralasciate non contano).
      const hasDaRic =
        s.fatture.some(f => f.stato === 'da_riconciliare') ||
        s.transazioni.some(t => t.stato === 'da_riconciliare')
      if (!hasDaRic) return false
    }
    if (soloConTransScoperte) {
      // PRIORITÀ TRANS: nascondi i soggetti che hanno tutte le transazioni
      // riconciliate (o nessuna transazione). Le fatture scoperte da sole
      // non bastano a tenere visibile un soggetto, perché potrebbero essere
      // coperte da finanziamento socio.
      if ((s.transScoperteCount ?? 0) === 0) return false
    }
    return true
  }), [soggetti, search, soloNonRiconciliati, soloConTransScoperte])

  const soggettiDenoms = useMemo(
    () => soggetti.map(s => s.denominazione).sort((a, b) => a.localeCompare(b)),
    [soggetti]
  )

  // Filtro globale: la search box filtra anche orfani e tralasciati (per ritrovare
  // facilmente transazioni 'fantasma' come 'olio' che non appaiono nei soggetti).
  const filteredOrfaneGroups = useMemo(() => {
    if (!search) return orfaneGroups
    const q = search.toLowerCase()
    return orfaneGroups.filter(g =>
      g.label.toLowerCase().includes(q) ||
      g.varianti.some(v => v.toLowerCase().includes(q)) ||
      g.transazioni.some(t =>
        (t.descrizione || '').toLowerCase().includes(q) ||
        (t.controparte || '').toLowerCase().includes(q) ||
        String(t.importo).includes(q)
      )
    )
  }, [orfaneGroups, search])

  // Definito dopo (vedi useMemo). L'effect che apre la sezione tralasciati
  // automaticamente quando la ricerca matcha lì è messo subito dopo la
  // dichiarazione di filteredTralasciati.

  const filteredTralasciati = useMemo(() => {
    if (!search) return tralasciati
    const q = search.toLowerCase()
    return {
      fatture: tralasciati.fatture.filter(f =>
        f.numero.toLowerCase().includes(q) ||
        (f.denominazione || '').toLowerCase().includes(q) ||
        (f.motivo || '').toLowerCase().includes(q) ||
        String(f.totale).includes(q)
      ),
      transazioni: tralasciati.transazioni.filter(t =>
        (t.controparte || '').toLowerCase().includes(q) ||
        (t.descrizione || '').toLowerCase().includes(q) ||
        (t.motivo || '').toLowerCase().includes(q) ||
        String(t.importo).includes(q)
      ),
    }
  }, [tralasciati, search])

  // Quando l'utente cerca e i match sono nei tralasciati, apri la sezione
  // automaticamente così non deve scrollare al buio. Apro anche i sotto-gruppi
  // per motivo che contengono almeno un match.
  useEffect(() => {
    const nMatchTral = filteredTralasciati.fatture.length + filteredTralasciati.transazioni.length
    if (search && nMatchTral > 0) {
      setTralasciatiOpen(true)
      const motivi = new Set<string>()
      for (const f of filteredTralasciati.fatture) motivi.add(f.motivo || '__SENZA_MOTIVO__')
      for (const t of filteredTralasciati.transazioni) motivi.add(t.motivo || '__SENZA_MOTIVO__')
      setTralasciatiMotivoOpen(prev => {
        const next = new Set(prev)
        motivi.forEach(m => next.add(m))
        return next
      })
    }
  }, [search, filteredTralasciati])

  // Raggruppa i tralasciati per motivazione. Dentro ogni gruppo, le righe
  // sono già ordinate per importo DESC dal backend. I gruppi a loro volta
  // sono ordinati per importo aggregato DESC (il più "pesante" in cima).
  type TralasciatiPerMotivo = {
    motivo: string
    label: string // "Stipendi", "Importo piccolo"... o "(Senza motivo)"
    fatture: FatturaTralasciata[]
    transazioni: TransTralasciata[]
    totale: number
    count: number
  }
  const tralasciatiByMotivo = useMemo<TralasciatiPerMotivo[]>(() => {
    const map = new Map<string, TralasciatiPerMotivo>()
    const get = (motivo: string) => {
      const key = motivo || '__SENZA_MOTIVO__'
      if (!map.has(key)) {
        map.set(key, {
          motivo: key,
          label: motivo || '(Senza motivo)',
          fatture: [],
          transazioni: [],
          totale: 0,
          count: 0,
        })
      }
      return map.get(key)!
    }
    for (const f of filteredTralasciati.fatture) {
      const g = get(f.motivo || '')
      g.fatture.push(f)
      g.totale += Math.abs(f.totale || 0)
      g.count++
    }
    for (const t of filteredTralasciati.transazioni) {
      const g = get(t.motivo || '')
      g.transazioni.push(t)
      g.totale += Math.abs(t.importo || 0)
      g.count++
    }
    return Array.from(map.values()).sort((a, b) => b.totale - a.totale)
  }, [filteredTralasciati])

  // DEEP SEARCH: scansiona tutto l'oggetto response (soggetti, orfani, tralasciati)
  // per qualsiasi match testuale o importo. Restituisce la posizione esatta.
  // Risolve dubbi tipo "l'audit dice X righe ma io non le trovo da nessuna parte".
  type DeepHit = {
    kind: 'trans' | 'fattura'
    where: string
    summary: string
    id: string
  }
  const deepSearchResults = useMemo<DeepHit[]>(() => {
    if (!search) return []
    const q = search.toLowerCase().trim()
    if (!q) return []
    const hits: DeepHit[] = []
    const matchesText = (...fields: (string | number | null | undefined)[]) =>
      fields.some(f => f != null && String(f).toLowerCase().includes(q))

    for (const s of soggetti) {
      for (const t of s.transazioni) {
        if (matchesText(t.controparte, t.descrizione, t.riferimento, t.note, t.importo, t.importo_signed, t.id)) {
          hits.push({
            kind: 'trans',
            where: `Soggetto: ${s.denominazione}`,
            summary: `${formatDate(t.data)} · ${t.conto} · ${t.tipo === 'entrata' ? '+' : '-'}${formatCurrency(Math.abs(t.importo))} · ${t.controparte || '—'} · stato ${t.stato}`,
            id: t.id,
          })
        }
      }
      for (const f of s.fatture) {
        if (matchesText(f.numero, f.totale, f.denominazione_cliente, f.denominazione_fornitore, f.note, f.id)) {
          hits.push({
            kind: 'fattura',
            where: `Soggetto: ${s.denominazione}`,
            summary: `${f.numero} · ${formatDate(f.data)} · ${f.tipo} · ${formatCurrency(f.totale)} · stato ${f.stato}`,
            id: f.id,
          })
        }
      }
    }
    for (const g of orfaneGroups) {
      for (const t of g.transazioni) {
        if (matchesText(t.controparte, t.descrizione, t.importo, t.id)) {
          hits.push({
            kind: 'trans',
            where: `Orfani: ${g.label}`,
            summary: `${formatDate(t.data)} · ${t.conto} · ${t.tipo === 'entrata' ? '+' : '-'}${formatCurrency(Math.abs(t.importo))} · ${t.controparte || '—'}`,
            id: t.id,
          })
        }
      }
    }
    for (const t of tralasciati.transazioni) {
      if (matchesText(t.controparte, t.descrizione, t.motivo, t.importo, t.id)) {
        hits.push({
          kind: 'trans',
          where: `Tralasciati (motivo: ${t.motivo || '—'})`,
          summary: `${formatDate(t.data)} · ${t.conto} · ${t.tipo === 'entrata' ? '+' : '-'}${formatCurrency(Math.abs(t.importo))} · ${t.controparte || '—'}`,
          id: t.id,
        })
      }
    }
    for (const f of tralasciati.fatture) {
      if (matchesText(f.numero, f.denominazione, f.motivo, f.totale, f.id)) {
        hits.push({
          kind: 'fattura',
          where: `Tralasciati (motivo: ${f.motivo || '—'})`,
          summary: `${f.numero} · ${formatDate(f.data)} · ${f.tipo} · ${formatCurrency(f.totale)}`,
          id: f.id,
        })
      }
    }
    return hits
  }, [search, soggetti, orfaneGroups, tralasciati])

  const orfaneTotal = useMemo(
    () => filteredOrfaneGroups.reduce((s, g) => s + g.totale, 0),
    [filteredOrfaneGroups]
  )
  const orfaneCount = useMemo(
    () => filteredOrfaneGroups.reduce((s, g) => s + g.count, 0),
    [filteredOrfaneGroups]
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Vista per Soggetto</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Periodo: <strong className="text-indigo-600 dark:text-indigo-400">{periodo.label}</strong>
            {periodo.from && periodo.to && (
              <span className="ml-1 text-gray-400">({periodo.from} → {periodo.to})</span>
            )}
          </p>
        </div>
        <button
          onClick={handleAutoMatch}
          disabled={autoMatching || loading}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-md shadow-sm"
        >
          <Zap className="h-4 w-4" />
          {autoMatching ? 'Match in corso...' : 'Match automatici'}
        </button>
      </div>

      {feedback && (
        <div className={`mb-4 px-4 py-2 rounded-md text-sm font-medium ${
          feedback.kind === 'ok'
            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
        }`}>
          {feedback.text}
        </div>
      )}

      {/* KPI HERO: 3 card con priorità "transazioni scoperte" (rosso) per primo.
          Le fatture scoperte sono giallo perché potrebbero essere coperte da
          finanziamento socio / spese personali del socio. */}
      {kpi && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          {/* ROSSO — transazioni scoperte: cash flow non documentato, vero problema */}
          <div className="bg-red-50 dark:bg-red-950 border-2 border-red-300 dark:border-red-700 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
                  Transazioni scoperte
                </p>
                <p className="text-3xl font-bold text-red-900 dark:text-red-100 mt-1 leading-none">
                  {kpi.transScoperte.count}
                </p>
                <p className="text-xs text-red-800 dark:text-red-200 mt-2 font-medium">
                  {formatCurrency(kpi.transScoperte.totale)}
                </p>
              </div>
              <AlertTriangle className="h-7 w-7 text-red-600 dark:text-red-400 flex-shrink-0" />
            </div>
            <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-800 flex justify-between text-xs">
              <span className="text-green-700 dark:text-green-400 font-medium" title="Soldi entrati senza una fattura emessa">
                ↗ Entrate {formatCurrency(kpi.transScoperte.importoEntrate)}
              </span>
              <span className="text-red-700 dark:text-red-400 font-medium" title="Soldi usciti senza una fattura ricevuta">
                ↘ Uscite {formatCurrency(kpi.transScoperte.importoUscite)}
              </span>
            </div>
            <p className="text-[10px] text-red-600 dark:text-red-400 mt-2 italic">
              Cash flow non documentato — chiede una fattura
            </p>
          </div>

          {/* GIALLO — fatture senza pagamento: informativo, possibile finanziamento socio */}
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                  Fatture senza pagamento
                </p>
                <p className="text-3xl font-bold text-amber-900 dark:text-amber-100 mt-1 leading-none">
                  {kpi.fattureScoperte.count}
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-200 mt-2 font-medium">
                  {formatCurrency(kpi.fattureScoperte.totale)}
                </p>
              </div>
              <Receipt className="h-7 w-7 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            </div>
            <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-800 flex justify-between text-xs">
              <span className="text-emerald-700 dark:text-emerald-400 font-medium" title="Attive emesse non ancora incassate">
                ↘ Att. {formatCurrency(kpi.fattureScoperte.importoAttive)}
              </span>
              <span className="text-orange-700 dark:text-orange-400 font-medium" title="Passive ricevute non ancora pagate dal conto aziendale">
                ↗ Pas. {formatCurrency(kpi.fattureScoperte.importoPassive)}
              </span>
            </div>
            <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-2 italic">
              Le passive senza pagamento possono essere finanziamento socio
            </p>
          </div>

          {/* VERDE — già riconciliate, info per contesto */}
          <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-300 dark:border-emerald-700 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  Riconciliate
                </p>
                <p className="text-3xl font-bold text-emerald-900 dark:text-emerald-100 mt-1 leading-none">
                  {kpi.riconciliate.transCount}
                </p>
                <p className="text-xs text-emerald-800 dark:text-emerald-200 mt-2 font-medium">
                  trans · {kpi.riconciliate.fattureCount} fatture
                </p>
              </div>
              <Check className="h-7 w-7 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
            </div>
            <div className="mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800 flex justify-between text-xs">
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                Σ trans {formatCurrency(kpi.riconciliate.importoTrans)}
              </span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                Σ fatt {formatCurrency(kpi.riconciliate.importoFatture)}
              </span>
            </div>
            <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-2 italic">
              Cash flow documentato e abbinato
            </p>
          </div>
        </div>
      )}

      {/* Audit conteggi: verifica che tutte le trans e fatture in DB siano contabilizzate */}
      {audit && (() => {
        const tOk = audit.transazioni.missing === 0
        const fOk = audit.fatture.missing === 0
        const allOk = tOk && fOk
        return (
          <div className={`mb-4 px-4 py-2 rounded-md text-xs font-mono flex items-center justify-between gap-4 flex-wrap ${
            allOk
              ? 'bg-green-50 dark:bg-green-950 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800'
              : 'bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200 border-2 border-red-300 dark:border-red-700'
          }`}>
            <span className="flex items-center gap-1">
              {allOk ? '✓' : '⚠️'} <strong>Audit:</strong>
            </span>
            <span>
              Trans {audit.transazioni.totalInDb} in DB ={' '}
              <span className="text-indigo-700 dark:text-indigo-300">{audit.transazioni.inSoggetti} soggetti</span>
              {' + '}
              <span className="text-amber-700 dark:text-amber-300">{audit.transazioni.inOrfani} orfani</span>
              {' + '}
              <span className="text-gray-600 dark:text-gray-400">{audit.transazioni.inTralasciati} tralasciate</span>
              {' = '}
              <strong>{audit.transazioni.accounted}</strong>
              {audit.transazioni.missing > 0 && (
                <span className="text-red-700 dark:text-red-300 font-bold"> · MANCANTI {audit.transazioni.missing} (es. {audit.transazioni.missingIds.slice(0, 3).join(', ')}{audit.transazioni.missingIds.length > 3 ? '…' : ''})</span>
              )}
            </span>
            <span>
              Fatture {audit.fatture.totalInDb} in DB ={' '}
              <span className="text-indigo-700 dark:text-indigo-300">{audit.fatture.inSoggetti} soggetti</span>
              {' + '}
              <span className="text-gray-600 dark:text-gray-400">{audit.fatture.inTralasciati} tralasciate</span>
              {' = '}
              <strong>{audit.fatture.accounted}</strong>
              {audit.fatture.missing > 0 && (
                <span className="text-red-700 dark:text-red-300 font-bold"> · MANCANTI {audit.fatture.missing}</span>
              )}
            </span>
          </div>
        )
      })()}

      {/* Selection toolbar — soggetti */}
      {selectedKeys.size > 0 && (
        <div className="sticky top-2 z-40 mb-4 bg-indigo-600 text-white rounded-md shadow-lg px-4 py-2 flex items-center justify-between gap-4 flex-wrap">
          <span className="font-medium text-sm">
            {selectedKeys.size} {selectedKeys.size === 1 ? 'soggetto selezionato' : 'soggetti selezionati'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={selezionaTuttiVisibili}
              className="px-3 py-1 bg-indigo-500 hover:bg-indigo-400 rounded text-xs font-medium"
            >
              Seleziona tutti i visibili
            </button>
            <button
              onClick={deselezionaTutti}
              className="px-3 py-1 bg-indigo-500 hover:bg-indigo-400 rounded text-xs font-medium"
            >
              Deseleziona
            </button>
            <button
              onClick={openMultiMerge}
              disabled={selectedKeys.size < 2}
              className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-medium"
              title={selectedKeys.size < 2 ? 'Servono almeno 2 soggetti' : 'Accorpa i selezionati in un unico soggetto'}
            >
              <GitMerge className="h-3 w-3" /> Accorpa selezionati…
            </button>
            <button
              onClick={openIgnoraSelezionati}
              className="inline-flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-white rounded text-xs font-medium"
            >
              <Trash2 className="h-3 w-3" /> Tralascia selezionati…
            </button>
          </div>
        </div>
      )}

      {/* Selection toolbar — righe individuali */}
      {(selectedFatture.size > 0 || selectedTrans.size > 0) && (
        <div className="sticky top-2 z-40 mb-4 bg-purple-600 text-white rounded-md shadow-lg px-4 py-2 flex items-center justify-between gap-4 flex-wrap">
          <span className="font-medium text-sm">
            {selectedFatture.size} fatture · {selectedTrans.size} transazioni selezionate
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={deselezionaTutteRighe}
              className="px-3 py-1 bg-purple-500 hover:bg-purple-400 rounded text-xs font-medium"
            >
              Deseleziona
            </button>
            <button
              onClick={openMoveRigheSelezionate}
              className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-white rounded text-xs font-medium"
              title="Sposta queste righe in un altro soggetto (esistente o nuovo)"
            >
              <GitMerge className="h-3 w-3" /> Sposta in soggetto…
            </button>
            <button
              onClick={openIgnoraRigheSelezionate}
              className="inline-flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-white rounded text-xs font-medium"
            >
              <Trash2 className="h-3 w-3" /> Tralascia righe…
            </button>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6 flex gap-4 items-center flex-wrap">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca soggetto, numero fattura, importo, controparte…"
          className="flex-1 border rounded-md px-4 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white min-w-[200px]"
        />
        {search && (
          <span className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
            Risultati per <strong>&quot;{search}&quot;</strong>: <strong>{filteredSoggetti.length}</strong> soggetti · <strong>{filteredOrfaneGroups.length}</strong> gruppi orfani · <strong>{filteredTralasciati.fatture.length + filteredTralasciati.transazioni.length}</strong> tralasciate · <strong>{deepSearchResults.length}</strong> match esatti
          </span>
        )}
        <label className="flex items-center gap-2 cursor-pointer" title="Nasconde i soggetti che hanno tutte le transazioni riconciliate. Le fatture senza pagamento da sole non bastano a tenere visibile un soggetto (potrebbero essere coperte da finanziamento socio).">
          <input
            type="checkbox"
            checked={soloConTransScoperte}
            onChange={(e) => setSoloConTransScoperte(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-red-600"
          />
          <span className="text-sm font-semibold text-red-700 dark:text-red-300">Solo con trans scoperte</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={soloNonRiconciliati}
            onChange={(e) => setSoloNonRiconciliati(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600"
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Solo con non riconciliati</span>
        </label>
      </div>

      {/* DEEP SEARCH PANEL: mostra ogni singolo record che matcha il search e la sua posizione esatta */}
      {search && deepSearchResults.length > 0 && (
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md p-3 mb-4">
          <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-2">
            🔍 Trovati {deepSearchResults.length} match esatti per &quot;{search}&quot;:
          </p>
          <ul className="space-y-1 max-h-60 overflow-y-auto text-xs font-mono">
            {deepSearchResults.map((h, idx) => (
              <li key={`${h.kind}:${h.id}:${idx}`} className="text-blue-900 dark:text-blue-200">
                <span className="text-blue-700 dark:text-blue-300 font-semibold">[{h.kind === 'trans' ? 'TRANS' : 'FATT'}]</span>
                {' '}
                <span className="text-purple-700 dark:text-purple-300">{h.where}</span>
                <br />
                <span className="ml-12 text-gray-700 dark:text-gray-300">→ {h.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-md px-4 py-3 mb-4 text-sm text-indigo-900 dark:text-indigo-100">
        <strong>Suggerimento:</strong> trascina una fattura su una transazione (o viceversa) all&apos;interno dello stesso soggetto per crearne il match. Le transazioni senza soggetto vanno prima assegnate dalla sezione qui sotto.
      </div>

      {/* Selection toolbar — gruppi orfani */}
      {selectedOrfani.size > 0 && (() => {
        const groups = filteredOrfaneGroups.filter(g => selectedOrfani.has(g.key))
        const totTrans = groups.reduce((s, g) => s + g.transazioni.length, 0)
        const totImp = groups.reduce((s, g) => s + g.totale, 0)
        return (
          <div className="sticky top-2 z-40 mb-4 bg-amber-600 text-white rounded-md shadow-lg px-4 py-2 flex items-center justify-between gap-4 flex-wrap">
            <span className="font-medium text-sm">
              {groups.length} {groups.length === 1 ? 'gruppo orfano selezionato' : 'gruppi orfani selezionati'} · {totTrans} transazioni · {formatCurrency(totImp)}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={selezionaTuttiOrfaniVisibili}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 rounded text-xs font-medium"
              >
                Seleziona tutti i visibili
              </button>
              <button
                onClick={deselezionaOrfani}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 rounded text-xs font-medium"
              >
                Deseleziona
              </button>
              <button
                onClick={openMultiAssign}
                className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-white rounded text-xs font-medium"
                title="Assegna tutte le transazioni dei gruppi selezionati a un unico soggetto"
              >
                <GitMerge className="h-3 w-3" /> Accorpa in soggetto…
              </button>
              <button
                onClick={openIgnoraOrfaniSelezionati}
                className="inline-flex items-center gap-1 px-3 py-1 bg-red-500 hover:bg-red-400 text-white rounded text-xs font-medium"
                title="Tralascia tutte le transazioni dei gruppi selezionati"
              >
                <Trash2 className="h-3 w-3" /> Tralascia selezionati…
              </button>
            </div>
          </div>
        )
      })()}

      {/* Selection toolbar — SINGOLE righe orfane */}
      {selectedOrphanTrans.size > 0 && (() => {
        const rows = getSelectedOrphanRows()
        const totImp = rows.reduce((s, r) => s + Math.abs(r.importo), 0)
        return (
          <div className="sticky top-2 z-40 mb-4 bg-orange-600 text-white rounded-md shadow-lg px-4 py-2 flex items-center justify-between gap-4 flex-wrap">
            <span className="font-medium text-sm">
              {rows.length} transazioni orfane selezionate · {formatCurrency(totImp)}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={deselezionaOrphanTrans}
                className="px-3 py-1 bg-orange-500 hover:bg-orange-400 rounded text-xs font-medium"
              >
                Deseleziona
              </button>
              <button
                onClick={openMultiAssignTrans}
                className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-white rounded text-xs font-medium"
                title="Sposta queste transazioni sotto un soggetto (esistente o nuovo)"
              >
                <GitMerge className="h-3 w-3" /> Sposta in soggetto…
              </button>
              <button
                onClick={openIgnoraOrphanTransSelezionate}
                className="inline-flex items-center gap-1 px-3 py-1 bg-red-500 hover:bg-red-400 text-white rounded text-xs font-medium"
                title="Tralascia le transazioni selezionate"
              >
                <Trash2 className="h-3 w-3" /> Tralascia selezionate…
              </button>
            </div>
          </div>
        )
      })()}

      {/* Orphan groups */}
      {filteredOrfaneGroups.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow mb-6 border-l-4 border-amber-500">
          <button
            onClick={() => setOrfaneOpen(o => !o)}
            className="w-full px-6 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <div className="flex items-center gap-3 text-left">
              {orfaneOpen ? <ChevronDown className="h-5 w-5 text-amber-500" /> : <ChevronRight className="h-5 w-5 text-amber-500" />}
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">
                  Transazioni senza soggetto · {filteredOrfaneGroups.length} gruppi · {orfaneCount} transazioni
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Totale aggregato {formatCurrency(orfaneTotal)} · ordinati per importo decrescente
                </p>
              </div>
            </div>
          </button>
          {orfaneOpen && (
            <div className="border-t dark:border-gray-700 divide-y dark:divide-gray-700">
              {filteredOrfaneGroups.map(group => {
                const isOpen = expandedGroups.has(group.key)
                const newInput = newSoggettoInput[group.key] || ''
                const isSelected = selectedOrfani.has(group.key)
                return (
                  <div key={group.key} className={`px-4 py-3 ${isSelected ? 'bg-amber-50 dark:bg-amber-950/30 ring-2 ring-amber-400 ring-inset' : ''}`}>
                    {/* Group header */}
                    <div className="flex items-start gap-3 flex-wrap">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectOrfana(group.key)}
                        className="mt-1.5 h-4 w-4 rounded border-gray-300 text-amber-600 flex-shrink-0"
                        title="Seleziona per accorpare/tralasciare in batch"
                      />
                      <button
                        onClick={() => toggleGroupExpand(group.key)}
                        className="mt-1 text-gray-400 hover:text-gray-600"
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900 dark:text-white truncate" title={group.label}>
                            {group.label}
                          </span>
                          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded">
                            {group.count} {group.count === 1 ? 'transazione' : 'transazioni'}
                          </span>
                          <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                            {formatCurrency(group.totale)}
                          </span>
                        </div>
                        {group.varianti.length > 1 && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                            Varianti: {group.varianti.slice(0, 3).join(' · ')}{group.varianti.length > 3 ? ` · +${group.varianti.length - 3}` : ''}
                          </p>
                        )}

                        {/* Suggestion */}
                        {group.suggestion && (
                          <div className="mt-2 flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded px-3 py-1.5">
                            <Sparkles className="h-4 w-4 text-indigo-500" />
                            <span className="text-sm text-indigo-900 dark:text-indigo-100">
                              Probabilmente è <strong>{group.suggestion.soggetto}</strong>
                            </span>
                            <span className="text-xs bg-indigo-600 text-white px-2 py-0.5 rounded font-semibold">
                              {group.suggestion.confidence}%
                            </span>
                            <button
                              onClick={() => assignGroupToSoggetto(group, group.suggestion!.soggetto)}
                              className="ml-auto inline-flex items-center gap-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded"
                            >
                              <Check className="h-3 w-3" /> Approva
                            </button>
                          </div>
                        )}

                        {/* Actions row */}
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              const val = e.target.value
                              if (val) assignGroupToSoggetto(group, val)
                              e.currentTarget.value = ''
                            }}
                            className="text-xs border rounded px-2 py-1 dark:bg-gray-800 dark:border-gray-600 dark:text-white max-w-[220px]"
                          >
                            <option value="">Assegna a soggetto esistente…</option>
                            {soggettiDenoms.map(d => (
                              <option key={d} value={d}>{d}</option>
                            ))}
                          </select>

                          <div className="flex items-center gap-1">
                            <input
                              type="text"
                              placeholder="Nome nuovo soggetto"
                              value={newInput}
                              onChange={(e) => setNewSoggettoInput(prev => ({ ...prev, [group.key]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newInput.trim()) {
                                  assignGroupToSoggetto(group, newInput.trim(), true)
                                  setNewSoggettoInput(prev => ({ ...prev, [group.key]: '' }))
                                }
                              }}
                              className="text-xs border rounded px-2 py-1 dark:bg-gray-800 dark:border-gray-600 dark:text-white w-44"
                            />
                            <button
                              onClick={() => {
                                if (newInput.trim()) {
                                  assignGroupToSoggetto(group, newInput.trim(), true)
                                  setNewSoggettoInput(prev => ({ ...prev, [group.key]: '' }))
                                }
                              }}
                              disabled={!newInput.trim()}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-medium rounded"
                              title="Crea nuovo soggetto"
                            >
                              <Plus className="h-3 w-3" /> Crea
                            </button>
                          </div>

                          <button
                            onClick={() => openIgnoraGroup(group)}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-xs font-medium rounded"
                            title="Tralascia tutto il gruppo"
                          >
                            <X className="h-3 w-3" /> Tralascia gruppo…
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded transactions */}
                    {isOpen && (
                      <div className="mt-3 ml-7 space-y-1 max-h-64 overflow-y-auto">
                        {group.transazioni.map(t => {
                          const isTransSelected = selectedOrphanTrans.has(t.id)
                          return (
                            <div
                              key={t.id}
                              className={`flex items-center gap-3 text-xs rounded px-2 py-1.5 ${
                                isTransSelected
                                  ? 'bg-orange-100 dark:bg-orange-950/40 ring-1 ring-orange-400'
                                  : 'bg-gray-50 dark:bg-gray-900'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isTransSelected}
                                onChange={() => toggleSelectOrphanTrans(t.id)}
                                className="h-3.5 w-3.5 rounded border-gray-300 text-orange-600 flex-shrink-0"
                                title="Seleziona questa transazione (azione in batch)"
                              />
                              <span className="font-medium capitalize text-gray-900 dark:text-white">{t.conto}</span>
                              <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(t.data)}</span>
                              <span className={`font-medium whitespace-nowrap ${t.tipo === 'entrata' ? 'text-green-600' : 'text-red-600'}`}>
                                {t.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(t.importo))}
                              </span>
                              <span className="text-gray-600 dark:text-gray-300 truncate flex-1" title={cleanText(t.controparte) || cleanText(t.descrizione) || ''}>
                                {cleanText(t.controparte) || cleanText(t.descrizione) || <em className="text-gray-400">—</em>}
                              </span>
                              <button
                                onClick={() => openIgnoraTrans(t)}
                                className="text-gray-400 hover:text-red-600"
                                title="Tralascia questa transazione (con motivazione)"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                              <Link href={`/transazioni?id=${t.id}`}>
                                <ExternalLink className="h-3 w-3 text-gray-400 hover:text-indigo-600" />
                              </Link>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredSoggetti.map((soggetto) => (
            <div key={soggetto.key} className={`bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden ${selectedKeys.has(soggetto.key) ? 'ring-2 ring-indigo-500' : ''}`}>
              <div
                className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                onClick={() => toggleExpand(soggetto.denominazione)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(soggetto.key)}
                    onChange={(e) => { e.stopPropagation(); toggleSelectSoggetto(soggetto.key) }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 flex-shrink-0"
                    title="Seleziona per azioni in batch"
                  />
                  {expanded.has(soggetto.denominazione)
                    ? <ChevronDown className="h-5 w-5 text-gray-400 flex-shrink-0" />
                    : <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white truncate flex items-center gap-2 flex-wrap">
                      {soggetto.denominazione}
                      {/* BADGE PROMINENTE: trans scoperte (priorità #1) */}
                      {(soggetto.transScoperteCount ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide rounded bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200 border border-red-300 dark:border-red-700"
                          title="Transazioni di questo soggetto che non hanno una fattura corrispondente"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          {soggetto.transScoperteCount} trans scoperte · {formatCurrency(soggetto.transScoperteImporto || 0)}
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2 flex-wrap">
                      <span>{soggetto.fatture.length} fatture · {soggetto.transazioni.length} transazioni</span>
                      {soggetto.noteCreditoCount && soggetto.noteCreditoCount > 0 ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold uppercase rounded bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300">
                          <Receipt className="h-3 w-3" /> {soggetto.noteCreditoCount} NC
                        </span>
                      ) : null}
                      {/* Counter grigio: fatture senza pagamento (priorità #2, info) */}
                      {(soggetto.fattureScoperteCount ?? 0) > 0 && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          title="Fatture di questo soggetto senza pagamento collegato (poss. finanziamento socio)"
                        >
                          <Receipt className="h-3 w-3" /> {soggetto.fattureScoperteCount} fatt. senza pagamento
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="text-right flex items-center gap-4">
                  {(() => {
                    // 4 valori contestuali (Att./Pas./Entr./Usc.) per chi vuole il dettaglio.
                    let attive = 0, passive = 0
                    for (const f of soggetto.fatture) {
                      const sign = f.tipo_documento === 'nota_credito' ? -1 : 1
                      const val = sign * (f.totale || 0)
                      if (f.tipo === 'emessa') attive += val
                      else if (f.tipo === 'ricevuta') passive += val
                    }
                    let entrate = 0, uscite = 0
                    for (const t of soggetto.transazioni) {
                      const v = Math.abs(t.importo || 0)
                      if (t.tipo === 'entrata') entrate += v
                      else if (t.tipo === 'uscita') uscite += v
                    }
                    // PRIORITÀ TRANS — sostituisco l'unico "Saldo Aperto" con due valori
                    // espliciti, separati per gravità:
                    //   1) Da coprire con fatture (ROSSO) = trans scoperte
                    //      Questo è il vero gap: cash in/out non documentato.
                    //   2) Eccedenza fatture (GRIGIO) = fatture senza pagamento
                    //      Probabile finanziamento socio o pagamento personale.
                    const daCoprire = soggetto.transScoperteImporto || 0
                    const eccedenza = soggetto.fattureScoperteImporto || 0
                    return (
                      <div className="flex gap-5 items-start">
                        <div className="text-right min-w-[110px]">
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Fatture</p>
                          <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium whitespace-nowrap">↘ Att. +{formatCurrency(attive).replace('€','').trim()} €</p>
                          <p className="text-xs text-orange-600 dark:text-orange-400 font-medium whitespace-nowrap">↗ Pas. −{formatCurrency(passive).replace('€','').trim()} €</p>
                        </div>
                        <div className="text-right min-w-[110px]">
                          <p className="text-[10px] text-gray-500 dark:text-gray-400 uppercase tracking-wide">Transazioni</p>
                          <p className="text-xs text-green-600 font-medium whitespace-nowrap">↗ Entr. +{formatCurrency(entrate).replace('€','').trim()} €</p>
                          <p className="text-xs text-red-600 font-medium whitespace-nowrap">↘ Usc. −{formatCurrency(uscite).replace('€','').trim()} €</p>
                        </div>
                        <div className="text-right min-w-[150px] border-l border-gray-200 dark:border-gray-700 pl-3">
                          <p className="text-[10px] uppercase tracking-wide text-red-700 dark:text-red-300 font-semibold" title="Importo di transazioni senza una fattura corrispondente">Da coprire</p>
                          <p className={`font-bold whitespace-nowrap text-base leading-tight ${daCoprire > 0 ? 'text-red-700 dark:text-red-300' : 'text-gray-400 dark:text-gray-500'}`}>
                            {daCoprire > 0 ? formatCurrency(daCoprire) : '—'}
                          </p>
                          <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-1.5" title="Fatture senza un pagamento collegato — possibile finanziamento socio">Eccedenza fatt.</p>
                          <p className={`text-xs whitespace-nowrap ${eccedenza > 0 ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}`}>
                            {eccedenza > 0 ? formatCurrency(eccedenza) : '—'}
                          </p>
                        </div>
                      </div>
                    )
                  })()}
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); openRenameModal(soggetto) }}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-gray-700 dark:text-gray-200 text-xs font-medium rounded whitespace-nowrap"
                      title="Rinomina soggetto"
                    >
                      <Pencil className="h-3 w-3" /> Rinomina…
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openMergeModal(soggetto) }}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-indigo-100 dark:hover:bg-indigo-900 text-gray-700 dark:text-gray-200 text-xs font-medium rounded whitespace-nowrap"
                      title="Accorpa con un altro soggetto"
                    >
                      <GitMerge className="h-3 w-3" /> Accorpa…
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openIgnoraSoggetto(soggetto) }}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-amber-100 dark:hover:bg-amber-900 text-gray-700 dark:text-gray-200 text-xs font-medium rounded whitespace-nowrap"
                      title="Tralascia intero soggetto"
                    >
                      <Trash2 className="h-3 w-3" /> Tralascia…
                    </button>
                  </div>
                </div>
              </div>

              {expanded.has(soggetto.denominazione) && (
                <div className="border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900 px-6 py-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Fatture */}
                    <div>
                      <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Fatture</h4>
                      <div className="space-y-1">
                        {soggetto.fatture.length === 0 ? (
                          <p className="text-sm text-gray-400">Nessuna fattura</p>
                        ) : (
                          soggetto.fatture.map((f) => {
                            const isLinked = soggetto.transazioni.some(t => t.fatture_ids?.includes(f.id))
                            const isHighlighted = highlightFattura === f.id
                            const isDropTarget = dropTargetId === f.id
                            const draggable = !isLinked
                            const rowKey = `f:${f.id}`
                            const isExpanded = expandedRows.has(rowKey)
                            return (
                              <div key={f.id}>
                              <div
                                onClick={() => toggleRowExpand(rowKey)}
                                draggable={draggable}
                                onDragStart={(e) => draggable && onDragStart({ kind: 'fattura', id: f.id, soggetto: soggetto.denominazione }, e)}
                                onDragEnd={onDragEnd}
                                onDragOver={(e) => onDragOver({ kind: 'fattura', id: f.id, soggetto: soggetto.denominazione }, e)}
                                onDragLeave={() => onDragLeave({ kind: 'fattura', id: f.id, soggetto: soggetto.denominazione })}
                                onDrop={(e) => onDrop({ kind: 'fattura', id: f.id, soggetto: soggetto.denominazione }, e)}
                                className={`flex justify-between items-center text-sm rounded px-3 py-2 transition group cursor-pointer ${
                                  isDropTarget
                                    ? 'bg-indigo-100 dark:bg-indigo-900 ring-2 ring-indigo-500'
                                    : isHighlighted
                                    ? 'bg-yellow-200 dark:bg-yellow-900 ring-2 ring-yellow-400'
                                    : 'bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-gray-700'
                                } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={selectedFatture.has(f.id)}
                                    onChange={(e) => { e.stopPropagation(); toggleSelectFattura(f.id) }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-3.5 w-3.5 rounded border-gray-300 text-purple-600 flex-shrink-0"
                                    title="Seleziona riga"
                                  />
                                  {draggable && <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />}
                                  {isLinked && (
                                    <button
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleFatturaClick(f, soggetto.transazioni) }}
                                      className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400"
                                      title="Mostra transazione collegata"
                                    >
                                      <Link2 className="h-4 w-4" />
                                    </button>
                                  )}
                                  <TipoFatturaBadge tipo={f.tipo} />
                                  <NotaCreditoBadge tipoDocumento={f.tipo_documento} />
                                  <span className="font-medium dark:text-white truncate">{f.numero}</span>
                                  <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(f.data)}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className={`px-1.5 py-0.5 text-xs rounded ${
                                    f.stato === 'riconciliata' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                                    f.stato === 'da_riconciliare' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                                    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                  }`}>{f.stato.replace('_', ' ')}</span>
                                  <span className="font-medium text-gray-900 dark:text-white whitespace-nowrap">{formatCurrency(f.totale)}</span>
                                  {isLinked ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleUnmatch(f.id) }}
                                      className="text-gray-400 hover:text-red-600"
                                      title="Scollega"
                                    >
                                      <Unlink className="h-3.5 w-3.5" />
                                    </button>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openIgnoraFattura(f) }}
                                      className="text-gray-400 hover:text-amber-600"
                                      title="Tralascia con motivazione"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              {isExpanded && <FatturaDetail f={f} />}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>

                    {/* Transazioni */}
                    <div>
                      <h4 className="font-medium text-gray-700 dark:text-gray-300 mb-2">Transazioni</h4>
                      <div className="space-y-1">
                        {soggetto.transazioni.length === 0 ? (
                          <p className="text-sm text-gray-400">Nessuna transazione</p>
                        ) : (
                          soggetto.transazioni.map((t) => {
                            const isLinked = !!(t.fatture_ids && t.fatture_ids.length > 0)
                            const isHighlighted = highlightTransazione === t.id
                            const isDropTarget = dropTargetId === t.id
                            const draggable = !isLinked
                            const rowKey = `t:${t.id}`
                            const isExpanded = expandedRows.has(rowKey)
                            return (
                              <div key={t.id}>
                              <div
                                onClick={() => toggleRowExpand(rowKey)}
                                draggable={draggable}
                                onDragStart={(e) => draggable && onDragStart({ kind: 'transazione', id: t.id, soggetto: soggetto.denominazione }, e)}
                                onDragEnd={onDragEnd}
                                onDragOver={(e) => onDragOver({ kind: 'transazione', id: t.id, soggetto: soggetto.denominazione }, e)}
                                onDragLeave={() => onDragLeave({ kind: 'transazione', id: t.id, soggetto: soggetto.denominazione })}
                                onDrop={(e) => onDrop({ kind: 'transazione', id: t.id, soggetto: soggetto.denominazione }, e)}
                                className={`flex justify-between items-center text-sm rounded px-3 py-2 transition group cursor-pointer ${
                                  isDropTarget
                                    ? 'bg-indigo-100 dark:bg-indigo-900 ring-2 ring-indigo-500'
                                    : isHighlighted
                                    ? 'bg-yellow-200 dark:bg-yellow-900 ring-2 ring-yellow-400'
                                    : 'bg-white dark:bg-gray-800 hover:bg-indigo-50 dark:hover:bg-gray-700'
                                } ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={selectedTrans.has(t.id)}
                                    onChange={(e) => { e.stopPropagation(); toggleSelectTrans(t.id) }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="h-3.5 w-3.5 rounded border-gray-300 text-purple-600 flex-shrink-0"
                                    title="Seleziona riga"
                                  />
                                  {draggable && <GripVertical className="h-4 w-4 text-gray-300 flex-shrink-0" />}
                                  {isLinked && (
                                    <button
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleTransazioneClick(t) }}
                                      className="text-indigo-500 hover:text-indigo-700 dark:text-indigo-400"
                                      title="Mostra fattura collegata"
                                    >
                                      <Link2 className="h-4 w-4" />
                                    </button>
                                  )}
                                  <span className="font-medium capitalize dark:text-white whitespace-nowrap">{t.conto}</span>
                                  <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">{formatDate(t.data)}</span>
                                  {cleanText(t.descrizione) && (
                                    <span className="text-gray-500 dark:text-gray-400 truncate" title={cleanText(t.descrizione)}>
                                      · {cleanText(t.descrizione)}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className={`px-1.5 py-0.5 text-xs rounded ${
                                    t.stato === 'riconciliata' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                                    t.stato === 'da_riconciliare' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300' :
                                    'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                                  }`}>{t.stato.replace('_', ' ')}</span>
                                  <span className={`font-medium whitespace-nowrap ${t.tipo === 'entrata' ? 'text-green-600' : 'text-red-600'}`}>
                                    {t.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(t.importo))}
                                  </span>
                                  {isLinked && t.fatture_ids && t.fatture_ids[0] ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleUnmatch(t.fatture_ids![0]) }}
                                      className="text-gray-400 hover:text-red-600"
                                      title="Scollega"
                                    >
                                      <Unlink className="h-3.5 w-3.5" />
                                    </button>
                                  ) : (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openIgnoraTrans(t, soggetto.denominazione) }}
                                      className="text-gray-400 hover:text-amber-600"
                                      title="Tralascia con motivazione"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              {isExpanded && <TransazioneDetail t={t} />}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}

          {filteredSoggetti.length === 0 && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              {soloConTransScoperte && soggetti.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-emerald-700 dark:text-emerald-300 font-medium">
                    ✓ Nessun soggetto con transazioni scoperte fra quelli visibili.
                  </p>
                  <p className="text-xs">
                    Tutte le transazioni sono coperte. Disattiva &quot;Solo con trans scoperte&quot; per vedere anche i soggetti con sole fatture senza pagamento.
                  </p>
                </div>
              ) : (
                <span>Nessun soggetto trovato</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sezione Tralasciati */}
      {(filteredTralasciati.fatture.length > 0 || filteredTralasciati.transazioni.length > 0) && (
        <div className="mt-6 bg-white dark:bg-gray-800 rounded-lg shadow border-l-4 border-gray-400">
          <button
            onClick={() => setTralasciatiOpen(o => !o)}
            className="w-full px-6 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <div className="flex items-center gap-3 text-left">
              {tralasciatiOpen ? <ChevronDown className="h-5 w-5 text-gray-500" /> : <ChevronRight className="h-5 w-5 text-gray-500" />}
              <Archive className="h-5 w-5 text-gray-500" />
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">
                  Tralasciati · {tralasciatiByMotivo.length} {tralasciatiByMotivo.length === 1 ? 'motivazione' : 'motivazioni'} · {filteredTralasciati.fatture.length} fatture · {filteredTralasciati.transazioni.length} transazioni
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Voci escluse dalla riconciliazione, raggruppate per motivazione e ordinate per importo. Puoi ripristinarle.
                </p>
              </div>
            </div>
          </button>
          {tralasciatiOpen && (
            <div className="border-t dark:border-gray-700 divide-y dark:divide-gray-700">
              {/* Raggruppamento per motivazione: gruppi più "pesanti" (€) in cima,
                  ogni gruppo collassabile, righe interne per importo DESC. */}
              {tralasciatiByMotivo.map(g => {
                const isOpen = tralasciatiMotivoOpen.has(g.motivo)
                return (
                  <div key={g.motivo} className="px-4 py-3">
                    <button
                      onClick={() => toggleTralasciatiMotivo(g.motivo)}
                      className="w-full flex items-center gap-3 text-left hover:opacity-80"
                    >
                      {isOpen ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
                      <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                        {g.label}
                      </span>
                      <span className="text-sm text-gray-700 dark:text-gray-200">
                        {g.fatture.length > 0 && <span>{g.fatture.length} fatture</span>}
                        {g.fatture.length > 0 && g.transazioni.length > 0 && <span> · </span>}
                        {g.transazioni.length > 0 && <span>{g.transazioni.length} transazioni</span>}
                      </span>
                      <span className="ml-auto text-sm font-bold text-gray-900 dark:text-white">
                        {formatCurrency(g.totale)}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="mt-3 ml-7 space-y-3">
                        {g.fatture.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                              Fatture ({g.fatture.length})
                            </p>
                            <div className="space-y-1 max-h-64 overflow-y-auto">
                              {g.fatture.map(f => (
                                <div key={f.id} className="flex flex-wrap items-center gap-2 text-sm bg-gray-50 dark:bg-gray-900 rounded px-3 py-2">
                                  <TipoFatturaBadge tipo={f.tipo} />
                                  <NotaCreditoBadge tipoDocumento={f.tipo_documento} />
                                  <Link href={`/fatture?id=${f.id}`} className="font-medium hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400">
                                    {f.numero}
                                  </Link>
                                  <span className="text-gray-500 dark:text-gray-400">{formatDate(f.data)}</span>
                                  <span className="text-gray-600 dark:text-gray-300 truncate max-w-xs" title={f.denominazione}>{f.denominazione}</span>
                                  <span className="ml-auto font-bold text-gray-900 dark:text-white whitespace-nowrap">{formatCurrency(f.totale)}</span>
                                  <button
                                    onClick={() => ripristinaFattura(f.id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-100 dark:bg-indigo-900 hover:bg-indigo-200 dark:hover:bg-indigo-800 text-indigo-700 dark:text-indigo-200 text-xs font-medium rounded"
                                    title="Annulla tralascio"
                                  >
                                    <RotateCcw className="h-3 w-3" /> Ripristina
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {g.transazioni.length > 0 && (
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                              Transazioni ({g.transazioni.length})
                            </p>
                            <div className="space-y-1 max-h-64 overflow-y-auto">
                              {g.transazioni.map(t => (
                                <div key={t.id} className="flex flex-wrap items-center gap-2 text-sm bg-gray-50 dark:bg-gray-900 rounded px-3 py-2">
                                  <span className="font-medium capitalize text-gray-900 dark:text-white">{t.conto}</span>
                                  <span className="text-gray-500 dark:text-gray-400">{formatDate(t.data)}</span>
                                  <span className={`font-medium whitespace-nowrap ${t.tipo === 'entrata' ? 'text-green-600' : 'text-red-600'}`}>
                                    {t.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(t.importo))}
                                  </span>
                                  <span className="text-gray-600 dark:text-gray-300 truncate max-w-xs" title={cleanText(t.controparte) || cleanText(t.descrizione) || ''}>
                                    {cleanText(t.controparte) || cleanText(t.descrizione) || <em className="text-gray-400">—</em>}
                                  </span>
                                  <button
                                    onClick={() => ripristinaTransazione(t.id)}
                                    className="ml-auto inline-flex items-center gap-1 px-2 py-1 bg-indigo-100 dark:bg-indigo-900 hover:bg-indigo-200 dark:hover:bg-indigo-800 text-indigo-700 dark:text-indigo-200 text-xs font-medium rounded"
                                    title="Annulla tralascio"
                                  >
                                    <RotateCcw className="h-3 w-3" /> Ripristina
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal: Rinomina soggetto */}
      {renameModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setRenameModal(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Rinomina soggetto
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Il nuovo nome verrà applicato a tutte le {renameModal.soggetto.fatture.length} fatture e{' '}
              {renameModal.soggetto.transazioni.length} transazioni di <strong>{renameModal.soggetto.denominazione}</strong>.
            </p>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200 block mb-1">
              Nuovo nome <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              autoFocus
              value={renameModal.newName}
              onChange={(e) => setRenameModal(prev => prev ? { ...prev, newName: e.target.value } : null)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitRename() }}
              className="w-full border rounded-md px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRenameModal(null)}
                className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium"
              >
                Annulla
              </button>
              <button
                onClick={submitRename}
                disabled={!renameModal.newName.trim() || renameModal.newName.trim() === renameModal.soggetto.denominazione}
                className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                Rinomina
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Accorpa soggetti */}
      {mergeModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setMergeModal(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Accorpa soggetti
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Le fatture e transazioni di <strong>{mergeModal.from.denominazione}</strong> verranno spostate
              sotto il soggetto target che scegli. L&apos;operazione aggiorna le denominazioni (cliente/fornitore
              e controparte) e <strong>non è facilmente reversibile</strong>.
            </p>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200 block mb-1">
              Accorpa in… <span className="text-red-500">*</span>
            </label>
            <select
              value={mergeModal.toDenom}
              onChange={(e) => setMergeModal(prev => prev ? { ...prev, toDenom: e.target.value } : null)}
              className="w-full border rounded-md px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
              <option value="">Seleziona soggetto target…</option>
              {soggettiDenoms
                .filter(d => d !== mergeModal.from.denominazione)
                .map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
            </select>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setMergeModal(null)}
                className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium"
              >
                Annulla
              </button>
              <button
                onClick={submitMerge}
                disabled={!mergeModal.toDenom}
                className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                Accorpa
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: accorpa N soggetti selezionati in un unico target */}
      {multiMergeModal && (() => {
        const totFatture = multiMergeModal.from.reduce((s, x) => s + x.fatture.length, 0)
        const totTrans = multiMergeModal.from.reduce((s, x) => s + x.transazioni.length, 0)
        const fromKeysSet = new Set(multiMergeModal.from.map(s => s.key))
        // Suggerimenti: prima i nomi dei soggetti selezionati (utile se uno è
        // quello "canonico"), poi tutti gli altri esistenti.
        const selezionatiNomi = multiMergeModal.from.map(s => s.denominazione)
        const altriNomi = soggettiDenoms.filter(d => !selezionatiNomi.includes(d))
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setMultiMergeModal(null)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                Accorpa {multiMergeModal.from.length} soggetti
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                Le fatture e transazioni dei seguenti soggetti verranno spostate sotto il target
                scelto. Operazione non facilmente reversibile.
              </p>
              <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 mb-4 max-h-40 overflow-y-auto text-xs">
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Soggetti sorgente ({multiMergeModal.from.length}):</p>
                <ul className="space-y-0.5 text-gray-700 dark:text-gray-300">
                  {multiMergeModal.from.map(s => (
                    <li key={s.key} className="flex justify-between gap-2">
                      <span className="truncate">• {s.denominazione}</span>
                      <span className="text-gray-500 whitespace-nowrap">{s.fatture.length}f · {s.transazioni.length}t</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 font-medium text-gray-700 dark:text-gray-200">
                  Totale da spostare: {totFatture} fatture · {totTrans} transazioni
                </p>
              </div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200 block mb-1">
                Accorpa in… <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                list="multi-merge-target-list"
                value={multiMergeModal.toDenom}
                onChange={(e) => setMultiMergeModal(prev => prev ? { ...prev, toDenom: e.target.value } : null)}
                placeholder="Nome del soggetto target (puoi scegliere uno dei selezionati o un altro esistente)"
                className="w-full border rounded-md px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
              <datalist id="multi-merge-target-list">
                {selezionatiNomi.map(d => <option key={`sel-${d}`} value={d}>(selezionato) {d}</option>)}
                {altriNomi.map(d => <option key={`oth-${d}`} value={d}>{d}</option>)}
              </datalist>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                Suggerimento: scegli il nome più pulito / canonico fra i selezionati.
              </p>
              {multiMergeModal.toDenom && !fromKeysSet.has(
                multiMergeModal.toDenom.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
              ) && !soggettiDenoms.includes(multiMergeModal.toDenom) && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  ⓘ Soggetto nuovo — verrà creato.
                </p>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setMultiMergeModal(null)}
                  className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium"
                >
                  Annulla
                </button>
                <button
                  onClick={submitMultiMerge}
                  disabled={!multiMergeModal.toDenom.trim()}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
                >
                  <GitMerge className="h-4 w-4" /> Accorpa {multiMergeModal.from.length} soggetti
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal: assegna N gruppi orfani a un soggetto target */}
      {multiAssignModal && (() => {
        const totTrans = multiAssignModal.groups.reduce((s, g) => s + g.transazioni.length, 0)
        const totImp = multiAssignModal.groups.reduce((s, g) => s + g.totale, 0)
        const target = multiAssignModal.toDenom.trim()
        const isExisting = target ? soggettiDenoms.some(d => d.toLowerCase().trim() === target.toLowerCase().trim()) : false
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setMultiAssignModal(null)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                Accorpa {multiAssignModal.groups.length} gruppi orfani in un soggetto
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                Tutte le transazioni dei gruppi selezionati verranno assegnate al soggetto target.
                Diventano poi candidati per il match con le sue fatture.
              </p>
              <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 mb-4 max-h-40 overflow-y-auto text-xs">
                <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">Gruppi sorgente ({multiAssignModal.groups.length}):</p>
                <ul className="space-y-0.5 text-gray-700 dark:text-gray-300">
                  {multiAssignModal.groups.map(g => (
                    <li key={g.key} className="flex justify-between gap-2">
                      <span className="truncate">• {g.label}</span>
                      <span className="text-gray-500 whitespace-nowrap">{g.transazioni.length}t · {formatCurrency(g.totale)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 font-medium text-gray-700 dark:text-gray-200">
                  Totale da assegnare: {totTrans} transazioni · {formatCurrency(totImp)}
                </p>
              </div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200 block mb-1">
                Soggetto target <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                list="multi-assign-target-list"
                value={multiAssignModal.toDenom}
                onChange={(e) => setMultiAssignModal(prev => prev ? { ...prev, toDenom: e.target.value } : null)}
                placeholder="Nome del soggetto (esistente o nuovo)"
                className="w-full border rounded-md px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
              <datalist id="multi-assign-target-list">
                {soggettiDenoms.map(d => <option key={d} value={d} />)}
              </datalist>
              {target && (
                <p className={`text-[11px] mt-1 ${isExisting ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {isExisting ? '✓ Soggetto esistente' : 'ⓘ Soggetto nuovo — verrà creato'}
                </p>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setMultiAssignModal(null)}
                  className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium"
                >
                  Annulla
                </button>
                <button
                  onClick={submitMultiAssign}
                  disabled={!target}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
                >
                  <GitMerge className="h-4 w-4" /> Accorpa in {target ? `"${target}"` : 'soggetto'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal: sposta N singole transazioni orfane sotto un soggetto */}
      {multiAssignTransModal && (() => {
        const totImp = multiAssignTransModal.rows.reduce((s, r) => s + Math.abs(r.importo), 0)
        const target = multiAssignTransModal.toDenom.trim()
        const isExisting = target ? soggettiDenoms.some(d => d.toLowerCase().trim() === target.toLowerCase().trim()) : false
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setMultiAssignTransModal(null)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                Sposta {multiAssignTransModal.rows.length} transazioni in un soggetto
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                Le transazioni selezionate verranno tolte dai loro gruppi orfani e assegnate
                al soggetto target. Diventano candidate per i match con le sue fatture.
              </p>
              <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 mb-4 max-h-40 overflow-y-auto text-xs">
                <ul className="space-y-0.5 text-gray-700 dark:text-gray-300">
                  {multiAssignTransModal.rows.slice(0, 12).map(t => (
                    <li key={t.id} className="flex justify-between gap-2">
                      <span className="truncate">• {formatDate(t.data)} · {cleanText(t.controparte) || cleanText(t.descrizione) || '—'}</span>
                      <span className={`whitespace-nowrap font-medium ${t.tipo === 'entrata' ? 'text-green-700' : 'text-red-700'}`}>
                        {t.tipo === 'entrata' ? '+' : '-'}{formatCurrency(Math.abs(t.importo))}
                      </span>
                    </li>
                  ))}
                  {multiAssignTransModal.rows.length > 12 && (
                    <li className="text-gray-500 italic">… e altre {multiAssignTransModal.rows.length - 12} righe</li>
                  )}
                </ul>
                <p className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 font-medium text-gray-700 dark:text-gray-200">
                  Totale: {multiAssignTransModal.rows.length} transazioni · {formatCurrency(totImp)}
                </p>
              </div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200 block mb-1">
                Soggetto target <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                list="multi-assign-trans-target-list"
                value={multiAssignTransModal.toDenom}
                onChange={(e) => setMultiAssignTransModal(prev => prev ? { ...prev, toDenom: e.target.value } : null)}
                placeholder="Nome del soggetto (esistente o nuovo)"
                className="w-full border rounded-md px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                autoFocus
              />
              <datalist id="multi-assign-trans-target-list">
                {soggettiDenoms.map(d => <option key={d} value={d} />)}
              </datalist>
              {target && (
                <p className={`text-[11px] mt-1 ${isExisting ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {isExisting ? '✓ Soggetto esistente' : 'ⓘ Soggetto nuovo — verrà creato'}
                </p>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setMultiAssignTransModal(null)}
                  className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium"
                >
                  Annulla
                </button>
                <button
                  onClick={submitMultiAssignTrans}
                  disabled={!target}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
                >
                  <GitMerge className="h-4 w-4" /> Sposta {multiAssignTransModal.rows.length} trans
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal: sposta N righe (fatture+trans) dentro un altro soggetto */}
      {moveRigheModal && (() => {
        const target = moveRigheModal.toDenom.trim()
        const isExisting = target ? soggettiDenoms.some(d => d.toLowerCase().trim() === target.toLowerCase().trim()) : false
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={() => setMoveRigheModal(null)}
          >
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
                Sposta righe in un altro soggetto
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                Le righe selezionate vengono spostate sotto il soggetto target:
                le transazioni cambiano controparte, le fatture cambiano denominazione
                cliente/fornitore.
              </p>
              <div className="bg-gray-50 dark:bg-gray-900 rounded p-3 mb-4 text-xs">
                <p className="text-gray-700 dark:text-gray-200">
                  <strong>{moveRigheModal.fattureIds.length}</strong> fatture · <strong>{moveRigheModal.transIds.length}</strong> transazioni
                </p>
                <p className="text-amber-700 dark:text-amber-300 mt-2">
                  ⚠ Se una riga era già matchata con la sua controparte, il match a livello DB resta ma probabilmente non avrà più senso. Verifica dopo lo spostamento.
                </p>
              </div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-200 block mb-1">
                Soggetto target <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                list="move-righe-target-list"
                value={moveRigheModal.toDenom}
                onChange={(e) => setMoveRigheModal(prev => prev ? { ...prev, toDenom: e.target.value } : null)}
                placeholder="Nome del soggetto (esistente o nuovo)"
                className="w-full border rounded-md px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                autoFocus
              />
              <datalist id="move-righe-target-list">
                {soggettiDenoms.map(d => <option key={d} value={d} />)}
              </datalist>
              {target && (
                <p className={`text-[11px] mt-1 ${isExisting ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {isExisting ? '✓ Soggetto esistente' : 'ⓘ Soggetto nuovo — verrà creato'}
                </p>
              )}
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setMoveRigheModal(null)}
                  className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium"
                >
                  Annulla
                </button>
                <button
                  onClick={submitMoveRighe}
                  disabled={!target}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-medium"
                >
                  <GitMerge className="h-4 w-4" /> Sposta righe
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal: Conferma match con nota opzionale */}
      {matchModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setMatchModal(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              Conferma match
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Stai per collegare una fattura a una transazione del soggetto{' '}
              <strong>{matchModal.soggetto}</strong>.
            </p>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200 block mb-1">
              Nota (opzionale)
            </label>
            <input
              type="text"
              autoFocus
              placeholder="es. Pagamento parziale, in attesa di nota credito…"
              value={matchModal.note}
              onChange={(e) => setMatchModal(prev => prev ? { ...prev, note: e.target.value } : null)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmMatch() }}
              className="w-full border rounded-md px-3 py-2 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              La nota viene salvata nelle note della fattura come <code>[Match: …]</code>.
            </p>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setMatchModal(null)}
                className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium"
              >
                Annulla
              </button>
              <button
                onClick={() => confirmMatch(true)}
                className="px-4 py-2 rounded-md bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-100 text-sm font-medium"
              >
                Salta nota
              </button>
              <button
                onClick={() => confirmMatch()}
                className="px-4 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
              >
                Conferma match
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Tralascia con motivazione */}
      {ignoraModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setIgnoraModal(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">
              {ignoraModal.target.kind === 'group' && 'Tralascia gruppo'}
              {ignoraModal.target.kind === 'trans' && 'Tralascia transazione'}
              {ignoraModal.target.kind === 'fattura' && 'Tralascia fattura'}
              {ignoraModal.target.kind === 'soggetto' && 'Tralascia intero soggetto'}
              {ignoraModal.target.kind === 'multi-soggetto' && `Tralascia ${ignoraModal.target.soggetti.length} soggetti`}
              {ignoraModal.target.kind === 'multi-righe' && `Tralascia ${ignoraModal.target.fattureIds.length + ignoraModal.target.transIds.length} righe selezionate`}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              {ignoraModal.target.kind === 'group' && (
                <>
                  Stai per tralasciare <strong>{ignoraModal.target.group.count}</strong> transazione/i del gruppo
                  &laquo;{ignoraModal.target.group.label}&raquo; per un totale di{' '}
                  <strong>{formatCurrency(ignoraModal.target.group.totale)}</strong>.
                </>
              )}
              {ignoraModal.target.kind === 'soggetto' && (
                <>
                  Stai per tralasciare il soggetto <strong>{ignoraModal.target.soggetto.denominazione}</strong>:{' '}
                  {ignoraModal.target.soggetto.fatture.length} fatture e{' '}
                  {ignoraModal.target.soggetto.transazioni.length} transazioni verranno marcate come tralasciate
                  con questa motivazione.
                </>
              )}
              {ignoraModal.target.kind === 'multi-soggetto' && (
                <>
                  Stai per tralasciare <strong>{ignoraModal.target.soggetti.length}</strong> soggetti.
                  Tutte le loro fatture e transazioni verranno marcate come tralasciate con la stessa motivazione.
                </>
              )}
              {ignoraModal.target.kind === 'multi-righe' && (
                <>
                  Stai per tralasciare <strong>{ignoraModal.target.fattureIds.length}</strong> fatture e{' '}
                  <strong>{ignoraModal.target.transIds.length}</strong> transazioni con la stessa motivazione.
                </>
              )}
              {(ignoraModal.target.kind === 'trans' || ignoraModal.target.kind === 'fattura') && (
                <>
                  {ignoraModal.target.kind === 'fattura' && 'Fattura '}
                  {ignoraModal.target.label} · {formatDate(ignoraModal.target.data)} ·{' '}
                  <strong>{formatCurrency(ignoraModal.target.importo)}</strong>
                </>
              )}
            </p>

            <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              Motivazione <span className="text-red-500">*</span>
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {MOTIVI_PREDEFINITI.map(m => (
                <button
                  key={m}
                  onClick={() => setIgnoraModal(prev => prev ? { ...prev, motivo: m } : null)}
                  className={`text-left px-3 py-2 text-sm rounded border transition ${
                    ignoraModal.motivo === m
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:border-indigo-400'
                  }`}
                >
                  {m}
                </button>
              ))}
              <button
                onClick={() => setIgnoraModal(prev => prev ? { ...prev, motivo: 'Altro' } : null)}
                className={`text-left px-3 py-2 text-sm rounded border transition col-span-2 ${
                  ignoraModal.motivo === 'Altro'
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600 hover:border-indigo-400'
                }`}
              >
                Altro…
              </button>
            </div>
            {ignoraModal.motivo === 'Altro' && (
              <input
                type="text"
                autoFocus
                placeholder="Scrivi la motivazione…"
                value={ignoraModal.custom}
                onChange={(e) => setIgnoraModal(prev => prev ? { ...prev, custom: e.target.value } : null)}
                className="w-full border rounded-md px-3 py-2 mb-3 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setIgnoraModal(null)}
                className="px-4 py-2 rounded-md bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium"
              >
                Annulla
              </button>
              <button
                onClick={submitIgnora}
                disabled={!ignoraModal.motivo || (ignoraModal.motivo === 'Altro' && !ignoraModal.custom.trim())}
                className="px-4 py-2 rounded-md bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-medium"
              >
                Tralascia
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
