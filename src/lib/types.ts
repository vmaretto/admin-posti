export type TipoFattura = 'emessa' | 'ricevuta'
export type TipoDocumento = 'fattura' | 'nota_credito'
export type StatoRiconciliazione = 'da_riconciliare' | 'riconciliata' | 'parziale' | 'non_trovata'
export type TipoConto = 'qonto' | 'paypal' | 'wise' | 'banca_sella'

export interface Fattura {
  id: string
  tipo: TipoFattura
  tipo_documento: TipoDocumento
  numero: string
  data_emissione: string
  data_ricezione?: string
  piva_fornitore?: string
  denominazione_fornitore?: string
  piva_cliente?: string
  denominazione_cliente?: string
  imponibile: number
  imposta: number
  totale: number
  stato_riconciliazione: StatoRiconciliazione
  transazione_id?: string
  fonte: string // es: 'sdi', 'pdf_amazon', etc
  created_at: string
}

export interface Transazione {
  id: string
  data: string
  importo: number
  tipo: 'entrata' | 'uscita'
  descrizione: string
  controparte?: string
  conto: TipoConto
  riferimento?: string
  fattura_id?: string
  stato_riconciliazione: StatoRiconciliazione
  created_at: string
}

export interface DashboardStats {
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
