const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  'https://pwhqkdivgumrsubpinrv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc'
);

const BASE_PATH = '/Users/virgiliomaretto/Library/Mobile Documents/com~apple~CloudDocs/Mac-mini/Amministrazione';

// Parse Italian number format "000000010000,00" -> 10000.00
function parseItalianNumber(str) {
  if (!str) return 0;
  const clean = str.replace(/['"]/g, '').replace(/^0+/, '') || '0';
  return parseFloat(clean.replace(',', '.')) || 0;
}

// Parse Italian date "29/03/2025" -> "2025-03-29"
function parseItalianDate(str) {
  if (!str) return null;
  const clean = str.replace(/['"]/g, '');
  const parts = clean.split('/');
  if (parts.length !== 3) return null;
  return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
}

// Parse SDI CSV fatture
function parseSDICSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const header = lines[0].split(';').map(h => h.replace(/['"]/g, '').trim());
  
  const fatture = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(';');
    if (values.length < 10) continue;
    
    const row = {};
    header.forEach((h, idx) => row[h] = (values[idx] || '').replace(/['"]/g, '').trim());
    
    // Determine if emessa or ricevuta based on PIVA
    const pivaFornitore = row['Partita IVA fornitore'];
    const isPOSTI = pivaFornitore === '14791521009';
    
    const fattura = {
      tipo: isPOSTI ? 'emessa' : 'ricevuta',
      tipo_documento: row['Tipo documento']?.toLowerCase().includes('credito') ? 'nota_credito' : 'fattura',
      numero: row['Numero fattura / Documento'] || row['Numero fattura'],
      data_emissione: parseItalianDate(row['Data emissione']),
      data_ricezione: parseItalianDate(row['Data ricezione'] || row['Data consegna/Presa visione']),
      piva_fornitore: pivaFornitore !== 'Non presente' ? pivaFornitore : null,
      denominazione_fornitore: row['Denominazione fornitore'],
      piva_cliente: row['Partita IVA cliente'] !== 'Non presente' ? row['Partita IVA cliente'] : null,
      denominazione_cliente: row['Denominazione cliente'],
      imponibile: parseItalianNumber(row['Imponibile/Importo (totale in euro)']),
      imposta: parseItalianNumber(row['Imposta (totale in euro)']),
      stato_riconciliazione: 'da_riconciliare',
      fonte: 'sdi'
    };
    
    if (fattura.data_emissione && fattura.numero) {
      fatture.push(fattura);
    }
  }
  return fatture;
}

// Parse PayPal CSV
function parsePayPalCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  
  // Simple CSV parse (handles quoted fields)
  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  }
  
  const header = parseCSVLine(lines[0]);
  const transazioni = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length < 10) continue;
    
    const row = {};
    header.forEach((h, idx) => row[h] = values[idx] || '');
    
    // Skip pending and non-completed
    if (row['Stato'] !== 'Completata') continue;
    
    // Parse date "10/01/2025" -> "2025-01-10"
    const dateParts = row['Data']?.split('/');
    if (!dateParts || dateParts.length !== 3) continue;
    const data = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
    
    // Parse amount (can be negative)
    const lordo = parseFloat(row['Lordo']?.replace(',', '.')) || 0;
    if (lordo === 0) continue;
    
    const transazione = {
      data: data,
      importo: Math.abs(lordo),
      tipo: lordo < 0 ? 'uscita' : 'entrata',
      descrizione: row['Tipo'] || '',
      controparte: row['Nome'] || '',
      conto: 'paypal',
      riferimento: row['Codice transazione'] || '',
      stato_riconciliazione: 'da_riconciliare'
    };
    
    transazioni.push(transazione);
  }
  return transazioni;
}

async function main() {
  console.log('🚀 Starting import...\n');
  
  // Import fatture
  const fattureDir = path.join(BASE_PATH, 'Fatture');
  const csvFiles = fs.readdirSync(fattureDir).filter(f => f.endsWith('.csv'));
  
  let allFatture = [];
  for (const file of csvFiles) {
    const filePath = path.join(fattureDir, file);
    console.log(`📄 Parsing ${file}...`);
    const fatture = parseSDICSV(filePath);
    console.log(`   Found ${fatture.length} fatture`);
    allFatture = allFatture.concat(fatture);
  }
  
  // Remove duplicates by numero + data
  const seen = new Set();
  allFatture = allFatture.filter(f => {
    const key = `${f.numero}-${f.data_emissione}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  console.log(`\n📊 Total unique fatture: ${allFatture.length}`);
  console.log(`   Emesse: ${allFatture.filter(f => f.tipo === 'emessa').length}`);
  console.log(`   Ricevute: ${allFatture.filter(f => f.tipo === 'ricevuta').length}`);
  
  // Insert fatture (batch of 50)
  if (allFatture.length > 0) {
    let inserted = 0;
    for (let i = 0; i < allFatture.length; i += 50) {
      const batch = allFatture.slice(i, i + 50);
      const { error } = await supabase.from('fatture').insert(batch);
      if (error) {
        console.log('❌ Error inserting fatture batch:', error.message);
      } else {
        inserted += batch.length;
      }
    }
    console.log(`✅ Fatture inserted: ${inserted}`);
  }
  
  // Import PayPal
  const paypalPath = path.join(BASE_PATH, 'Banca-pOsti-2025', 'DownloadPayPal.CSV');
  console.log(`\n💳 Parsing PayPal...`);
  const transazioni = parsePayPalCSV(paypalPath);
  console.log(`   Found ${transazioni.length} transazioni completate`);
  console.log(`   Entrate: ${transazioni.filter(t => t.tipo === 'entrata').length}`);
  console.log(`   Uscite: ${transazioni.filter(t => t.tipo === 'uscita').length}`);
  
  // Insert transazioni (batch of 50)
  if (transazioni.length > 0) {
    let inserted = 0;
    for (let i = 0; i < transazioni.length; i += 50) {
      const batch = transazioni.slice(i, i + 50);
      const { error } = await supabase.from('transazioni').insert(batch);
      if (error) {
        console.log('❌ Error inserting transazioni batch:', error.message);
      } else {
        inserted += batch.length;
      }
    }
    console.log(`✅ Transazioni inserted: ${inserted}`);
  }
  
  console.log('\n🎉 Import complete!');
}

main().catch(console.error);
