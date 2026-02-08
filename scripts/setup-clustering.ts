import { createClient } from '@supabase/supabase-js'
import { distance } from 'fastest-levenshtein'

const supabaseUrl = 'https://pwhqkdivgumrsubpinrv.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Legal suffixes to strip for normalization
const LEGAL_SUFFIXES = [
  'srl', 's.r.l.', 's.r.l', 'srls', 's.r.l.s.',
  'spa', 's.p.a.', 's.p.a',
  'sas', 's.a.s.', 's.a.s',
  'snc', 's.n.c.', 's.n.c',
  'ltd', 'limited', 'llc', 'l.l.c.',
  'gmbh', 'g.m.b.h.',
  'inc', 'inc.', 'incorporated',
  'corp', 'corp.', 'corporation',
  'soc. coop.', 'societa cooperativa', 'soc coop',
  'di', 'e', '&'
]

function normalize(name: string): string {
  let n = name.toLowerCase().trim()
  n = n.replace(/[.,\-'"()\/\\]/g, ' ')
  n = n.replace(/\s+/g, ' ').trim()
  
  for (const suffix of LEGAL_SUFFIXES) {
    const regex = new RegExp(`\\b${suffix.replace(/\./g, '\\.')}\\b`, 'gi')
    n = n.replace(regex, '')
  }
  
  n = n.replace(/\s+/g, ' ').trim()
  return n
}

function similarity(a: string, b: string): number {
  const normA = normalize(a)
  const normB = normalize(b)
  
  if (normA === normB) return 100
  if (normA.includes(normB) || normB.includes(normA)) return 90
  
  const maxLen = Math.max(normA.length, normB.length)
  if (maxLen === 0) return 100
  
  const dist = distance(normA, normB)
  return Math.round((1 - dist / maxLen) * 100)
}

function choosePrimaryName(variants: string[]): string {
  return variants.reduce((best, current) => {
    const currentScore = current.length + (current !== current.toUpperCase() ? 10 : 0)
    const bestScore = best.length + (best !== best.toUpperCase() ? 10 : 0)
    return currentScore > bestScore ? current : best
  })
}

interface Cluster {
  nome_normalizzato: string
  varianti: string[]
}

async function checkTableExists(): Promise<boolean> {
  const { error } = await supabase.from('soggetti_cluster').select('id').limit(1)
  return !error || error.code !== 'PGRST205'
}

async function extractAllSubjects(): Promise<string[]> {
  const subjects = new Set<string>()
  
  const { data: fatture } = await supabase
    .from('fatture')
    .select('denominazione_fornitore, denominazione_cliente')
    .range(0, 9999)
  
  for (const f of fatture || []) {
    if (f.denominazione_fornitore) subjects.add(f.denominazione_fornitore.trim())
    if (f.denominazione_cliente) subjects.add(f.denominazione_cliente.trim())
  }
  
  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('controparte')
    .range(0, 9999)
  
  for (const t of transazioni || []) {
    if (t.controparte) subjects.add(t.controparte.trim())
  }
  
  return Array.from(subjects).filter(s => s.length > 1)
}

async function clusterSubjects(): Promise<Cluster[]> {
  const subjects = await extractAllSubjects()
  console.log(`Found ${subjects.length} unique subjects`)
  
  const SIMILARITY_THRESHOLD = 80
  const clusters: Cluster[] = []
  const assigned = new Set<string>()
  
  subjects.sort((a, b) => normalize(a).localeCompare(normalize(b)))
  
  for (const subject of subjects) {
    if (assigned.has(subject)) continue
    
    const variants = [subject]
    assigned.add(subject)
    
    for (const other of subjects) {
      if (assigned.has(other)) continue
      
      const sim = similarity(subject, other)
      if (sim >= SIMILARITY_THRESHOLD) {
        variants.push(other)
        assigned.add(other)
      }
    }
    
    const primaryName = choosePrimaryName(variants)
    
    clusters.push({
      nome_normalizzato: normalize(primaryName),
      varianti: variants.sort()
    })
  }
  
  clusters.sort((a, b) => a.nome_normalizzato.localeCompare(b.nome_normalizzato))
  return clusters
}

async function saveToDatabase(clusters: Cluster[]) {
  console.log('Clearing existing clusters...')
  await supabase.from('soggetti_cluster').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  
  console.log(`Inserting ${clusters.length} clusters...`)
  
  // Insert in batches
  const batchSize = 100
  for (let i = 0; i < clusters.length; i += batchSize) {
    const batch = clusters.slice(i, i + batchSize)
    const { error } = await supabase
      .from('soggetti_cluster')
      .insert(batch.map(c => ({
        nome_normalizzato: c.nome_normalizzato,
        varianti: c.varianti
      })))
    
    if (error) {
      console.error(`Error inserting batch ${i}:`, error)
      return false
    }
  }
  
  console.log('Done!')
  return true
}

async function main() {
  console.log('=== Setup Soggetti Clustering ===\n')
  
  // Check if table exists
  const tableExists = await checkTableExists()
  
  if (!tableExists) {
    console.log('❌ Table soggetti_cluster does not exist!')
    console.log('\n📋 Run this SQL in Supabase Dashboard:')
    console.log('https://supabase.com/dashboard/project/pwhqkdivgumrsubpinrv/sql\n')
    console.log(`
CREATE TABLE IF NOT EXISTS soggetti_cluster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_normalizzato TEXT NOT NULL UNIQUE,
  varianti TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_soggetti_cluster_nome ON soggetti_cluster(nome_normalizzato);

ALTER TABLE soggetti_cluster ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON soggetti_cluster FOR SELECT USING (true);
CREATE POLICY "Allow service role all" ON soggetti_cluster FOR ALL USING (true);
`)
    console.log('\nThen run this script again.')
    process.exit(1)
  }
  
  console.log('✅ Table exists\n')
  
  // Cluster subjects
  console.log('Clustering subjects...')
  const clusters = await clusterSubjects()
  
  console.log(`\nGenerated ${clusters.length} clusters`)
  console.log(`Clusters with multiple variants: ${clusters.filter(c => c.varianti.length > 1).length}\n`)
  
  // Save to database
  await saveToDatabase(clusters)
  
  // Show summary
  const { count } = await supabase.from('soggetti_cluster').select('*', { count: 'exact', head: true })
  console.log(`\n✅ Saved ${count} clusters to database`)
}

main()
