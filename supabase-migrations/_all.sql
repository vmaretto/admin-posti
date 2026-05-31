-- Esegui questo file su un Supabase nuovo per ricreare tutte le tabelle
-- aggiuntive (non sono incluse le tabelle "core" fatture/transazioni/
-- riconciliazioni/soggetti_cluster che sono nello schema esistente di pOsti).
--
-- Idempotente: tutte le statement usano IF NOT EXISTS / ON CONFLICT.

-- =============== wizard_periodi ===============
CREATE TABLE IF NOT EXISTS wizard_periodi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('annuale', 'trimestrale', 'mensile')),
  anno INTEGER NOT NULL,
  trimestre INTEGER,
  mese INTEGER,
  step_corrente INTEGER NOT NULL DEFAULT 0,
  completato BOOLEAN NOT NULL DEFAULT false,
  trans_estere_queue UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wizard_periodi_unique
  ON wizard_periodi (tipo, anno, COALESCE(trimestre, 0), COALESCE(mese, 0));

CREATE OR REPLACE FUNCTION wizard_periodi_touch_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_wizard_periodi_updated_at ON wizard_periodi;
CREATE TRIGGER trg_wizard_periodi_updated_at
  BEFORE UPDATE ON wizard_periodi
  FOR EACH ROW EXECUTE FUNCTION wizard_periodi_touch_updated_at();

-- =============== conti_config ===============
CREATE TABLE IF NOT EXISTS conti_config (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  has_parser BOOLEAN NOT NULL DEFAULT false,
  ordine INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO conti_config (key, label, has_parser, ordine) VALUES
  ('qonto',       'Qonto',       true,  10),
  ('sella_conto', 'Sella conto', true,  20),
  ('sella_carta', 'Sella carta', true,  30),
  ('paypal',      'PayPal',      true,  40),
  ('revolut',     'Revolut',     true,  50)
ON CONFLICT (key) DO NOTHING;

-- =============== soggetti_alias + match_history ===============
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

CREATE TABLE IF NOT EXISTS match_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fattura_id UUID,
  transazione_id UUID,
  soggetto_canonico TEXT,
  giorni_diff INT,
  importo_diff NUMERIC,
  importo_diff_pct NUMERIC,
  score INT,
  source TEXT NOT NULL CHECK (source IN ('manual', 'auto', 'wizard', 'llm', 'unmatch')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_history_soggetto_idx ON match_history (soggetto_canonico);
CREATE INDEX IF NOT EXISTS match_history_fattura_idx ON match_history (fattura_id);
CREATE INDEX IF NOT EXISTS match_history_trans_idx ON match_history (transazione_id);

-- =============== auto_tralascia_rules ===============
CREATE TABLE IF NOT EXISTS auto_tralascia_rules (
  controparte_normalizzata TEXT PRIMARY KEY,
  controparte_display TEXT NOT NULL,
  motivo TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'wizard')),
  applicazioni INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_applied_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auto_tralascia_motivo_idx ON auto_tralascia_rules (motivo);

-- =============== Upload allegato fatture estere ===============
ALTER TABLE fatture
  ADD COLUMN IF NOT EXISTS allegato_path TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('fatture-estere', 'fatture-estere', false)
ON CONFLICT (id) DO NOTHING;
