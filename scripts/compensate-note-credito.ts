import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pwhqkdivgumrsubpinrv.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aHFrZGl2Z3VtcnN1YnBpbnJ2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NDU2NDM2NCwiZXhwIjoyMDgwMTQwMzY0fQ.4SgGvD4-UfdjHrJWHU1ha41A2NrwJE1hxIYlMiJhTdc';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('🔄 Compensazione Note di Credito...\n');

  // Get all note di credito da riconciliare
  const { data: noteCredito } = await supabase
    .from('fatture')
    .select('*')
    .eq('tipo_documento', 'nota_credito')
    .eq('stato_riconciliazione', 'da_riconciliare');

  console.log(`📋 Note di credito da compensare: ${noteCredito?.length || 0}\n`);

  if (!noteCredito || noteCredito.length === 0) {
    console.log('✅ Nessuna nota di credito da compensare');
    return;
  }

  // Get all fatture da riconciliare (per matching)
  const { data: fatture } = await supabase
    .from('fatture')
    .select('*')
    .eq('tipo_documento', 'fattura')
    .in('stato_riconciliazione', ['da_riconciliare', 'riconciliata'])
    .range(0, 9999);

  let compensate = 0;

  for (const nc of noteCredito) {
    // Determina il soggetto (fornitore o cliente)
    const ncSoggetto = nc.tipo === 'emessa' 
      ? nc.denominazione_cliente 
      : nc.denominazione_fornitore;
    
    const ncImporto = Math.abs(nc.totale);

    console.log(`🔍 NC: ${nc.numero} | €${ncImporto} | ${ncSoggetto}`);

    // Cerca fattura corrispondente
    // Stesso soggetto, stesso importo (con tolleranza 1%), stessa direzione (emessa/ricevuta)
    const tolerance = ncImporto * 0.01;
    
    const matchingFattura = fatture?.find(f => {
      const fSoggetto = f.tipo === 'emessa' 
        ? f.denominazione_cliente 
        : f.denominazione_fornitore;
      
      const fImporto = Math.abs(f.totale);
      
      // Stesso tipo (entrambe emesse o entrambe ricevute)
      if (f.tipo !== nc.tipo) return false;
      
      // Stesso soggetto
      if (fSoggetto?.toLowerCase() !== ncSoggetto?.toLowerCase()) return false;
      
      // Stesso importo (con tolleranza)
      if (Math.abs(fImporto - ncImporto) > tolerance) return false;
      
      // Non già compensata
      if (f.stato_riconciliazione === 'compensata') return false;
      
      return true;
    });

    if (matchingFattura) {
      console.log(`   ✅ Match: ${matchingFattura.numero} | €${matchingFattura.totale}`);
      
      // Marca entrambe come compensate
      await supabase
        .from('fatture')
        .update({ 
          stato_riconciliazione: 'compensata',
          note: `Compensata con fattura ${matchingFattura.numero}`
        })
        .eq('id', nc.id);

      await supabase
        .from('fatture')
        .update({ 
          stato_riconciliazione: 'compensata',
          note: `Compensata con nota credito ${nc.numero}`
        })
        .eq('id', matchingFattura.id);

      // Rimuovi dalla lista per evitare doppi match
      const idx = fatture?.indexOf(matchingFattura);
      if (idx !== undefined && idx > -1) fatture?.splice(idx, 1);

      compensate++;
    } else {
      console.log(`   ⚠️ Nessun match trovato`);
    }
  }

  console.log(`\n🎉 Compensate: ${compensate} coppie (NC + Fattura)`);

  // Stats finali
  const { count: stillNc } = await supabase
    .from('fatture')
    .select('*', { count: 'exact', head: true })
    .eq('tipo_documento', 'nota_credito')
    .eq('stato_riconciliazione', 'da_riconciliare');

  console.log(`📊 Note di credito ancora da gestire: ${stillNc}`);
}

main().catch(console.error);
