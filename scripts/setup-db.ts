import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://pwhqkdivgumrsubpinrv.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function setup() {
  console.log('Checking if tables exist...')
  
  // Try to query fatture table
  const { error: fattureError } = await supabase.from('fatture').select('id').limit(1)
  
  if (fattureError?.code === '42P01') {
    console.log('Tables do not exist. Please run the SQL schema in Supabase Dashboard:')
    console.log('1. Go to https://supabase.com/dashboard/project/pwhqkdivgumrsubpinrv/sql')
    console.log('2. Copy the content of supabase-schema.sql')
    console.log('3. Paste and run')
  } else if (fattureError) {
    console.error('Error:', fattureError)
  } else {
    console.log('Tables already exist!')
    
    // Get counts
    const { count: fattureCount } = await supabase.from('fatture').select('*', { count: 'exact', head: true })
    const { count: transCount } = await supabase.from('transazioni').select('*', { count: 'exact', head: true })
    
    console.log(`Fatture: ${fattureCount}`)
    console.log(`Transazioni: ${transCount}`)
  }
}

setup()
