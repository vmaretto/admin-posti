-- =============== Upload allegato fatture estere ===============
-- Aggiunge il supporto al caricamento del PDF della fattura estera nello
-- Step 5 del wizard. La fattura non viene più solo "creata" da dati digitati:
-- si carica il file del fornitore, che viene salvato su Supabase Storage e
-- collegato alla fattura tramite il path dell'oggetto.

-- 1) Colonna sul record fattura con il path dell'oggetto su storage.
ALTER TABLE fatture
  ADD COLUMN IF NOT EXISTS allegato_path TEXT;

-- 2) Bucket privato dove vengono caricati i PDF delle fatture estere.
--    Upload e download avvengono server-side con la service role key, che
--    bypassa la RLS: non servono policy aggiuntive per l'app.
INSERT INTO storage.buckets (id, name, public)
VALUES ('fatture-estere', 'fatture-estere', false)
ON CONFLICT (id) DO NOTHING;
