const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  'https://pwhqkdivgumrsubpinrv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc'
);

const BASE_PATH = '/Users/virgiliomaretto/Library/Mobile Documents/com~apple~CloudDocs/Mac-mini/Amministrazione/Banca-pOsti-2025';

function pdfToText(filePath) {
  try {
    return execSync(`pdftotext -layout "${filePath}" -`, { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
  } catch (e) {
    return '';
  }
}

// Parse Sella Carte statement
function parseSellaCards(text, filename) {
  const transactions = [];
  const lines = text.split('\n');
  
  let currentCategory = '';
  let pendingDates = [];
  let pendingAmounts = [];
  let pendingDescs = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Track category
    if (line.includes('RIEPILOGO OPERAZIONI')) {
      // Process any pending transactions first
      for (let j = 0; j < Math.min(pendingDates.length, pendingAmounts.length); j++) {
        const data = pendingDates[j];
        const amount = pendingAmounts[j];
        const desc = pendingDescs[j] || currentCategory;
        
        if (amount > 0 && amount < 100000) {
          transactions.push({
            data: data,
            importo: amount,
            tipo: 'uscita',
            descrizione: `${currentCategory}: ${desc}`.substring(0, 200),
            controparte: desc.substring(0, 100),
            conto: 'banca_sella',
            riferimento: `SELLA-CARD-${data}-${amount.toFixed(2)}`,
            stato_riconciliazione: 'da_riconciliare'
          });
        }
      }
      pendingDates = [];
      pendingAmounts = [];
      pendingDescs = [];
      currentCategory = line.replace(/.*RIEPILOGO OPERAZIONI/, '').trim();
      continue;
    }
    
    // Skip headers and totals
    if (line.includes('DATA') && line.includes('IMPORTO')) continue;
    if (line.includes('TOTALE')) continue;
    
    // Find dates: DD/MM/YYYY
    const dateMatches = line.match(/(\d{2})\/(\d{2})\/(\d{4})/g);
    if (dateMatches) {
      for (const dateStr of dateMatches) {
        const parts = dateStr.split('/');
        pendingDates.push(`${parts[2]}-${parts[1]}-${parts[0]}`);
      }
    }
    
    // Find amounts: numbers with comma (Italian format)
    const amountMatches = line.match(/\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/g);
    if (amountMatches) {
      for (const amtStr of amountMatches) {
        const amt = parseFloat(amtStr.replace(/\./g, '').replace(',', '.'));
        if (amt > 0 && amt < 100000) {
          pendingAmounts.push(amt);
        }
      }
    }
    
    // Find descriptions (text after amounts or on separate lines)
    const descMatch = line.match(/\d{2},\d{2}\s+([A-Z][A-Z\s]+[A-Z])/);
    if (descMatch) {
      pendingDescs.push(descMatch[1].trim());
    } else {
      // Check for standalone description lines (all caps, likely business names)
      const cleanLine = line.trim();
      if (/^[A-Z][A-Z\s\/\-\.]+$/.test(cleanLine) && cleanLine.length > 3 && 
          !cleanLine.includes('RIEPILOGO') && !cleanLine.includes('TOTALE') &&
          !cleanLine.includes('DIVISA') && !cleanLine.includes('DATA')) {
        pendingDescs.push(cleanLine);
      }
    }
  }
  
  // Process remaining pending transactions
  for (let j = 0; j < Math.min(pendingDates.length, pendingAmounts.length); j++) {
    const data = pendingDates[j];
    const amount = pendingAmounts[j];
    const desc = pendingDescs[j] || currentCategory;
    
    if (amount > 0 && amount < 100000) {
      transactions.push({
        data: data,
        importo: amount,
        tipo: 'uscita',
        descrizione: `${currentCategory}: ${desc}`.substring(0, 200),
        controparte: desc.substring(0, 100),
        conto: 'banca_sella',
        riferimento: `SELLA-CARD-${data}-${amount.toFixed(2)}`,
        stato_riconciliazione: 'da_riconciliare'
      });
    }
  }
  
  return transactions;
}

async function main() {
  console.log('🚀 Importing Sella Carte...\n');
  
  const allTransactions = [];
  const files = fs.readdirSync(BASE_PATH);
  
  for (const file of files) {
    if (!file.includes('sellabox') && !file.includes('EC_CARTE')) continue;
    if (!file.endsWith('.pdf')) continue;
    
    const filePath = path.join(BASE_PATH, file);
    console.log(`📄 ${file}`);
    
    const text = pdfToText(filePath);
    const transactions = parseSellaCards(text, file);
    
    console.log(`   Found ${transactions.length} transactions`);
    allTransactions.push(...transactions);
  }
  
  // Remove duplicates
  const seen = new Set();
  const unique = allTransactions.filter(t => {
    const key = `${t.data}-${t.importo}-${t.controparte}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  console.log(`\n📊 Total unique: ${unique.length}`);
  
  if (unique.length > 0) {
    let inserted = 0;
    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50);
      const { error } = await supabase.from('transazioni').insert(batch);
      if (error) {
        console.log('❌ Error:', error.message);
      } else {
        inserted += batch.length;
      }
    }
    console.log(`✅ Inserted: ${inserted}`);
  }
  
  console.log('\n🎉 Done!');
}

main().catch(console.error);
