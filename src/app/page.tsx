'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState, useMemo, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { FileText, CreditCard, AlertCircle, HelpCircle, TrendingUp, Euro } from 'lucide-react'
import { parsePeriodo, defaultPeriodoSlug } from '@/lib/periodo'

interface DashboardStats {
  fatture: {
    totali: number
    riconciliate: number
    da_confermare: number
    manuali: number
    importo_totale: number
    importo_riconciliato: number
  }
  transazioni: {
    totali: number
    riconciliate: number
    non_riconciliate: number
    importo_incassi: number
    importo_riconciliato: number
  }
  // Legacy
  totale_entrate: number
  totale_uscite: number
  da_incassare: number
  da_pagare: number
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

function ProgressBar({ value, max, color = 'indigo' }: { value: number; max: number; color?: string }) {
  const percent = max > 0 ? Math.round((value / max) * 100) : 0
  const colorClasses: Record<string, string> = {
    indigo: 'bg-indigo-600',
    green: 'bg-green-600',
    yellow: 'bg-yellow-500',
    red: 'bg-red-500'
  }
  
  return (
    <div className="w-full">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600 dark:text-gray-400">{value.toLocaleString('it-IT')} / {max.toLocaleString('it-IT')}</span>
        <span className="font-semibold text-gray-900 dark:text-white">{percent}%</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
        <div
          className={`${colorClasses[color]} h-3 rounded-full transition-all duration-500`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

function StatCard({ 
  icon: Icon, 
  label, 
  value, 
  subValue, 
  color = 'gray',
  bgColor = 'gray'
}: { 
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | number
  subValue?: string
  color?: string
  bgColor?: string
}) {
  const iconColorClasses: Record<string, string> = {
    gray: 'text-gray-600',
    green: 'text-green-600',
    yellow: 'text-yellow-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
    indigo: 'text-indigo-600'
  }
  const bgColorClasses: Record<string, string> = {
    gray: 'bg-gray-100 dark:bg-gray-700',
    green: 'bg-green-100 dark:bg-green-900/30',
    yellow: 'bg-yellow-100 dark:bg-yellow-900/30',
    red: 'bg-red-100 dark:bg-red-900/30',
    blue: 'bg-blue-100 dark:bg-blue-900/30',
    indigo: 'bg-indigo-100 dark:bg-indigo-900/30'
  }
  
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className={`text-3xl font-bold mt-2 ${iconColorClasses[color]}`}>{value}</p>
          {subValue && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{subValue}</p>
          )}
        </div>
        <div className={`p-3 rounded-lg ${bgColorClasses[bgColor]}`}>
          <Icon className={`h-6 w-6 ${iconColorClasses[color]}`} />
        </div>
      </div>
    </div>
  )
}

function DashboardInner() {
  const searchParams = useSearchParams()
  const periodo = useMemo(
    () => parsePeriodo(searchParams.get('periodo') || defaultPeriodoSlug()),
    [searchParams],
  )
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    let url = '/api/dashboard'
    if (periodo.from && periodo.to) {
      url += `?from=${periodo.from}&to=${periodo.to}`
    }
    fetch(url)
      .then(res => res.json())
      .then(data => {
        setStats(data)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }, [periodo.from, periodo.to])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (!stats) {
    return <div className="text-red-500">Errore nel caricamento dei dati</div>
  }

  const fatturePercent = stats.fatture.totali > 0 
    ? Math.round((stats.fatture.riconciliate / stats.fatture.totali) * 100) 
    : 0
  const transazioniPercent = stats.transazioni.totali > 0 
    ? Math.round((stats.transazioni.riconciliate / stats.transazioni.totali) * 100) 
    : 0

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard pOsti SRL</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Panoramica riconciliazione</p>
      </div>
      
      {/* Main Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={FileText}
          label="📄 Fatture"
          value={stats.fatture.totali.toLocaleString('it-IT')}
          subValue={`${stats.fatture.riconciliate} riconciliate (${fatturePercent}%)`}
          color="indigo"
          bgColor="indigo"
        />
        
        <StatCard
          icon={CreditCard}
          label="💳 Transazioni"
          value={stats.transazioni.totali.toLocaleString('it-IT')}
          subValue={`${stats.transazioni.riconciliate} riconciliate (${transazioniPercent}%)`}
          color="blue"
          bgColor="blue"
        />
        
        <StatCard
          icon={AlertCircle}
          label="🟡 Da confermare"
          value={stats.fatture.da_confermare}
          subValue="Fatture con suggerimenti"
          color="yellow"
          bgColor="yellow"
        />
        
        <StatCard
          icon={HelpCircle}
          label="🔴 Manuali"
          value={stats.fatture.manuali}
          subValue="Fatture senza match"
          color="red"
          bgColor="red"
        />
      </div>
      
      {/* Progress Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <FileText className="h-5 w-5 text-indigo-600" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Riconciliazione Fatture</h3>
          </div>
          <ProgressBar 
            value={stats.fatture.riconciliate} 
            max={stats.fatture.totali} 
            color="indigo"
          />
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Importo totale</span>
              <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(stats.fatture.importo_totale)}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Importo riconciliato</span>
              <p className="font-semibold text-green-600">{formatCurrency(stats.fatture.importo_riconciliato)}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center gap-3 mb-4">
            <CreditCard className="h-5 w-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Riconciliazione Transazioni</h3>
          </div>
          <ProgressBar 
            value={stats.transazioni.riconciliate} 
            max={stats.transazioni.totali} 
            color="indigo"
          />
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">Importo incassi</span>
              <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(stats.transazioni.importo_incassi)}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Importo riconciliato</span>
              <p className="font-semibold text-green-600">{formatCurrency(stats.transazioni.importo_riconciliato)}</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Financial Summary */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-6">
          <Euro className="h-5 w-5 text-green-600" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">💰 Riepilogo Importi</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
            <p className="text-sm text-green-600 dark:text-green-400">Totale Entrate</p>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{formatCurrency(stats.totale_entrate)}</p>
          </div>
          
          <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">Totale Uscite</p>
            <p className="text-2xl font-bold text-red-700 dark:text-red-300">{formatCurrency(stats.totale_uscite)}</p>
          </div>
          
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <p className="text-sm text-blue-600 dark:text-blue-400">Da Incassare</p>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{formatCurrency(stats.da_incassare)}</p>
          </div>
          
          <div className="p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg">
            <p className="text-sm text-orange-600 dark:text-orange-400">Da Pagare</p>
            <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">{formatCurrency(stats.da_pagare)}</p>
          </div>
        </div>
        
        {/* Net Balance */}
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              <span className="text-gray-600 dark:text-gray-400">Saldo Netto (Entrate - Uscite)</span>
            </div>
            <span className={`text-2xl font-bold ${
              stats.totale_entrate - stats.totale_uscite >= 0 
                ? 'text-green-600' 
                : 'text-red-600'
            }`}>
              {formatCurrency(stats.totale_entrate - stats.totale_uscite)}
            </span>
          </div>
        </div>
      </div>
      
      {/* Status Breakdown Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">📊 Stato Fatture</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green-500"></span>
                <span className="text-gray-600 dark:text-gray-300">Riconciliate</span>
              </span>
              <span className="font-semibold text-green-600">{stats.fatture.riconciliate}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-yellow-500"></span>
                <span className="text-gray-600 dark:text-gray-300">Da confermare</span>
              </span>
              <span className="font-semibold text-yellow-600">{stats.fatture.da_confermare}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500"></span>
                <span className="text-gray-600 dark:text-gray-300">Manuali</span>
              </span>
              <span className="font-semibold text-red-600">{stats.fatture.manuali}</span>
            </div>
          </div>
        </div>
        
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">📊 Stato Transazioni</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green-500"></span>
                <span className="text-gray-600 dark:text-gray-300">Riconciliate</span>
              </span>
              <span className="font-semibold text-green-600">{stats.transazioni.riconciliate}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-orange-500"></span>
                <span className="text-gray-600 dark:text-gray-300">Non riconciliate</span>
              </span>
              <span className="font-semibold text-orange-600">{stats.transazioni.non_riconciliate}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-gray-500">Caricamento…</div>}>
      <DashboardInner />
    </Suspense>
  )
}
