// Utility per il "periodo attivo" globale dell'app.
// Slug supportati nell'URL (?periodo=...):
//   'tutto'       → nessun filtro temporale (legacy behavior)
//   '2026'        → anno solare
//   '2026-Q1'     → trimestre (Q1=gen-mar, Q2=apr-giu, Q3=lug-set, Q4=ott-dic)
//   '2026-01'    → mese (gennaio 2026)

export type PeriodoTipo = 'tutto' | 'anno' | 'trimestre' | 'mese'

export interface Periodo {
  slug: string
  tipo: PeriodoTipo
  anno?: number
  trimestre?: number
  mese?: number
  from?: string // YYYY-MM-DD inclusivo
  to?: string // YYYY-MM-DD inclusivo
  label: string
}

const MESI = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre',
]

function lastDayOfMonth(anno: number, mese: number): number {
  // mese: 1-12; Date(anno, mese, 0) restituisce l'ultimo giorno del mese precedente,
  // quindi passando mese (1-based) ottieni l'ultimo giorno del mese richiesto.
  return new Date(anno, mese, 0).getDate()
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function parsePeriodo(slug: string | null | undefined): Periodo {
  const s = (slug || 'tutto').trim()

  if (s === 'tutto') {
    return { slug: 'tutto', tipo: 'tutto', label: 'Tutto' }
  }

  // YYYY-QN
  const mQ = /^(\d{4})-Q([1-4])$/.exec(s)
  if (mQ) {
    const anno = parseInt(mQ[1])
    const q = parseInt(mQ[2])
    const startMonth = (q - 1) * 3 + 1
    const endMonth = startMonth + 2
    const from = `${anno}-${pad2(startMonth)}-01`
    const to = `${anno}-${pad2(endMonth)}-${pad2(lastDayOfMonth(anno, endMonth))}`
    return { slug: s, tipo: 'trimestre', anno, trimestre: q, from, to, label: `Q${q} ${anno}` }
  }

  // YYYY-MM
  const mM = /^(\d{4})-(\d{2})$/.exec(s)
  if (mM) {
    const anno = parseInt(mM[1])
    const mese = parseInt(mM[2])
    if (mese < 1 || mese > 12) {
      return { slug: 'tutto', tipo: 'tutto', label: 'Tutto' }
    }
    const from = `${anno}-${pad2(mese)}-01`
    const to = `${anno}-${pad2(mese)}-${pad2(lastDayOfMonth(anno, mese))}`
    return { slug: s, tipo: 'mese', anno, mese, from, to, label: `${MESI[mese - 1]} ${anno}` }
  }

  // YYYY
  const mY = /^(\d{4})$/.exec(s)
  if (mY) {
    const anno = parseInt(mY[1])
    return {
      slug: s,
      tipo: 'anno',
      anno,
      from: `${anno}-01-01`,
      to: `${anno}-12-31`,
      label: String(anno),
    }
  }

  // fallback
  return { slug: 'tutto', tipo: 'tutto', label: 'Tutto' }
}

export function defaultPeriodoSlug(): string {
  return String(new Date().getFullYear())
}

export function formatPeriodoSlug(opts: {
  tipo: PeriodoTipo
  anno?: number
  trimestre?: number
  mese?: number
}): string {
  const annoCorrente = new Date().getFullYear()
  if (opts.tipo === 'tutto') return 'tutto'
  if (opts.tipo === 'anno') return String(opts.anno ?? annoCorrente)
  if (opts.tipo === 'trimestre') {
    return `${opts.anno ?? annoCorrente}-Q${opts.trimestre ?? 1}`
  }
  if (opts.tipo === 'mese') {
    return `${opts.anno ?? annoCorrente}-${pad2(opts.mese ?? 1)}`
  }
  return 'tutto'
}

export const MESI_LABELS = MESI
