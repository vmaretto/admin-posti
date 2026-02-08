import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabaseUrl = 'https://pwhqkdivgumrsubpinrv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc';

const supabase = createClient(supabaseUrl, supabaseKey);

const basePath = '/Users/virgiliomaretto/Library/Mobile Documents/com~apple~CloudDocs/Mac-mini/Amministrazione/Banca-pOsti-2025';

interface Transaction {
  data: string;
  importo: number;
  tipo: 'entrata' | 'uscita';
  descrizione: string;
  controparte: string | null;
  conto: string;
  riferimento: string | null;
}

function parseDate(dateStr: string): string {
  // Handle DD/MM/YYYY or DD-MM-YYYY
  const parts = dateStr.split(/[\/\-]/);
  if (parts.length === 3) {
    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return dateStr;
}

function parseAmount(amountStr: string): number {
  // Handle Italian format: -1.300,00 or 132,00
  const cleaned = amountStr.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  return parseFloat(cleaned) || 0;
}

function parseQontoCsv(filePath: string): Transaction[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const transactions: Transaction[] = [];
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(';');
    if (cols.length < 30) continue;
    
    // Data operazione (locale) = col 4
    // Importo totale = col 5
    // Controparte = col 26
    // ID transazione = col 34
    // Causale = col 35
    
    const dataStr = cols[4]?.split(' ')[0]; // "07-02-2026 14:16:33" -> "07-02-2026"
    if (!dataStr) continue;
    
    const data = parseDate(dataStr);
    const importo = parseAmount(cols[5] || '0');
    const controparte = cols[26]?.trim() || null;
    const idTx = cols[34]?.trim() || null;
    const causale = cols[35]?.trim() || '';
    
    transactions.push({
      data,
      importo,
      tipo: importo >= 0 ? 'entrata' : 'uscita',
      descrizione: causale || controparte || 'Qonto',
      controparte,
      conto: 'qonto',
      riferimento: idTx
    });
  }
  
  return transactions;
}

function parseSellaCsv(filePath: string, tipo: 'carta' | 'conto'): Transaction[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const transactions: Transaction[] = [];
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    // Parse CSV with quoted fields
    const line = lines[i];
    const cols: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        cols.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cols.push(current.trim());
    
    if (tipo === 'carta') {
      // "Data Operazione","Data contabile","Riferimento","Importo in Euro","Descrizione",...
      const dataStr = cols[0];
      const riferimento = cols[2];
      const importoStr = cols[3];
      const descrizione = cols[4] || '';
      
      if (!dataStr || dataStr === 'Data Operazione') continue;
      
      const data = parseDate(dataStr);
      const importo = parseAmount(importoStr || '0');
      
      transactions.push({
        data,
        importo,
        tipo: importo >= 0 ? 'entrata' : 'uscita',
        descrizione,
        controparte: descrizione.split(' ')[0] || null,
        conto: 'sella_carta',
        riferimento: riferimento !== 'N.D.' ? riferimento : null
      });
    } else {
      // "Codice identificativo","Data operazione","Data valuta","Descrizione","Divisa","Importo",...
      const riferimento = cols[0];
      const dataStr = cols[1];
      const descrizione = cols[3] || '';
      const importoStr = cols[5];
      
      if (!dataStr || dataStr === 'Data operazione') continue;
      
      const data = parseDate(dataStr);
      const importo = parseAmount(importoStr || '0');
      
      transactions.push({
        data,
        importo,
        tipo: importo >= 0 ? 'entrata' : 'uscita',
        descrizione,
        controparte: descrizione.split(' ').slice(-2).join(' ') || null,
        conto: 'sella_conto',
        riferimento
      });
    }
  }
  
  return transactions;
}

async function main() {
  console.log('1. Deleting non-PayPal transactions...');
  
  const { error: deleteError, count } = await supabase
    .from('transazioni')
    .delete({ count: 'exact' })
    .neq('conto', 'paypal');
  
  if (deleteError) {
    console.error('Delete error:', deleteError);
    return;
  }
  console.log(`   Deleted ${count} transactions`);
  
  // Parse all CSV files
  console.log('\n2. Parsing CSV files...');
  
  const qontoPath = path.join(basePath, '2026-02-08_17-56-08_posti_s_r_l_0.csv');
  const cartaPath = path.join(basePath, 'ListaMovimentiCarta.csv');
  const contoPath = path.join(basePath, 'ListaMovimentiConto.csv');
  
  const qontoTx = parseQontoCsv(qontoPath);
  console.log(`   Qonto: ${qontoTx.length} transactions`);
  
  const cartaTx = parseSellaCsv(cartaPath, 'carta');
  console.log(`   Sella Carta: ${cartaTx.length} transactions`);
  
  const contoTx = parseSellaCsv(contoPath, 'conto');
  console.log(`   Sella Conto: ${contoTx.length} transactions`);
  
  const allTx = [...qontoTx, ...cartaTx, ...contoTx];
  console.log(`   Total: ${allTx.length} transactions`);
  
  // Insert in batches
  console.log('\n3. Inserting transactions...');
  
  const batchSize = 100;
  let inserted = 0;
  
  for (let i = 0; i < allTx.length; i += batchSize) {
    const batch = allTx.slice(i, i + batchSize);
    const { error: insertError } = await supabase
      .from('transazioni')
      .insert(batch);
    
    if (insertError) {
      console.error(`Insert error at batch ${i}:`, insertError);
    } else {
      inserted += batch.length;
      console.log(`   Inserted ${inserted}/${allTx.length}`);
    }
  }
  
  // Final count
  const { count: finalCount } = await supabase
    .from('transazioni')
    .select('*', { count: 'exact', head: true });
  
  console.log(`\n✅ Done! Total transactions in DB: ${finalCount}`);
}

main().catch(console.error);
