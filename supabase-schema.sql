-- Schema per Admin pOsti - Riconciliazione Fatture/Transazioni

-- Tabella Fatture
CREATE TABLE IF NOT EXISTS fatture (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('emessa', 'ricevuta')),
  tipo_documento VARCHAR(20) NOT NULL DEFAULT 'fattura' CHECK (tipo_documento IN ('fattura', 'nota_credito')),
  numero VARCHAR(100) NOT NULL,
  data_emissione DATE NOT NULL,
  data_ricezione DATE,
  piva_fornitore VARCHAR(20),
  denominazione_fornitore VARCHAR(500),
  piva_cliente VARCHAR(20),
  denominazione_cliente VARCHAR(500),
  imponibile DECIMAL(12,2) NOT NULL DEFAULT 0,
  imposta DECIMAL(12,2) NOT NULL DEFAULT 0,
  totale DECIMAL(12,2) GENERATED ALWAYS AS (imponibile + imposta) STORED,
  stato_riconciliazione VARCHAR(20) NOT NULL DEFAULT 'da_riconciliare' 
    CHECK (stato_riconciliazione IN ('da_riconciliare', 'riconciliata', 'parziale', 'non_trovata')),
  transazione_id UUID,
  fonte VARCHAR(100) NOT NULL DEFAULT 'sdi',
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(numero, data_emissione, tipo)
);

-- Tabella Transazioni
CREATE TABLE IF NOT EXISTS transazioni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data DATE NOT NULL,
  importo DECIMAL(12,2) NOT NULL,
  tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('entrata', 'uscita')),
  descrizione TEXT,
  controparte VARCHAR(500),
  conto VARCHAR(20) NOT NULL CHECK (conto IN ('qonto', 'paypal', 'wise', 'banca_sella')),
  riferimento VARCHAR(200),
  fattura_id UUID REFERENCES fatture(id),
  stato_riconciliazione VARCHAR(20) NOT NULL DEFAULT 'da_riconciliare'
    CHECK (stato_riconciliazione IN ('da_riconciliare', 'riconciliata', 'parziale', 'non_trovata')),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(data, importo, conto, riferimento)
);

-- Indici per performance
CREATE INDEX IF NOT EXISTS idx_fatture_data ON fatture(data_emissione);
CREATE INDEX IF NOT EXISTS idx_fatture_tipo ON fatture(tipo);
CREATE INDEX IF NOT EXISTS idx_fatture_stato ON fatture(stato_riconciliazione);
CREATE INDEX IF NOT EXISTS idx_fatture_totale ON fatture(totale);

CREATE INDEX IF NOT EXISTS idx_transazioni_data ON transazioni(data);
CREATE INDEX IF NOT EXISTS idx_transazioni_conto ON transazioni(conto);
CREATE INDEX IF NOT EXISTS idx_transazioni_stato ON transazioni(stato_riconciliazione);
CREATE INDEX IF NOT EXISTS idx_transazioni_importo ON transazioni(importo);

-- Foreign key da fatture a transazioni
ALTER TABLE fatture 
  ADD CONSTRAINT fk_fatture_transazione 
  FOREIGN KEY (transazione_id) REFERENCES transazioni(id);

-- Trigger per updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_fatture_updated_at BEFORE UPDATE ON fatture
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transazioni_updated_at BEFORE UPDATE ON transazioni
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Vista per dashboard
CREATE OR REPLACE VIEW dashboard_stats AS
SELECT
  COALESCE(SUM(CASE WHEN t.tipo = 'entrata' THEN t.importo ELSE 0 END), 0) as totale_entrate,
  COALESCE(SUM(CASE WHEN t.tipo = 'uscita' THEN ABS(t.importo) ELSE 0 END), 0) as totale_uscite,
  (SELECT COALESCE(SUM(totale), 0) FROM fatture WHERE tipo = 'emessa' AND stato_riconciliazione = 'da_riconciliare') as da_incassare,
  (SELECT COALESCE(SUM(totale), 0) FROM fatture WHERE tipo = 'ricevuta' AND stato_riconciliazione = 'da_riconciliare') as da_pagare,
  (SELECT COUNT(*) FROM fatture WHERE tipo = 'emessa') as fatture_emesse,
  (SELECT COUNT(*) FROM fatture WHERE tipo = 'ricevuta') as fatture_ricevute,
  (SELECT COUNT(*) FROM transazioni) as transazioni_totali,
  (SELECT COUNT(*) FROM fatture WHERE stato_riconciliazione = 'riconciliata') + 
    (SELECT COUNT(*) FROM transazioni WHERE stato_riconciliazione = 'riconciliata') as riconciliate,
  (SELECT COUNT(*) FROM fatture WHERE stato_riconciliazione = 'da_riconciliare') + 
    (SELECT COUNT(*) FROM transazioni WHERE stato_riconciliazione = 'da_riconciliare') as da_riconciliare
FROM transazioni t;

-- Tabella Soggetti Cluster (per aggregazione varianti stesso soggetto)
CREATE TABLE IF NOT EXISTS soggetti_cluster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_normalizzato TEXT NOT NULL UNIQUE,
  varianti TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soggetti_cluster_nome ON soggetti_cluster(nome_normalizzato);

-- Tabella Riconciliazioni (per tracciare associazioni)
CREATE TABLE IF NOT EXISTS riconciliazioni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fattura_id UUID REFERENCES fatture(id),
  transazione_id UUID REFERENCES transazioni(id),
  importo DECIMAL(12,2),
  tipo VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fattura_id, transazione_id)
);

-- RLS policies (disabled for simplicity - single user app)
ALTER TABLE fatture ENABLE ROW LEVEL SECURITY;
ALTER TABLE transazioni ENABLE ROW LEVEL SECURITY;
ALTER TABLE soggetti_cluster ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on fatture" ON fatture FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on transazioni" ON transazioni FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on soggetti_cluster" ON soggetti_cluster FOR ALL USING (true) WITH CHECK (true);
