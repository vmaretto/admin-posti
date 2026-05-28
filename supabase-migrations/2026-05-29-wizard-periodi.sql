-- Migration: tabella wizard_periodi
-- Esegui questa SQL dallo Supabase SQL Editor.
-- Tiene traccia dei periodi (annuali/trimestrali/mensili) in lavorazione
-- nel wizard e dello step raggiunto. Le decisioni concrete (tralasciato,
-- soggetto assegnato, fattura caricata) restano sulle entità esistenti
-- (transazioni, fatture); qui memorizziamo SOLO l'avanzamento.

CREATE TABLE IF NOT EXISTS wizard_periodi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('annuale', 'trimestrale', 'mensile')),
  anno INTEGER NOT NULL,
  trimestre INTEGER, -- 1..4 se tipo='trimestrale'
  mese INTEGER, -- 1..12 se tipo='mensile'
  step_corrente INTEGER NOT NULL DEFAULT 0,
  completato BOOLEAN NOT NULL DEFAULT false,
  -- coda fornitori esteri identificati allo step 4 (array di transazione_id)
  trans_estere_queue UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indice univoco: un solo "record di avanzamento" per periodo concreto.
-- COALESCE per gestire NULL su trimestre/mese senza conflitti.
CREATE UNIQUE INDEX IF NOT EXISTS wizard_periodi_unique
  ON wizard_periodi (tipo, anno, COALESCE(trimestre, 0), COALESCE(mese, 0));

-- Trigger per updated_at auto
CREATE OR REPLACE FUNCTION wizard_periodi_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_wizard_periodi_updated_at ON wizard_periodi;
CREATE TRIGGER trg_wizard_periodi_updated_at
  BEFORE UPDATE ON wizard_periodi
  FOR EACH ROW
  EXECUTE FUNCTION wizard_periodi_touch_updated_at();
