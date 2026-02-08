-- Execute this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/pwhqkdivgumrsubpinrv/sql

CREATE TABLE IF NOT EXISTS soggetti_cluster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_normalizzato TEXT NOT NULL UNIQUE,
  varianti TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_soggetti_cluster_nome ON soggetti_cluster(nome_normalizzato);

-- Enable RLS
ALTER TABLE soggetti_cluster ENABLE ROW LEVEL SECURITY;

-- Allow public read
CREATE POLICY IF NOT EXISTS "Allow public read on soggetti_cluster" 
ON soggetti_cluster FOR SELECT USING (true);

-- Allow service role full access
CREATE POLICY IF NOT EXISTS "Allow service role full access on soggetti_cluster"
ON soggetti_cluster FOR ALL USING (true) WITH CHECK (true);
