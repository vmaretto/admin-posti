import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type TipoFattura = 'emessa' | 'ricevuta'
type TipoTransazione = 'entrata' | 'uscita'

type FatturaRow = {
  id: string
  tipo: TipoFattura | string | null
  totale: number | null
  imponibile: number | null
  imposta: number | null
  data_emissione: string | null
  stato_riconciliazione: string | null
  denominazione_cliente: string | null
  denominazione_fornitore: string | null
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
}

type GroupedItem = {
  name: string
  amount: number
  count: number
  detail: string
}

function amount(value: number | null | undefined): number {
  return Number(value || 0)
}

function invoiceTotal(fattura: FatturaRow): number {
  return amount(fattura.totale) || amount(fattura.imponibile) + amount(fattura.imposta)
}

function isOpen(stato: string | null | undefined): boolean {
  return stato !== 'riconciliata'
}

function subjectForInvoice(fattura: FatturaRow): string {
  return (
    fattura.tipo === 'emessa'
      ? fattura.denominazione_cliente
      : fattura.denominazione_fornitore
  ) || 'Soggetto non indicato'
}

function groupBySubject<T>(
  rows: T[],
  keyFn: (row: T) => string,
  amountFn: (row: T) => number,
  detailFn: (row: T[]) => string,
): GroupedItem[] {
  const groups = new Map<string, T[]>()

  for (const row of rows) {
    const key = keyFn(row).trim() || 'Soggetto non indicato'
    groups.set(key, [...(groups.get(key) || []), row])
  }

  return Array.from(groups.entries())
    .map(([name, group]) => ({
      name,
      amount: group.reduce((sum, row) => sum + Math.abs(amountFn(row)), 0),
      count: group.length,
      detail: detailFn(group),
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 12)
}

export async function GET() {
  const supabase = createServerClient()
  const start = '2025-01-01'
  const end = '2026-01-01'

  const [{ data: fatture, error: fattureError }, { data: transazioni, error: transazioniError }] = await Promise.all([
    supabase
      .from('fatture')
      .select('id, tipo, totale, imponibile, imposta, data_emissione, stato_riconciliazione, denominazione_cliente, denominazione_fornitore')
      .gte('data_emissione', start)
      .lt('data_emissione', end)
      .range(0, 99999),
    supabase
      .from('transazioni')
      .select('id, tipo, importo, data, controparte, descrizione, conto, stato_riconciliazione')
      .gte('data', start)
      .lt('data', end)
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

  const entrate = transazioniRows
    .filter((t) => t.tipo === 'entrata')
    .reduce((sum, t) => sum + Math.abs(amount(t.importo)), 0)
  const uscite = transazioniRows
    .filter((t) => t.tipo === 'uscita')
    .reduce((sum, t) => sum + Math.abs(amount(t.importo)), 0)

  const fattureAttive = fattureRows
    .filter((f) => f.tipo === 'emessa')
    .reduce((sum, f) => sum + Math.abs(invoiceTotal(f)), 0)
  const fatturePassive = fattureRows
    .filter((f) => f.tipo === 'ricevuta')
    .reduce((sum, f) => sum + Math.abs(invoiceTotal(f)), 0)

  const fattureRiconciliate = fattureRows.filter((f) => f.stato_riconciliazione === 'riconciliata')
  const transazioniRiconciliate = transazioniRows.filter((t) => t.stato_riconciliazione === 'riconciliata')
  const openFatture = fattureRows.filter((f) => isOpen(f.stato_riconciliazione))
  const openTransazioni = transazioniRows.filter((t) => isOpen(t.stato_riconciliazione))

  const topTransazioniAperte = groupBySubject(
    openTransazioni,
    (t) => t.controparte || t.descrizione || 'Controparte non indicata',
    (t) => amount(t.importo),
    (rows) => {
      const entrateCount = rows.filter((t) => t.tipo === 'entrata').length
      const usciteCount = rows.filter((t) => t.tipo === 'uscita').length
      return `${rows.length} moviment${rows.length === 1 ? 'o' : 'i'} · ${entrateCount} entrate / ${usciteCount} uscite`
    },
  )

  const topFattureAperte = groupBySubject(
    openFatture,
    subjectForInvoice,
    invoiceTotal,
    (rows) => {
      const emesse = rows.filter((f) => f.tipo === 'emessa').length
      const ricevute = rows.filter((f) => f.tipo === 'ricevuta').length
      return `${rows.length} fattur${rows.length === 1 ? 'a' : 'e'} · ${emesse} attive / ${ricevute} passive`
    },
  )

  return NextResponse.json({
    periodo: '2025',
    banca: {
      transazioni: transazioniRows.length,
      entrate,
      uscite,
      saldo: entrate - uscite,
      riconciliate: transazioniRiconciliate.length,
      aperte: openTransazioni.length,
      importo_aperto: openTransazioni.reduce((sum, t) => sum + Math.abs(amount(t.importo)), 0),
    },
    fatture: {
      totali: fattureRows.length,
      attive: fattureAttive,
      passive: fatturePassive,
      riconciliate: fattureRiconciliate.length,
      aperte: openFatture.length,
      importo_riconciliato: fattureRiconciliate.reduce((sum, f) => sum + Math.abs(invoiceTotal(f)), 0),
      importo_aperto: openFatture.reduce((sum, f) => sum + Math.abs(invoiceTotal(f)), 0),
    },
    top_transazioni_aperte: topTransazioniAperte,
    top_fatture_aperte: topFattureAperte,
  })
}
