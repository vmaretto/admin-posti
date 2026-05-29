-- Migration: tabelle per il match intelligente
-- Esegui dal SQL Editor di Supabase.

-- soggetti_alias: mappa variant-name -> soggetto canonico.
-- Popolata automaticamente quando l'utente fa: match manuale (drag&drop),
-- accorpamento di soggetti, rinomina soggetto. Si arricchisce sull'uso.
CREATE TABLE IF NOT EXISTS soggetti_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_normalizzata TEXT NOT NULL,
  soggetto_canonico TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'auto_match', 'merge', 'rename', 'llm')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT soggetti_alias_unique UNIQUE (variant_normalizzata, soggetto_canonico)
);

CREATE INDEX IF NOT EXISTS soggetti_alias_variant_idx ON soggetti_alias (variant_normalizzata);
CREATE INDEX IF NOT EXISTS soggetti_alias_canonico_idx ON soggetti_alias (soggetto_canonico);

-- match_history: log di ogni match (auto/manuale/wizard/LLM).
-- Serve per il learning dei giorni di pagamento per soggetto (PUSH 2)
-- e per il tuning delle soglie sulla base dei feedback.
CREATE TABLE IF NOT EXISTS match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fattura_id UUID,
  transazione_id UUID,
  soggetto_canonico TEXT,
  giorni_diff INT,
  importo_diff NUMERIC,
  importo_diff_pct NUMERIC,
  score INT,
  source TEXT NOT NULL
    CHECK (source IN ('manual', 'auto', 'wizard', 'llm', 'unmatch')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS match_history_soggetto_idx ON match_history (soggetto_canonico);
CREATE INDEX IF NOT EXISTS match_history_fattura_idx ON match_history (fattura_id);
CREATE INDEX IF NOT EXISTS match_history_trans_idx ON match_history (transazione_id);
