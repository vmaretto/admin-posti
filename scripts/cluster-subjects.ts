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

// Normalize a name for comparison
function normalize(name: string): string {
  let n = name.toLowerCase().trim()
  
  // Remove punctuation and extra spaces
  n = n.replace(/[.,\-'"()\/\\]/g, ' ')
  n = n.replace(/\s+/g, ' ').trim()
  
  // Remove legal suffixes
  for (const suffix of LEGAL_SUFFIXES) {
    const regex = new RegExp(`\\b${suffix.replace(/\./g, '\\.')}\\b`, 'gi')
    n = n.replace(regex, '')
  }
  
  // Clean up again
  n = n.replace(/\s+/g, ' ').trim()
  
  return n
}

// Calculate similarity (0-100%)
function similarity(a: string, b: string): number {
  const normA = normalize(a)
  const normB = normalize(b)
  
  if (normA === normB) return 100
  
  // If one is contained in the other
  if (normA.includes(normB) || normB.includes(normA)) {
    return 90
  }
  
  // Levenshtein distance based similarity
  const maxLen = Math.max(normA.length, normB.length)
  if (maxLen === 0) return 100
  
  const dist = distance(normA, normB)
  return Math.round((1 - dist / maxLen) * 100)
}

// Choose the best "main" name from variants (most complete)
function choosePrimaryName(variants: string[]): string {
  return variants.reduce((best, current) => {
    // Prefer longer names (more complete)
    // Prefer names with proper capitalization
    const currentScore = current.length + (current !== current.toUpperCase() ? 10 : 0)
    const bestScore = best.length + (best !== best.toUpperCase() ? 10 : 0)
    return currentScore > bestScore ? current : best
  })
}

interface Cluster {
  nome_normalizzato: string
  varianti: string[]
}

async function extractAllSubjects(): Promise<string[]> {
  const subjects = new Set<string>()
  
  // Get from fatture
  const { data: fatture } = await supabase
    .from('fatture')
    .select('denominazione_fornitore, denominazione_cliente')
    .range(0, 9999)
  
  for (const f of fatture || []) {
    if (f.denominazione_fornitore) subjects.add(f.denominazione_fornitore.trim())
    if (f.denominazione_cliente) subjects.add(f.denominazione_cliente.trim())
  }
  
  // Get from transazioni
  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('controparte')
    .range(0, 9999)
  
  for (const t of transazioni || []) {
    if (t.controparte) subjects.add(t.controparte.trim())
  }
  
  return Array.from(subjects).filter(s => s.length > 1)
}

async function clusterSubjects() {
  console.log('Clustering subjects...\n')
  
  const subjects = await extractAllSubjects()
  console.log(`Found ${subjects.length} unique subjects\n`)
  
  const SIMILARITY_THRESHOLD = 80
  const clusters: Cluster[] = []
  const assigned = new Set<string>()
  
  // Sort by normalized name for consistent processing
  subjects.sort((a, b) => normalize(a).localeCompare(normalize(b)))
  
  for (const subject of subjects) {
    if (assigned.has(subject)) continue
    
    // Find all similar subjects
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
  
  // Sort clusters by normalized name
  clusters.sort((a, b) => a.nome_normalizzato.localeCompare(b.nome_normalizzato))
  
  console.log(`\n=== ${clusters.length} CLUSTERS ===\n`)
  
  // Show only clusters with multiple variants
  const multiClusters = clusters.filter(c => c.varianti.length > 1)
  console.log(`Clusters with multiple variants: ${multiClusters.length}\n`)
  
  for (const cluster of multiClusters) {
    console.log(`📁 ${cluster.nome_normalizzato}`)
    for (const v of cluster.varianti) {
      console.log(`   - ${v}`)
    }
    console.log()
  }
  
  return { clusters }
}

async function saveToDatabase(clusters: Cluster[]) {
  console.log('\nSaving clusters to database...')
  
  // Clear existing clusters
  await supabase.from('soggetti_cluster').delete().neq('id', '00000000-0000-0000-0000-000000000000')
  
  // Insert new clusters
  const { error } = await supabase
    .from('soggetti_cluster')
    .insert(clusters.map(c => ({
      nome_normalizzato: c.nome_normalizzato,
      varianti: c.varianti
    })))
  
  if (error) {
    console.error('Error saving clusters:', error)
    return false
  }
  
  console.log(`Saved ${clusters.length} clusters`)
  return true
}

async function main() {
  const { clusters } = await clusterSubjects()
  
  // Ask if should save
  const args = process.argv.slice(2)
  if (args.includes('--save')) {
    await saveToDatabase(clusters)
  } else {
    console.log('\nRun with --save to persist to database')
  }
  
  // Output JSON
  if (args.includes('--json')) {
    console.log('\n' + JSON.stringify({ clusters }, null, 2))
  }
}

main()
