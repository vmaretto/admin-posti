'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Calendar } from 'lucide-react'
import { useMemo, Suspense } from 'react'
import {
  parsePeriodo,
  formatPeriodoSlug,
  defaultPeriodoSlug,
  PeriodoTipo,
  MESI_LABELS,
} from '@/lib/periodo'

function PeriodoPickerInner() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const slug = sp.get('periodo') || defaultPeriodoSlug()
  const p = useMemo(() => parsePeriodo(slug), [slug])

  function navigate(newSlug: string) {
    const params = new URLSearchParams(sp.toString())
    params.set('periodo', newSlug)
    router.push(`${pathname}?${params.toString()}`)
  }

  const annoCorrente = new Date().getFullYear()
  // 5 anni indietro + 1 avanti
  const anni: number[] = []
  for (let y = annoCorrente + 1; y >= annoCorrente - 5; y--) anni.push(y)

  return (
    <div className="bg-indigo-700 dark:bg-gray-800 text-white sticky top-0 z-30 shadow-md border-b border-indigo-800 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-3 flex-wrap">
        <Calendar className="h-4 w-4 text-indigo-200 dark:text-indigo-300" />
        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-100">
          Periodo
        </span>

        <select
          value={p.tipo}
          onChange={e => {
            const newTipo = e.target.value as PeriodoTipo
            if (newTipo === 'tutto') return navigate('tutto')
            if (newTipo === 'anno') {
              return navigate(formatPeriodoSlug({ tipo: 'anno', anno: p.anno ?? annoCorrente }))
            }
            if (newTipo === 'trimestre') {
              return navigate(
                formatPeriodoSlug({
                  tipo: 'trimestre',
                  anno: p.anno ?? annoCorrente,
                  trimestre: p.trimestre ?? 1,
                }),
              )
            }
            if (newTipo === 'mese') {
              return navigate(
                formatPeriodoSlug({
                  tipo: 'mese',
                  anno: p.anno ?? annoCorrente,
                  mese: p.mese ?? 1,
                }),
              )
            }
          }}
          className="text-xs bg-indigo-800 dark:bg-gray-900 text-white rounded px-2 py-1.5 sm:py-1 border border-indigo-500 dark:border-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-300"
        >
          <option value="tutto">Tutto</option>
          <option value="anno">Anno</option>
          <option value="trimestre">Trimestre</option>
          <option value="mese">Mese</option>
        </select>

        {p.tipo !== 'tutto' && (
          <select
            value={p.anno}
            onChange={e =>
              navigate(
                formatPeriodoSlug({
                  tipo: p.tipo,
                  anno: parseInt(e.target.value),
                  trimestre: p.trimestre,
                  mese: p.mese,
                }),
              )
            }
            className="text-xs bg-indigo-800 dark:bg-gray-900 text-white rounded px-2 py-1.5 sm:py-1 border border-indigo-500 dark:border-gray-600"
          >
            {anni.map(y => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        )}

        {p.tipo === 'trimestre' && (
          <select
            value={p.trimestre}
            onChange={e =>
              navigate(
                formatPeriodoSlug({
                  tipo: 'trimestre',
                  anno: p.anno,
                  trimestre: parseInt(e.target.value),
                }),
              )
            }
            className="text-xs bg-indigo-800 dark:bg-gray-900 text-white rounded px-2 py-1.5 sm:py-1 border border-indigo-500 dark:border-gray-600"
          >
            <option value={1}>Q1 (gen-mar)</option>
            <option value={2}>Q2 (apr-giu)</option>
            <option value={3}>Q3 (lug-set)</option>
            <option value={4}>Q4 (ott-dic)</option>
          </select>
        )}

        {p.tipo === 'mese' && (
          <select
            value={p.mese}
            onChange={e =>
              navigate(
                formatPeriodoSlug({
                  tipo: 'mese',
                  anno: p.anno,
                  mese: parseInt(e.target.value),
                }),
              )
            }
            className="text-xs bg-indigo-800 dark:bg-gray-900 text-white rounded px-2 py-1.5 sm:py-1 border border-indigo-500 dark:border-gray-600"
          >
            {MESI_LABELS.map((m, i) => (
              <option key={i} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        )}

        <span className="w-full text-xs text-indigo-200 dark:text-gray-400 sm:ml-auto sm:w-auto">
          {p.tipo !== 'tutto' ? (
            <>
              Filtro: <strong className="text-white">{p.from}</strong> →{' '}
              <strong className="text-white">{p.to}</strong>
            </>
          ) : (
            <em>Nessun filtro temporale — vedi tutto lo storico</em>
          )}
        </span>
      </div>
    </div>
  )
}

// Wrap in Suspense per via di useSearchParams (Next.js richiede boundary)
export default function PeriodoPicker() {
  return (
    <Suspense fallback={<div className="h-9 bg-indigo-700 dark:bg-gray-800" />}>
      <PeriodoPickerInner />
    </Suspense>
  )
}
