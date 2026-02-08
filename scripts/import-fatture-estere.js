const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  'https://pwhqkdivgumrsubpinrv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc'
);

const BASE_PATH = '/Users/virgiliomaretto/Library/Mobile Documents/com~apple~CloudDocs/Mac-mini/Amministrazione/FattureStraniere2025';

// Extract text from PDF
function pdfToText(filePath) {
  try {
    return execSync(`pdftotext "${filePath}" -`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 });
  } catch (e) {
    return '';
  }
}

// Parse amount with currency
function parseAmount(text) {
  // Common patterns: $123.45, €123,45, £75.00, USD 175.62, EUR 27.41
  const patterns = [
    /(?:TOTAL|Total|Amount|Subtotal|Due)[:\s]*[$€£]?\s*([\d,]+\.?\d*)\s*(USD|EUR|GBP)?/gi,
    /[$€£]\s*([\d,]+\.?\d*)/g,
    /(USD|EUR|GBP)\s*([\d,]+\.?\d*)/gi,
    /([\d,]+\.?\d*)\s*(USD|EUR|GBP)/gi,
  ];
  
  let amounts = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      let val = match[1] || match[2];
      let currency = match[2] || match[1];
      if (/^\d/.test(val)) {
        const num = parseFloat(val.replace(',', ''));
        if (num > 0 && num < 100000) {
          amounts.push({ amount: num, currency: currency || 'EUR' });
        }
      }
    }
  }
  
  // Return largest amount (usually the total)
  if (amounts.length > 0) {
    amounts.sort((a, b) => b.amount - a.amount);
    return amounts[0];
  }
  return null;
}

// Parse date
function parseDate(text) {
  // Patterns: November 19, 2025 | 19/11/2025 | 2025-11-19 | Nov 1, 2025
  const months = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04',
    'may': '05', 'june': '06', 'july': '07', 'august': '08',
    'september': '09', 'october': '10', 'november': '11', 'december': '12',
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'jun': '06',
    'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
  };
  
  // "November 19, 2025" or "Nov 1, 2025"
  const pattern1 = /(\w+)\s+(\d{1,2}),?\s+(\d{4})/i;
  let match = text.match(pattern1);
  if (match) {
    const month = months[match[1].toLowerCase()];
    if (month) {
      return `${match[3]}-${month}-${match[2].padStart(2, '0')}`;
    }
  }
  
  // "19/11/2025"
  const pattern2 = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
  match = text.match(pattern2);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  
  // "2025-11-19"
  const pattern3 = /(\d{4})-(\d{2})-(\d{2})/;
  match = text.match(pattern3);
  if (match) {
    return match[0];
  }
  
  return null;
}

// Parse invoice number
function parseInvoiceNumber(text, filename) {
  // Try to find invoice number in text
  const patterns = [
    /Invoice\s*(?:number|#|No\.?)?\s*[:\s]*([A-Z0-9\-_]+)/i,
    /VAT\s*Invoice\s*Number[:\s]*([A-Z0-9\-_]+)/i,
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1].length > 3) {
      return match[1];
    }
  }
  
  // Fallback to filename
  return path.basename(filename, '.pdf');
}

async function main() {
  console.log('🚀 Importing fatture estere...\n');
  
  const fatture = [];
  
  // Walk through all subdirectories
  const entries = fs.readdirSync(BASE_PATH, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(BASE_PATH, entry.name);
    
    let pdfFiles = [];
    if (entry.isDirectory()) {
      // Get PDFs in subdirectory
      const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.pdf'));
      pdfFiles = files.map(f => ({ path: path.join(fullPath, f), vendor: entry.name }));
    } else if (entry.name.endsWith('.pdf')) {
      // PDF in root
      pdfFiles = [{ path: fullPath, vendor: entry.name.replace('.pdf', '') }];
    }
    
    for (const { path: pdfPath, vendor } of pdfFiles) {
      console.log(`📄 Processing: ${vendor}/${path.basename(pdfPath)}`);
      
      const text = pdfToText(pdfPath);
      if (!text) {
        console.log('   ⚠️ Could not extract text');
        continue;
      }
      
      const amountInfo = parseAmount(text);
      const date = parseDate(text);
      const invoiceNum = parseInvoiceNumber(text, pdfPath);
      
      if (!amountInfo || !date) {
        console.log(`   ⚠️ Missing data: amount=${amountInfo?.amount}, date=${date}`);
        continue;
      }
      
      const fattura = {
        tipo: 'ricevuta',
        tipo_documento: 'fattura',
        numero: invoiceNum,
        data_emissione: date,
        denominazione_fornitore: vendor,
        imponibile: amountInfo.amount,
        imposta: 0, // Foreign invoices usually don't have Italian VAT
        stato_riconciliazione: 'da_riconciliare',
        fonte: 'estero',
        note: `Valuta: ${amountInfo.currency}`
      };
      
      console.log(`   ✓ ${invoiceNum} | ${date} | ${amountInfo.currency} ${amountInfo.amount}`);
      fatture.push(fattura);
    }
  }
  
  console.log(`\n📊 Found ${fatture.length} fatture estere`);
  
  // Insert
  if (fatture.length > 0) {
    let inserted = 0;
    for (let i = 0; i < fatture.length; i += 50) {
      const batch = fatture.slice(i, i + 50);
      const { error } = await supabase.from('fatture').insert(batch);
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
