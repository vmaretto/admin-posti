'use client'

import { useEffect, useState } from 'react'
import { ArrowUpCircle, ArrowDownCircle, FileText, CreditCard, CheckCircle, Clock } from 'lucide-react'

interface DashboardStats {
  totale_entrate: number
  totale_uscite: number
  da_incassare: number
  da_pagare: number
  fatture_emesse: number
  fatture_ricevute: number
  transazioni_totali: number
  riconciliate: number
  da_riconciliare: number
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amount)
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/dashboard')
      .then(res => res.json())
      .then(data => {
        setStats(data)
        setLoading(false)
      })
      .catch(err => {
        console.error(err)
        setLoading(false)
      })
  }, [])

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

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard pOsti SRL</h1>
      
      {/* Main Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-green-100">
              <ArrowUpCircle className="h-8 w-8 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Totale Entrate</p>
              <p className="text-2xl font-bold text-green-600">{formatCurrency(stats.totale_entrate)}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-red-100">
              <ArrowDownCircle className="h-8 w-8 text-red-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Totale Uscite</p>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(stats.totale_uscite)}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-blue-100">
              <Clock className="h-8 w-8 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Da Incassare</p>
              <p className="text-2xl font-bold text-blue-600">{formatCurrency(stats.da_incassare)}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center">
            <div className="p-3 rounded-full bg-orange-100">
              <Clock className="h-8 w-8 text-orange-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-500">Da Pagare</p>
              <p className="text-2xl font-bold text-orange-600">{formatCurrency(stats.da_pagare)}</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Secondary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Fatture</h3>
            <FileText className="h-6 w-6 text-gray-400" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Emesse</span>
              <span className="font-semibold">{stats.fatture_emesse}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Ricevute</span>
              <span className="font-semibold">{stats.fatture_ricevute}</span>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Transazioni</h3>
            <CreditCard className="h-6 w-6 text-gray-400" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Totali</span>
              <span className="font-semibold">{stats.transazioni_totali}</span>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Riconciliazione</h3>
            <CheckCircle className="h-6 w-6 text-gray-400" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-600">Riconciliate</span>
              <span className="font-semibold text-green-600">{stats.riconciliate}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Da riconciliare</span>
              <span className="font-semibold text-orange-600">{stats.da_riconciliare}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
