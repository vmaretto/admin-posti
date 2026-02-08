-- Execute this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/pwhqkdivgumrsubpinrv/sql/new

CREATE TABLE IF NOT EXISTS soggetti_cluster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_normalizzato TEXT NOT NULL UNIQUE,
  varianti TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soggetti_cluster_nome ON soggetti_cluster(nome_normalizzato);

ALTER TABLE soggetti_cluster ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on soggetti_cluster" ON soggetti_cluster FOR ALL USING (true) WITH CHECK (true);
