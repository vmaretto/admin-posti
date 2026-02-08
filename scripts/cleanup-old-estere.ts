import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pwhqkdivgumrsubpinrv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get all estero fatture ordered by created_at
  const { data: estere, error } = await supabase
    .from('fatture')
    .select('id, numero, denominazione_fornitore, created_at')
    .eq('fonte', 'estero')
    .order('numero')
    .order('created_at', { ascending: false }); // newest first

  if (error || !estere) {
    console.error('Error:', error);
    return;
  }

  console.log(`Total estero fatture: ${estere.length}`);

  // Keep newest for each numero+fornitore, delete rest
  const seen = new Map<string, string>();
  const toDelete: string[] = [];

  for (const f of estere) {
    const key = `${f.numero}|${f.denominazione_fornitore}`;
    if (seen.has(key)) {
      toDelete.push(f.id);
    } else {
      seen.set(key, f.id);
    }
  }

  console.log(`Duplicates to delete: ${toDelete.length}`);

  if (toDelete.length > 0) {
    const { error: delErr, count } = await supabase
      .from('fatture')
      .delete({ count: 'exact' })
      .in('id', toDelete);
    
    if (delErr) {
      console.error('Delete error:', delErr);
    } else {
      console.log(`Deleted: ${count}`);
    }
  }

  // Final count
  const { count: finalCount } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true });

  console.log(`Total fatture: ${finalCount}`);
}

main().catch(console.error);
