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

// Parse Qonto statement
function parseQonto(text, filename) {
  const transactions = [];
  
  // Extract year and month from filename: 2025-01-posti...
  const fileMatch = filename.match(/(\d{4})-(\d{2})/);
  const year = fileMatch ? fileMatch[1] : '2025';
  const month = fileMatch ? fileMatch[2] : '01';
  
  const lines = text.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Pattern: DD/MM at start of line followed by description
    const dateMatch = line.match(/^(\d{2})\/(\d{2})\s+(.+)/);
    if (!dateMatch) continue;
    
    const day = dateMatch[1];
    const lineMonth = dateMatch[2];
    const description = dateMatch[3].trim();
    
    // Skip header rows
    if (description.includes('Data di valuta') || description.includes('Transazioni')) continue;
    
    // Look for amount in current line or next lines
    let amount = null;
    let amountLine = line;
    
    // Check current line for amount
    const amountMatch = line.match(/([+-])\s*([\d\s]+[.,]\d{2})\s*EUR/);
    if (amountMatch) {
      const sign = amountMatch[1];
      const value = parseFloat(amountMatch[2].replace(/\s/g, '').replace(',', '.'));
      amount = sign === '-' ? -value : value;
    } else {
      // Check next few lines for amount
      for (let j = 1; j <= 3 && i + j < lines.length; j++) {
        const nextLine = lines[i + j].trim();
        const nextMatch = nextLine.match(/^([+-])\s*([\d\s]+[.,]\d{2})\s*EUR/);
        if (nextMatch) {
          const sign = nextMatch[1];
          const value = parseFloat(nextMatch[2].replace(/\s/g, '').replace(',', '.'));
          amount = sign === '-' ? -value : value;
          break;
        }
      }
    }
    
    if (amount === null) continue;
    
    // Determine the year - if month in line < month in filename, it might be next year
    let txYear = year;
    if (parseInt(lineMonth) < parseInt(month) - 1) {
      txYear = String(parseInt(year) + 1);
    }
    
    const data = `${txYear}-${lineMonth}-${day}`;
    
    // Clean description - remove amount if present
    let cleanDesc = description.replace(/[+-]\s*[\d\s]+[.,]\d{2}\s*EUR.*$/, '').trim();
    
    transactions.push({
      data: data,
      importo: Math.abs(amount),
      tipo: amount < 0 ? 'uscita' : 'entrata',
      descrizione: cleanDesc.substring(0, 200),
      controparte: cleanDesc.split(/\s{2,}/)[0].substring(0, 100),
      conto: 'qonto',
      riferimento: `QONTO-${data}-${Math.abs(amount).toFixed(2)}`,
      stato_riconciliazione: 'da_riconciliare'
    });
  }
  
  return transactions;
}

// Parse Wise/Revolut statement (Italian months)
function parseWise(text, filename) {
  const transactions = [];
  const lines = text.split('\n');
  
  const monthsIT = {
    'gen': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'mag': '05', 'giu': '06',
    'lug': '07', 'ago': '08', 'set': '09', 'ott': '10', 'nov': '11', 'dic': '12'
  };
  
  for (const line of lines) {
    // Format: "25 nov 2025" with amounts as €XX.XX
    const dateMatch = line.match(/^\s*(\d{1,2})\s+(gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)\s+(\d{4})/i);
    if (!dateMatch) continue;
    
    const day = dateMatch[1].padStart(2, '0');
    const month = monthsIT[dateMatch[2].toLowerCase()];
    const year = dateMatch[3];
    const data = `${year}-${month}-${day}`;
    
    // Find amounts: €XX.XX patterns
    const amounts = line.match(/€([\d.,]+)/g);
    if (!amounts || amounts.length === 0) continue;
    
    // Get description (between date and amounts)
    const desc = line.replace(/^\s*\d{1,2}\s+\w+\s+\d{4}/, '').replace(/€[\d.,]+/g, '').trim();
    
    // Determine if in or out based on column position or description
    const isOut = line.indexOf(amounts[0]) < line.length / 2 + 50; // First amount column = out
    const amountStr = amounts[0].replace('€', '').replace(',', '.');
    const value = parseFloat(amountStr);
    
    if (value > 0) {
      transactions.push({
        data: data,
        importo: value,
        tipo: isOut ? 'uscita' : 'entrata',
        descrizione: desc.substring(0, 200),
        controparte: desc.split(/\s{2,}/)[0]?.substring(0, 100) || '',
        conto: 'wise',
        riferimento: `WISE-${data}-${value.toFixed(2)}`,
        stato_riconciliazione: 'da_riconciliare'
      });
    }
  }
  
  return transactions;
}

// Parse Banca Sella statement
function parseSella(text, filename, isCarte = false) {
  const transactions = [];
  const lines = text.split('\n');
  const conto = 'banca_sella';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // Sella format: "DD MM YY" at start of line (date contabile)
    // e.g., " 03 01 25      31 12 24     VALORI BOLLATI..."
    const dateMatch = line.match(/^\s*(\d{2})\s+(\d{2})\s+(\d{2})\s+/);
    if (!dateMatch) continue;
    
    const day = dateMatch[1];
    const month = dateMatch[2];
    let year = dateMatch[3];
    year = parseInt(year) > 50 ? '19' + year : '20' + year;
    const data = `${year}-${month}-${day}`;
    
    // Skip SALDO lines
    if (line.includes('SALDO INIZIALE') || line.includes('SALDO FINALE')) continue;
    
    // Find amounts - look for numbers with comma decimal at end of line
    // Format: description followed by amount(s)
    const amounts = line.match(/([\d.]+,\d{2})/g);
    if (!amounts || amounts.length === 0) continue;
    
    // Get description (middle part)
    const desc = line.replace(/^\s*\d{2}\s+\d{2}\s+\d{2}\s+\d{2}\s+\d{2}\s+\d{2}\s+/, '')
                     .replace(/([\d.]+,\d{2})/g, '').trim();
    
    // Last amount is the relevant one, first column is usually uscita
    const amountStr = amounts[0];
    const value = parseFloat(amountStr.replace(/\./g, '').replace(',', '.'));
    
    if (value > 0 && value < 1000000) {
      // Determine type: if only one amount and in first position = uscita
      const isUscita = amounts.length === 1 || line.indexOf(amountStr) < line.lastIndexOf(amountStr);
      
      transactions.push({
        data: data,
        importo: value,
        tipo: isUscita ? 'uscita' : 'entrata',
        descrizione: desc.substring(0, 200),
        controparte: desc.split(/\s{2,}/)[0]?.substring(0, 100) || '',
        conto: conto,
        riferimento: `SELLA-${data}-${value.toFixed(2)}`,
        stato_riconciliazione: 'da_riconciliare'
      });
    }
  }
  
  return transactions;
}

async function main() {
  console.log('🚀 Importing estratti conto...\n');
  
  const allTransactions = [];
  const files = fs.readdirSync(BASE_PATH);
  
  for (const file of files) {
    if (!file.endsWith('.pdf')) continue;
    
    const filePath = path.join(BASE_PATH, file);
    const text = pdfToText(filePath);
    
    let transactions = [];
    
    if (file.includes('posti-s-r-l') || file.includes('qonto')) {
      console.log(`📄 Qonto: ${file}`);
      transactions = parseQonto(text, file);
    } else if (file.includes('account-statement') || file.includes('wise')) {
      console.log(`📄 Wise: ${file}`);
      transactions = parseWise(text, file);
    } else if (file.includes('doc_conti') && file.includes('EC_EURO')) {
      console.log(`📄 Sella Conto: ${file}`);
      transactions = parseSella(text, file, false);
    } else if (file.includes('doc_sellabox') || file.includes('EC_CARTE')) {
      console.log(`📄 Sella Carte: ${file}`);
      transactions = parseSella(text, file, true);
    } else {
      continue;
    }
    
    console.log(`   Found ${transactions.length} transactions`);
    allTransactions.push(...transactions);
  }
  
  // Remove duplicates by reference
  const seen = new Set();
  const unique = allTransactions.filter(t => {
    const key = `${t.conto}-${t.data}-${t.importo}-${t.tipo}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  console.log(`\n📊 Total unique transactions: ${unique.length}`);
  console.log(`   Qonto: ${unique.filter(t => t.conto === 'qonto').length}`);
  console.log(`   Wise: ${unique.filter(t => t.conto === 'wise').length}`);
  console.log(`   Sella: ${unique.filter(t => t.conto === 'banca_sella').length}`);
  
  // Insert
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
