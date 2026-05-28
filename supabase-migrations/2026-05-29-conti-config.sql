-- Migration: tabella conti_config
-- Esegui dal SQL Editor di Supabase.
-- Mantiene la lista delle "fonti" attese (conti bancari, carte, exchange,
-- ecc.) che il wizard Step 1 mostra come tile, anche se per il periodo
-- selezionato non ci sono ancora movimenti caricati nel DB. L'utente può
-- aggiungere/rimuovere fonti senza ridistribuzione codice.

CREATE TABLE IF NOT EXISTS conti_config (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  has_parser BOOLEAN NOT NULL DEFAULT false,
  ordine INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed iniziale con i 5 conti correnti (Wise rimosso come da richiesta).
-- has_parser=true solo per i conti già supportati in /api/import.
INSERT INTO conti_config (key, label, has_parser, ordine) VALUES
  ('qonto',       'Qonto',       false, 10),
  ('sella_conto', 'Sella conto', false, 20),
  ('sella_carta', 'Sella carta', false, 30),
  ('paypal',      'PayPal',      true,  40),
  ('revolut',     'Revolut',     false, 50)
ON CONFLICT (key) DO NOTHING;
