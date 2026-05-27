import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type TipoFattura = 'emessa' | 'ricevuta'
type TipoTransazione = 'entrata' | 'uscita'

type FatturaRow = {
  id: string
  tipo: TipoFattura | string | null
  numero: string | null
  totale: number | null
  imponibile: number | null
  imposta: number | null
  data_emissione: string | null
  stato_riconciliazione: string | null
  denominazione_cliente: string | null
  denominazione_fornitore: string | null
  fonte: string | null
}

type TransazioneRow = {
  id: string
  tipo: TipoTransazione | string | null
  importo: number | null
  data: string | null
  controparte: string | null
  descrizione: string | null
  conto: string | null
  stato_riconciliazione: string | null
  fattura_id?: string | null
}

type CoverageSummary = {
  count: number
  amount: number
  first_date: string | null
  last_date: string | null
  months_present: string[]
  months_missing: string[]
}

type BankAccountCoverage = CoverageSummary & {
  conto: string
  entrate: number
  uscite: number
}

type InvoiceCoverage = CoverageSummary & {
  tipo: TipoFattura | 'estero'
  first_number: string | null
  last_number: string | null
  last_subject: string | null
  gaps: string[]
  by_month: MonthBucket[]
}

type MonthBucket = {
  month: string
  count: number
  amount: number
}

type MissingDocumentCandidate = {
  subject: string
  kind: 'possibile_fattura_passiva' | 'possibile_fattura_estera' | 'da_classificare'
  amount: number
  count: number
  first_date: string | null
  last_date: string | null
  accounts: string[]
  reason: string
  priority: 'alta' | 'media' | 'bassa'
}

const START = '2025-01-01'
const END = '2026-01-01'
const MONTHS_2025 = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`)

function amount(value: number | null | undefined): number {
  return Number(value || 0)
}

function absAmount(value: number | null | undefined): number {
  return Math.abs(amount(value))
}

function invoiceTotal(fattura: FatturaRow): number {
  return absAmount(fattura.totale) || absAmount(fattura.imponibile) + absAmount(fattura.imposta)
}

function isOpen(stato: string | null | undefined): boolean {
  return stato !== 'riconciliata'
}

function monthOf(date: string | null | undefined): string | null {
  return date ? date.slice(0, 7) : null
}

function cleanSubject(value: string | null | undefined): string {
  return (value || 'Soggetto non indicato').replace(/\s+/g, ' ').trim()
}

function normalizeSubject(value: string | null | undefined): string {
  return cleanSubject(value)
    .toLowerCase()
    .replace(/[^a-z0-9àèéìòù\s]/gi, ' ')
    .replace(/\b(srl|s r l|spa|s p a|ltd|limited|inc|gmbh|sa|sas|snc|srls|italia|italy)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function subjectForInvoice(fattura: FatturaRow): string {
  return cleanSubject(
    fattura.tipo === 'emessa'
      ? fattura.denominazione_cliente
      : fattura.denominazione_fornitore,
  )
}

function subjectForTransaction(transazione: TransazioneRow): string {
  return cleanSubject(transazione.controparte || transazione.descrizione)
}

function minDate(rows: { data?: string | null; data_emissione?: string | null }[], field: 'data' | 'data_emissione'): string | null {
  const dates = rows.map((row) => row[field]).filter(Boolean).sort() as string[]
  return dates[0] || null
}

function maxDate(rows: { data?: string | null; data_emissione?: string | null }[], field: 'data' | 'data_emissione'): string | null {
  const dates = rows.map((row) => row[field]).filter(Boolean).sort() as string[]
  return dates[dates.length - 1] || null
}

function monthsPresent(rows: { data?: string | null; data_emissione?: string | null }[], field: 'data' | 'data_emissione'): string[] {
  return Array.from(new Set(rows.map((row) => monthOf(row[field])).filter(Boolean) as string[])).sort()
}

function missingMonths(present: string[]): string[] {
  const presentSet = new Set(present)
  return MONTHS_2025.filter((month) => !presentSet.has(month))
}

function monthBuckets<T>(rows: T[], dateFn: (row: T) => string | null | undefined, amountFn: (row: T) => number): MonthBucket[] {
  return MONTHS_2025.map((month) => {
    const group = rows.filter((row) => monthOf(dateFn(row)) === month)
    return {
      month,
      count: group.length,
      amount: group.reduce((sum, row) => sum + amountFn(row), 0),
    }
  })
}

function summarizeTransactions(rows: TransazioneRow[]): CoverageSummary {
  const present = monthsPresent(rows, 'data')
  return {
    count: rows.length,
    amount: rows.reduce((sum, row) => sum + absAmount(row.importo), 0),
    first_date: minDate(rows, 'data'),
    last_date: maxDate(rows, 'data'),
    months_present: present,
    months_missing: missingMonths(present),
  }
}

function summarizeInvoices(rows: FatturaRow[], tipo: TipoFattura | 'estero'): InvoiceCoverage {
  const present = monthsPresent(rows, 'data_emissione')
  const sorted = [...rows].sort((a, b) => String(a.data_emissione || '').localeCompare(String(b.data_emissione || '')))
  const first = sorted[0]
  const last = sorted[sorted.length - 1]

  return {
    tipo,
    count: rows.length,
    amount: rows.reduce((sum, row) => sum + invoiceTotal(row), 0),
    first_date: minDate(rows, 'data_emissione'),
    last_date: maxDate(rows, 'data_emissione'),
    first_number: first?.numero || null,
    last_number: last?.numero || null,
    last_subject: last ? subjectForInvoice(last) : null,
    months_present: present,
    months_missing: missingMonths(present),
    gaps: detectInvoiceNumberGaps(rows),
    by_month: monthBuckets(rows, (row) => row.data_emissione, invoiceTotal),
  }
}

function detectInvoiceNumberGaps(rows: FatturaRow[]): string[] {
  const byYear = new Map<string, number[]>()

  for (const row of rows) {
    if (!row.numero || !row.data_emissione) continue
    const year = row.data_emissione.slice(0, 4)
    const numberMatch = row.numero.match(/\d+/)
    if (!numberMatch) continue
    const n = Number(numberMatch[0])
    if (!Number.isFinite(n)) continue
    byYear.set(year, [...(byYear.get(year) || []), n])
  }

  const gaps: string[] = []
  for (const [year, numbers] of byYear.entries()) {
    const unique = Array.from(new Set(numbers)).sort((a, b) => a - b)
    if (unique.length < 3) continue

    const missing: number[] = []
    for (let n = unique[0]; n <= unique[unique.length - 1]; n++) {
      if (!unique.includes(n)) missing.push(n)
      if (missing.length >= 10) break
    }

    if (missing.length > 0) {
      gaps.push(`${year}: possibili numeri mancanti ${missing.join(', ')}${missing.length >= 10 ? '…' : ''}`)
    }
  }

  return gaps
}

function isLikelyForeignSupplier(subject: string): boolean {
  const s = subject.toLowerCase()
  return [
    'ireland', 'ltd', 'limited', 'gmbh', 'sarl', 'amazon', 'google', 'meta', 'facebook', 'openai',
    'apple', 'microsoft', 'stripe', 'notion', 'linkedin', 'zoom', 'adobe', 'dropbox', 'github',
    'canva', 'figma', 'wise', 'paypal', 'hetzner', 'ovh', 'digitalocean', 'vercel', 'anthropic',
  ].some((keyword) => s.includes(keyword))
}

function priorityFor(amountTotal: number): 'alta' | 'media' | 'bassa' {
  if (amountTotal >= 1000) return 'alta'
  if (amountTotal >= 250) return 'media'
  return 'bassa'
}

function buildMissingCandidates(transazioni: TransazioneRow[], fatture: FatturaRow[]): MissingDocumentCandidate[] {
  const invoiceSubjects = new Set(
    fatture
      .filter((f) => f.tipo === 'ricevuta' || f.fonte === 'estero')
      .map(subjectForInvoice)
      .map(normalizeSubject)
      .filter(Boolean),
  )

  const groups = new Map<string, TransazioneRow[]>()
  for (const t of transazioni) {
    if (t.tipo !== 'uscita') continue
    if (!isOpen(t.stato_riconciliazione)) continue
    const subject = subjectForTransaction(t)
    const key = normalizeSubject(subject) || subject.toLowerCase()
    groups.set(key, [...(groups.get(key) || []), t])
  }

  return Array.from(groups.entries())
    .map(([key, rows]) => {
      const subject = subjectForTransaction(rows[0])
      const amountTotal = rows.reduce((sum, row) => sum + absAmount(row.importo), 0)
      const hasInvoiceSubject = Array.from(invoiceSubjects).some((invoiceSubject) => {
        if (!key || !invoiceSubject) return false
        return key.includes(invoiceSubject) || invoiceSubject.includes(key)
      })
      const foreign = isLikelyForeignSupplier(subject)
      const kind: MissingDocumentCandidate['kind'] = foreign
        ? 'possibile_fattura_estera'
        : hasInvoiceSubject
          ? 'da_classificare'
          : 'possibile_fattura_passiva'

      return {
        subject,
        kind,
        amount: amountTotal,
        count: rows.length,
        first_date: minDate(rows, 'data'),
        last_date: maxDate(rows, 'data'),
        accounts: Array.from(new Set(rows.map((row) => row.conto || 'n/d'))).sort(),
        reason: foreign
          ? 'Fornitore estero/digitale con movimenti in uscita non riconciliati: verificare fattura estera.'
          : hasInvoiceSubject
            ? 'Soggetto presente anche in fatture, ma movimenti ancora aperti: verificare abbinamento o classificazione.'
            : 'Movimenti in uscita non riconciliati senza fattura passiva evidente: verificare documento da recuperare.',
        priority: priorityFor(amountTotal),
      }
    })
    .filter((item) => item.amount >= 50)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 30)
}

export async function GET() {
  const supabase = createServerClient()

  const [{ data: fatture, error: fattureError }, { data: transazioni, error: transazioniError }] = await Promise.all([
    supabase
      .from('fatture')
      .select('id, tipo, numero, totale, imponibile, imposta, data_emissione, stato_riconciliazione, denominazione_cliente, denominazione_fornitore, fonte')
      .gte('data_emissione', START)
      .lt('data_emissione', END)
      .range(0, 99999),
    supabase
      .from('transazioni')
      .select('id, tipo, importo, data, controparte, descrizione, conto, stato_riconciliazione, fattura_id')
      .gte('data', START)
      .lt('data', END)
      .range(0, 99999),
  ])

  if (fattureError || transazioniError) {
    return NextResponse.json(
      {
        error: 'Errore nel caricamento analisi 2025',
        details: fattureError?.message || transazioniError?.message,
      },
      { status: 500 },
    )
  }

  const fattureRows = (fatture || []) as FatturaRow[]
  const transazioniRows = (transazioni || []) as TransazioneRow[]

  const fattureAttive = fattureRows.filter((f) => f.tipo === 'emessa')
  const fatturePassive = fattureRows.filter((f) => f.tipo === 'ricevuta' && f.fonte !== 'estero')
  const fattureEstere = fattureRows.filter((f) => f.fonte === 'estero')

  const allBank = summarizeTransactions(transazioniRows)
  const byAccount: BankAccountCoverage[] = Array.from(new Set(transazioniRows.map((t) => t.conto || 'n/d')))
    .sort()
    .map((conto) => {
      const rows = transazioniRows.filter((t) => (t.conto || 'n/d') === conto)
      const summary = summarizeTransactions(rows)
      return {
        conto,
        ...summary,
        entrate: rows.filter((t) => t.tipo === 'entrata').reduce((sum, t) => sum + absAmount(t.importo), 0),
        uscite: rows.filter((t) => t.tipo === 'uscita').reduce((sum, t) => sum + absAmount(t.importo), 0),
      }
    })

  const entrate = transazioniRows.filter((t) => t.tipo === 'entrata').reduce((sum, t) => sum + absAmount(t.importo), 0)
  const uscite = transazioniRows.filter((t) => t.tipo === 'uscita').reduce((sum, t) => sum + absAmount(t.importo), 0)

  return NextResponse.json({
    periodo: '2025',
    generated_at: new Date().toISOString(),
    banca: {
      ...allBank,
      entrate,
      uscite,
      saldo: entrate - uscite,
      by_account: byAccount,
      by_month: monthBuckets(transazioniRows, (row) => row.data, (row) => absAmount(row.importo)),
    },
    fatture: {
      attive: summarizeInvoices(fattureAttive, 'emessa'),
      passive: summarizeInvoices(fatturePassive, 'ricevuta'),
      estere: summarizeInvoices(fattureEstere, 'estero'),
    },
    documenti_mancanti: buildMissingCandidates(transazioniRows, fattureRows),
  })
}
