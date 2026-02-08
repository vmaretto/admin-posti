import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const secretsRaw = fs.readFileSync('/Users/virgiliomaretto/clawd/.secrets/supabase', 'utf-8')
const secrets: Record<string, string> = {}
secretsRaw.split('\n').forEach(line => {
  const [key, ...rest] = line.split('=')
  if (key && rest.length) secrets[key.trim()] = rest.join('=').trim()
})

const supabase = createClient(secrets.SUPABASE_URL, secrets.SUPABASE_SERVICE_ROLE_KEY)

async function resetAll() {
  console.log('🔄 Reset completo associazioni...\n')
  
  // Reset fatture: transazione_id = null
  const { error: e1 } = await supabase
    .from('fatture')
    .update({ transazione_id: null })
    .not('id', 'is', null)
    
  if (e1) console.error('Errore fatture:', e1)
  else console.log('✅ Fatture: transazione_id = null')
  
  // Svuota tabella riconciliazioni
  const { error: e3 } = await supabase
    .from('riconciliazioni')
    .delete()
    .not('id', 'is', null)
    
  if (e3) console.log('Info riconciliazioni:', e3.message)
  else console.log('✅ Riconciliazioni svuotata')
  
  // Verifica
  const { data: linked } = await supabase
    .from('fatture')
    .select('id')
    .not('transazione_id', 'is', null)
    .range(0, 9999)
    
  const { count: fatture } = await supabase.from('fatture').select('*', { count: 'exact', head: true })
  const { count: trans } = await supabase.from('transazioni').select('*', { count: 'exact', head: true })
  
  console.log(`\n📊 Stato finale:`)
  console.log(`   Fatture totali: ${fatture}`)
  console.log(`   Fatture con link: ${linked?.length || 0}`)
  console.log(`   Transazioni: ${trans}`)
}

resetAll()
