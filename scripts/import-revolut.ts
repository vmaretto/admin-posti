import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabaseUrl = 'https://pwhqkdivgumrsubpinrv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc';

const supabase = createClient(supabaseUrl, supabaseKey);

const filePath = '/Users/virgiliomaretto/Library/Mobile Documents/com~apple~CloudDocs/Mac-mini/Amministrazione/Banca-pOsti-2025/transaction-statement_01-Dec-2024_08-Feb-2026.csv';

interface Transaction {
  data: string;
  importo: number;
  tipo: 'entrata' | 'uscita';
  descrizione: string;
  controparte: string | null;
  conto: string;
  riferimento: string | null;
}

async function main() {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const transactions: Transaction[] = [];
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 17) continue;
    
    // Date completed (Europe/Rome) = col 3
    // ID = col 4
    // Description = col 7
    // Amount = col 16
    
    const data = cols[3]; // Already YYYY-MM-DD
    const id = cols[4];
    const descrizione = cols[7] || '';
    const importo = parseFloat(cols[16]) || 0;
    
    if (!data || data === 'Date completed (Europe/Rome)') continue;
    
    transactions.push({
      data,
      importo,
      tipo: importo >= 0 ? 'entrata' : 'uscita',
      descrizione,
      controparte: descrizione.split(' ')[0] || null,
      conto: 'revolut',
      riferimento: id
    });
  }
  
  console.log(`Parsed ${transactions.length} Revolut transactions`);
  
  const { error, count } = await supabase
    .from('transazioni')
    .insert(transactions);
  
  if (error) {
    console.error('Insert error:', error);
  } else {
    console.log(`✅ Inserted ${transactions.length} Revolut transactions`);
  }
  
  // Final count
  const { count: finalCount } = await supabase
    .from('transazioni')
    .select('*', { count: 'exact', head: true });
  
  console.log(`Total transactions in DB: ${finalCount}`);
}

main().catch(console.error);
