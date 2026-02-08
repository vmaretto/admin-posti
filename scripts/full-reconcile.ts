import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pwhqkdivgumrsubpinrv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc';

const supabase = createClient(supabaseUrl, supabaseKey);

// Normalize name for comparison
function normalizeName(name: string | null): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(srl|spa|snc|sas|srls|sapa|ltd|inc|gmbh|sarl|emea|s r l|s p a)\b/g, '')
    .trim();
}

// Calculate similarity
function nameSimilarity(name1: string | null, name2: string | null): number {
  const n1 = normalizeName(name1);
  const n2 = normalizeName(name2);
  
  if (!n1 || !n2) return 0;
  if (n1 === n2) return 100;
  if (n1.includes(n2) || n2.includes(n1)) return 80;
  
  // Keyword match
  const kw1 = n1.split(' ').filter(w => w.length > 2);
  const kw2 = n2.split(' ').filter(w => w.length > 2);
  
  let matches = 0;
  for (const k1 of kw1) {
    for (const k2 of kw2) {
      if (k1 === k2 || (k1.length > 3 && k2.length > 3 && (k1.includes(k2) || k2.includes(k1)))) {
        matches++;
        break;
      }
    }
  }
  
  return Math.round((matches / Math.max(kw1.length, kw2.length)) * 60);
}

async function main() {
  console.log('🔄 Full reconciliation starting...\n');
  
  // Get all fatture
  const { data: fatture } = await supabase
    .from('fatture')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .range(0, 9999);
  
  // Get all transazioni  
  const { data: transazioni } = await supabase
    .from('transazioni')
    .select('*')
    .eq('stato_riconciliazione', 'da_riconciliare')
    .range(0, 9999);
  
  console.log(`📊 Fatture da riconciliare: ${fatture?.length || 0}`);
  console.log(`📊 Transazioni da riconciliare: ${transazioni?.length || 0}\n`);
  
  if (!fatture || !transazioni) {
    console.error('Error fetching data');
    return;
  }
  
  interface Match {
    fatturaId: string;
    transazioneId: string;
    score: number;
    fatturaDenom: string;
    transControparte: string;
    importo: number;
  }
  
  const matches: Match[] = [];
  const usedFatture = new Set<string>();
  const usedTrans = new Set<string>();
  
  // Find matches
  for (const fattura of fatture) {
    const expectedTipo = fattura.tipo === 'emessa' ? 'entrata' : 'uscita';
    const fatturaTotal = fattura.totale || ((fattura.imponibile || 0) + (fattura.imposta || 0));
    const fatturaDenom = fattura.tipo === 'emessa' ? fattura.denominazione_cliente : fattura.denominazione_fornitore;
    
    let bestMatch: Match | null = null;
    let bestScore = 0;
    
    for (const trans of transazioni) {
      if (usedTrans.has(trans.id)) continue;
      if (trans.tipo !== expectedTipo) continue;
      
      // Amount check (2% or €5 tolerance)
      const tolerance = Math.max(Math.abs(fatturaTotal) * 0.02, 5);
      const amountDiff = Math.abs(Math.abs(fatturaTotal) - Math.abs(trans.importo));
      if (amountDiff > tolerance) continue;
      
      // Date check (45 days)
      const fatturaDate = new Date(fattura.data_emissione);
      const transDate = new Date(trans.data);
      const daysDiff = Math.abs((transDate.getTime() - fatturaDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff > 45) continue;
      
      // Name similarity
      const nameScore = nameSimilarity(fatturaDenom, trans.controparte);
      
      // Calculate score
      const dateScore = Math.max(0, 100 - daysDiff * 2);
      const amountScore = Math.max(0, 100 - (amountDiff / Math.abs(fatturaTotal)) * 100);
      const totalScore = (nameScore * 0.4) + (dateScore * 0.35) + (amountScore * 0.25);
      
      if (totalScore > bestScore && totalScore >= 30) {
        bestScore = totalScore;
        bestMatch = {
          fatturaId: fattura.id,
          transazioneId: trans.id,
          score: Math.round(totalScore),
          fatturaDenom: fatturaDenom || '',
          transControparte: trans.controparte || '',
          importo: fatturaTotal
        };
      }
    }
    
    if (bestMatch && !usedFatture.has(bestMatch.fatturaId)) {
      matches.push(bestMatch);
      usedFatture.add(bestMatch.fatturaId);
      usedTrans.add(bestMatch.transazioneId);
    }
  }
  
  console.log(`✅ Found ${matches.length} matches\n`);
  
  // Apply matches
  let applied = 0;
  for (const match of matches) {
    await supabase
      .from('fatture')
      .update({ 
        transazione_id: match.transazioneId,
        stato_riconciliazione: 'riconciliata'
      })
      .eq('id', match.fatturaId);
    
    await supabase
      .from('transazioni')
      .update({ 
        fattura_id: match.fatturaId,
        stato_riconciliazione: 'riconciliata'
      })
      .eq('id', match.transazioneId);
    
    applied++;
    if (applied % 50 === 0) {
      console.log(`   Applied ${applied}/${matches.length}`);
    }
  }
  
  console.log(`\n🎉 Done! Applied ${applied} matches`);
  
  // Show some examples
  console.log('\n📝 Top matches:');
  matches.slice(0, 10).forEach(m => {
    console.log(`   ${m.score}% | €${m.importo} | ${m.fatturaDenom.slice(0, 30)} ↔ ${m.transControparte.slice(0, 30)}`);
  });
  
  // Final stats
  const { count: stillUnmatched } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true })
    .eq('stato_riconciliazione', 'da_riconciliare');
  
  console.log(`\n📊 Fatture ancora da riconciliare: ${stillUnmatched}`);
}

main().catch(console.error);
