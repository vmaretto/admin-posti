import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pwhqkdivgumrsubpinrv.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function extractSubjects() {
  console.log('Extracting all subjects from fatture and transazioni...\n')
  
  const subjects = new Set<string>()
  
  // Get all soggetto from fatture (denominazione_fornitore and denominazione_cliente)
  console.log('Fetching fatture...')
  const { data: fatture, error: fattureError } = await supabase
    .from('fatture')
    .select('denominazione_fornitore, denominazione_cliente')
    .range(0, 9999)
  
  if (fattureError) {
    console.error('Error fetching fatture:', fattureError)
    return
  }
  
  for (const f of fatture || []) {
    if (f.denominazione_fornitore) subjects.add(f.denominazione_fornitore.trim())
    if (f.denominazione_cliente) subjects.add(f.denominazione_cliente.trim())
  }
  
  console.log(`Found ${subjects.size} unique subjects from fatture`)
  
  // Get all controparte from transazioni
  console.log('Fetching transazioni...')
  const { data: transazioni, error: transError } = await supabase
    .from('transazioni')
    .select('controparte')
    .range(0, 9999)
  
  if (transError) {
    console.error('Error fetching transazioni:', transError)
    return
  }
  
  for (const t of transazioni || []) {
    if (t.controparte) subjects.add(t.controparte.trim())
  }
  
  console.log(`Total unique subjects after transazioni: ${subjects.size}`)
  
  // Filter out empty and very short names
  const filteredSubjects = Array.from(subjects)
    .filter(s => s.length > 1)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  
  console.log(`\n=== ${filteredSubjects.length} UNIQUE SUBJECTS ===\n`)
  filteredSubjects.forEach(s => console.log(`  - ${s}`))
  
  return filteredSubjects
}

extractSubjects()
