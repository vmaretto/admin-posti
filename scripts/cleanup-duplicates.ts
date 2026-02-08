import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pwhqkdivgumrsubpinrv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // 1. Delete test fatture
  console.log('1. Deleting test fatture...');
  const { error: testErr, count: testCount } = await supabase
    .from('fatture')
    .delete({ count: 'exact' })
    .eq('fonte', 'test');
  console.log(`   Deleted ${testCount} test fatture`);

  // 2. Get all estero fatture
  console.log('\n2. Finding duplicate estero fatture...');
  const { data: estere, error } = await supabase
    .from('fatture')
    .select('id, numero, denominazione_fornitore, created_at')
    .eq('fonte', 'estero')
    .order('numero')
    .order('created_at');

  if (error || !estere) {
    console.error('Error fetching:', error);
    return;
  }

  // Find duplicates (keep first, delete rest)
  const seen = new Map<string, string>(); // key -> first id
  const toDelete: string[] = [];

  for (const f of estere) {
    const key = `${f.numero}|${f.denominazione_fornitore}`;
    if (seen.has(key)) {
      toDelete.push(f.id);
    } else {
      seen.set(key, f.id);
    }
  }

  console.log(`   Found ${toDelete.length} duplicates to delete`);

  // 3. Delete duplicates
  if (toDelete.length > 0) {
    console.log('\n3. Deleting duplicates...');
    const { error: delErr, count } = await supabase
      .from('fatture')
      .delete({ count: 'exact' })
      .in('id', toDelete);
    
    if (delErr) {
      console.error('Delete error:', delErr);
    } else {
      console.log(`   Deleted ${count} duplicate fatture`);
    }
  }

  // 4. Final count
  const { count: finalCount } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true });

  console.log(`\n✅ Done! Total fatture: ${finalCount}`);
}

main().catch(console.error);
