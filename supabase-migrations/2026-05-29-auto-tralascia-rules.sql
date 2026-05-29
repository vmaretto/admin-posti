-- Migration: tabella auto_tralascia_rules
-- Esegui dal SQL Editor di Supabase.
--
-- Memorizza le regole "tralascia SEMPRE le trans con questa controparte
-- normalizzata, con questa motivazione". Si popola automaticamente quando
-- l'utente sceglie "Tralascia (memorizza regola)" allo Step 4 del wizard.
-- Si applica automaticamente alle trans scoperte dei periodi successivi.

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
