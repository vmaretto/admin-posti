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
  transazione_id?: string | null
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

type RiconciliazioneRow = {
  fattura_id: string | null
  transazione_id: string | null
}

type MonthBucket = {
  month: string
  count: number
  amount: number
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

type InvoiceLite = {
  id: string
  numero: string | null
  data: string | null
  amount: number
  subject: string
  stato: string | null
  matched_transaction_ids: string[]
}

type TransactionLite = {
  id: string
  data: string | null
  amount: number
  tipo: string | null
  conto: string | null
  controparte: string
  descrizione: string | null
  stato: string | null
  matched_invoice_ids: string[]
  matched_invoices: InvoiceLite[]
  ok_without_invoice: boolean
}

type InvoiceCoverage = CoverageSummary & {
  tipo: TipoFattura | 'estero'
  by_month: MonthBucket[]
  by_supplier: SupplierInvoiceCoverage[]
  unmatched: InvoiceLite[]
}

type SupplierInvoiceCoverage = CoverageSummary & {
  subject: string
  normalized_subject: string
  months_present: string[]
  months_missing: string[]
  invoices: InvoiceLite[]
  unmatched: InvoiceLite[]
}

type TransactionSupplierGroup = CoverageSummary & {
  subject: string
  normalized_subject: string
  descriptions: string[]
  accounts: string[]
  entrate: number
  uscite: number
  riconciliate: number
  aperte: number
  ok_without_invoice_count: number
  transactions: TransactionLite[]
  unmatched_invoices: InvoiceLite[]
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

function isReconciled(stato: string | null | undefined): boolean {
  return stato === 'riconciliata'
}

function monthOf(date: string | null | undefined): string | null {
  return date ? date.slice(0, 7) : null
}

function cleanSubject(value: string | null | undefined): string {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim()
  if (!cleaned || ['false', 'null', 'undefined'].includes(cleaned.toLowerCase())) return 'Soggetto non indicato'
  return cleaned
}

function cleanDescription(value: string | null | undefined): string | null {
  const cleaned = cleanSubject(value)
  return cleaned === 'Soggetto non indicato' ? null : cleaned
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

function invoiceLite(fattura: FatturaRow, matchesByInvoice: Map<string, Set<string>>): InvoiceLite {
  return {
    id: fattura.id,
    numero: fattura.numero,
    data: fattura.data_emissione,
    amount: invoiceTotal(fattura),
    subject: subjectForInvoice(fattura),
    stato: fattura.stato_riconciliazione,
    matched_transaction_ids: Array.from(matchesByInvoice.get(fattura.id) || []),
  }
}

function transactionLite(
  transazione: TransazioneRow,
  invoicesByTransaction: Map<string, FatturaRow[]>,
  matchesByInvoice: Map<string, Set<string>>,
): TransactionLite {
  const matchedInvoices = invoicesByTransaction.get(transazione.id) || []
  const matchedInvoiceIds = Array.from(new Set(matchedInvoices.map((f) => f.id)))
  return {
    id: transazione.id,
    data: transazione.data,
    amount: absAmount(transazione.importo),
    tipo: transazione.tipo,
    conto: transazione.conto,
    controparte: subjectForTransaction(transazione),
    descrizione: cleanDescription(transazione.descrizione),
    stato: transazione.stato_riconciliazione,
    matched_invoice_ids: matchedInvoiceIds,
    matched_invoices: matchedInvoices.map((f) => invoiceLite(f, matchesByInvoice)),
    ok_without_invoice: isReconciled(transazione.stato_riconciliazione) && matchedInvoiceIds.length === 0,
  }
}

function buildInvoiceCoverage(
  rows: FatturaRow[],
  tipo: TipoFattura | 'estero',
  matchesByInvoice: Map<string, Set<string>>,
): InvoiceCoverage {
  const present = monthsPresent(rows, 'data_emissione')
  const bySupplierMap = new Map<string, FatturaRow[]>()

  for (const row of rows) {
    const subject = subjectForInvoice(row)
    const key = normalizeSubject(subject) || subject.toLowerCase()
    bySupplierMap.set(key, [...(bySupplierMap.get(key) || []), row])
  }

  const bySupplier: SupplierInvoiceCoverage[] = Array.from(bySupplierMap.entries())
    .map(([key, supplierRows]) => {
      const supplierPresent = monthsPresent(supplierRows, 'data_emissione')
      const invoices = supplierRows
        .map((row) => invoiceLite(row, matchesByInvoice))
        .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
      const unmatched = invoices.filter((invoice) => !isReconciled(invoice.stato) || invoice.matched_transaction_ids.length === 0)
      return {
        subject: subjectForInvoice(supplierRows[0]),
        normalized_subject: key,
        count: supplierRows.length,
        amount: supplierRows.reduce((sum, row) => sum + invoiceTotal(row), 0),
        first_date: minDate(supplierRows, 'data_emissione'),
        last_date: maxDate(supplierRows, 'data_emissione'),
        months_present: supplierPresent,
        months_missing: missingMonths(supplierPresent),
        invoices,
        unmatched,
      }
    })
    .sort((a, b) => b.amount - a.amount)

  const allInvoices = rows.map((row) => invoiceLite(row, matchesByInvoice))
  const unmatched = allInvoices
    .filter((invoice) => !isReconciled(invoice.stato) || invoice.matched_transaction_ids.length === 0)
    .sort((a, b) => b.amount - a.amount)

  return {
    tipo,
    count: rows.length,
    amount: rows.reduce((sum, row) => sum + invoiceTotal(row), 0),
    first_date: minDate(rows, 'data_emissione'),
    last_date: maxDate(rows, 'data_emissione'),
    months_present: present,
    months_missing: missingMonths(present),
    by_month: monthBuckets(rows, (row) => row.data_emissione, invoiceTotal),
    by_supplier: bySupplier,
    unmatched,
  }
}

function buildTransactionGroups(
  transazioni: TransazioneRow[],
  fatture: FatturaRow[],
  invoicesByTransaction: Map<string, FatturaRow[]>,
  matchesByInvoice: Map<string, Set<string>>,
): TransactionSupplierGroup[] {
  const invoiceGroups = new Map<string, InvoiceLite[]>()
  for (const fattura of fatture) {
    const subject = subjectForInvoice(fattura)
    const key = normalizeSubject(subject) || subject.toLowerCase()
    const lite = invoiceLite(fattura, matchesByInvoice)
    if (!isReconciled(lite.stato) || lite.matched_transaction_ids.length === 0) {
      invoiceGroups.set(key, [...(invoiceGroups.get(key) || []), lite])
    }
  }

  const groups = new Map<string, TransazioneRow[]>()
  for (const transazione of transazioni) {
    const subject = subjectForTransaction(transazione)
    const key = normalizeSubject(subject) || subject.toLowerCase()
    groups.set(key, [...(groups.get(key) || []), transazione])
  }

  return Array.from(groups.entries())
    .map(([key, rows]) => {
      const summary = summarizeTransactions(rows)
      const transactions = rows
        .map((row) => transactionLite(row, invoicesByTransaction, matchesByInvoice))
        .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
      const descriptions = Array.from(new Set(rows.map((row) => cleanDescription(row.descrizione)).filter((value): value is string => Boolean(value)))).slice(0, 8)
      const accounts = Array.from(new Set(rows.map((row) => row.conto || 'n/d'))).sort()
      return {
        subject: subjectForTransaction(rows[0]),
        normalized_subject: key,
        ...summary,
        descriptions,
        accounts,
        entrate: rows.filter((t) => t.tipo === 'entrata').reduce((sum, t) => sum + absAmount(t.importo), 0),
        uscite: rows.filter((t) => t.tipo === 'uscita').reduce((sum, t) => sum + absAmount(t.importo), 0),
        riconciliate: rows.filter((t) => isReconciled(t.stato_riconciliazione)).length,
        aperte: rows.filter((t) => !isReconciled(t.stato_riconciliazione)).length,
        ok_without_invoice_count: transactions.filter((t) => t.ok_without_invoice).length,
        transactions,
        unmatched_invoices: (invoiceGroups.get(key) || []).sort((a, b) => b.amount - a.amount),
      }
    })
    .sort((a, b) => b.amount - a.amount)
}

function buildMatchMaps(fatture: FatturaRow[], riconciliazioni: RiconciliazioneRow[]) {
  const matchesByInvoice = new Map<string, Set<string>>()
  const invoicesByTransaction = new Map<string, FatturaRow[]>()
  const fattureById = new Map(fatture.map((fattura) => [fattura.id, fattura]))

  const addMatch = (fatturaId: string | null | undefined, transazioneId: string | null | undefined) => {
    if (!fatturaId || !transazioneId) return
    const fattura = fattureById.get(fatturaId)
    if (!fattura) return
    if (!matchesByInvoice.has(fatturaId)) matchesByInvoice.set(fatturaId, new Set())
    matchesByInvoice.get(fatturaId)!.add(transazioneId)
    const current = invoicesByTransaction.get(transazioneId) || []
    if (!current.some((item) => item.id === fatturaId)) {
      invoicesByTransaction.set(transazioneId, [...current, fattura])
    }
  }

  for (const fattura of fatture) {
    addMatch(fattura.id, fattura.transazione_id)
  }
  for (const riconciliazione of riconciliazioni) {
    addMatch(riconciliazione.fattura_id, riconciliazione.transazione_id)
  }

  return { matchesByInvoice, invoicesByTransaction }
}

export async function GET() {
  const supabase = createServerClient()

  const [
    { data: fatture, error: fattureError },
    { data: transazioni, error: transazioniError },
    { data: riconciliazioni, error: riconciliazioniError },
  ] = await Promise.all([
    supabase
      .from('fatture')
      .select('id, tipo, numero, totale, imponibile, imposta, data_emissione, stato_riconciliazione, denominazione_cliente, denominazione_fornitore, fonte, transazione_id')
      .gte('data_emissione', START)
      .lt('data_emissione', END)
      .range(0, 99999),
    supabase
      .from('transazioni')
      .select('id, tipo, importo, data, controparte, descrizione, conto, stato_riconciliazione, fattura_id')
      .gte('data', START)
      .lt('data', END)
      .range(0, 99999),
    supabase
      .from('riconciliazioni')
      .select('fattura_id, transazione_id')
      .range(0, 99999),
  ])

  if (fattureError || transazioniError || riconciliazioniError) {
    return NextResponse.json(
      {
        error: 'Errore nel caricamento analisi 2025',
        details: fattureError?.message || transazioniError?.message || riconciliazioniError?.message,
      },
      { status: 500 },
    )
  }

  const fattureRows = (fatture || []) as FatturaRow[]
  const transazioniRows = (transazioni || []) as TransazioneRow[]
  const riconciliazioniRows = (riconciliazioni || []) as RiconciliazioneRow[]
  const { matchesByInvoice, invoicesByTransaction } = buildMatchMaps(fattureRows, riconciliazioniRows)

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
    transazioni: {
      by_supplier: buildTransactionGroups(transazioniRows, fattureRows, invoicesByTransaction, matchesByInvoice),
      ok_without_invoice: transazioniRows
        .map((row) => transactionLite(row, invoicesByTransaction, matchesByInvoice))
        .filter((row) => row.ok_without_invoice),
    },
    fatture: {
      attive: buildInvoiceCoverage(fattureAttive, 'emessa', matchesByInvoice),
      passive: buildInvoiceCoverage(fatturePassive, 'ricevuta', matchesByInvoice),
      estere: buildInvoiceCoverage(fattureEstere, 'estero', matchesByInvoice),
    },
  })
}
