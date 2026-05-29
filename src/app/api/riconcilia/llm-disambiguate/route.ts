import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { askLLM, llmAvailable, parseJSONFromLLMResponse } from '@/lib/llm'
import { normalizeName } from '@/lib/matching'

export const dynamic = 'force-dynamic'

// POST /api/riconcilia/llm-disambiguate
//
// Riceve dalla preview di /api/riconcilia/auto la lista di SUGGERIMENTI
// (coppie trans/fattura con score 50-79: candidati incerti) e chiede a
// Claude di decidere quali sono lo "stesso rapporto commerciale" — ossia
// la trans sta pagando quella fattura.
//
// Body:
//   {
//     suggestions: [
//       {
//         fattura_id: UUID,
//         transazione_id: UUID,
//         fatturaSoggetto: string,
//         fatturaNumero: string,
//         fatturaData: string,
//         fatturaTotale: number,
//         transData: string,
//         transImporto: number,
//         transControparte: string,
//         transDescrizione: string
//       }, ...
//     ],
//     apply: boolean   // se true applica i match high-confidence al DB
//   }
//
// Risposta:
//   {
//     llmAvailable: boolean,
//     decisions: [{ index, match, confidence, reason }],
//     applied: number
//   }

interface SuggestionInput {
  fattura_id: string
  transazione_id: string
  fatturaSoggetto: string
  fatturaNumero: string | null
  fatturaData: string
  fatturaTotale: number
  transData: string
  transImporto: number
  transControparte: string | null
  transDescrizione: string | null
}

interface LLMDecision {
  index: number
  match: boolean
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

const SYSTEM_PROMPT = `Sei un assistente per la riconciliazione contabile italiana. Devi decidere se una transazione bancaria sta pagando una fattura specifica.

Ti vengono passate coppie (trans, fattura) candidate. Per ciascuna decidi:
- match: true/false (la trans paga quella fattura?)
- confidence: high/medium/low

Criteri per la decisione:
1. Il SOGGETTO è la cosa più importante: stessa azienda anche se il nome scritto è diverso. Riconosci:
   - filiali/branch (Google Italy, Google Cloud EMEA Limited, Google Ireland → stesso gruppo Google)
   - nomi commerciali vs ragione sociale (Stripe vs Stripe Payments Europe Ltd, Eni Plenitude vs Eni Energia)
   - sigle e acronimi (AWS vs Amazon Web Services)
   - traduzioni / nomi parziali
2. L'IMPORTO può differire leggermente (commissioni bancarie, arrotondamenti).
3. La DATA: la trans può arrivare prima/dopo la fattura, è normale.
4. Il NUMERO FATTURA dentro la causale è un segnale fortissimo se presente.

Usa "high" solo quando sei convinto che è lo stesso fornitore/cliente. Usa "medium" per casi probabili ma non certi. Usa "low" o match=false per i casi dubbi.

Rispondi SOLO con un JSON array di decisioni, una per coppia, nell'ordine dato.
Formato esatto:
[
  {"index": 0, "match": true, "confidence": "high", "reason": "breve giustificazione"},
  {"index": 1, "match": false, "confidence": "low", "reason": "..."}
]
NON includere altro testo prima o dopo il JSON.`

export async function POST(request: NextRequest) {
  if (!llmAvailable()) {
    return NextResponse.json({
      llmAvailable: false,
      error: 'ANTHROPIC_API_KEY non impostata nelle env. Aggiungila su Vercel → Settings → Environment Variables.',
    }, { status: 503 })
  }

  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }

  const suggestions: SuggestionInput[] = Array.isArray(body?.suggestions) ? body.suggestions : []
  if (suggestions.length === 0) {
    return NextResponse.json({ llmAvailable: true, decisions: [], applied: 0 })
  }
  const apply = !!body?.apply

  // Costruisci il prompt con le coppie
  const items = suggestions.map((s, i) => {
    const transAmtSign = s.transImporto >= 0 ? '+' : '−'
    const transAmt = `${transAmtSign}${Math.abs(s.transImporto).toFixed(2)} EUR`
    const fatturaAmt = `${s.fatturaTotale.toFixed(2)} EUR`
    return `[${i}] TRANS  ${s.transData}  ${transAmt}  controparte="${s.transControparte || '—'}"  descrizione="${(s.transDescrizione || '').slice(0, 120)}"
    FATTURA  ${s.fatturaData}  ${fatturaAmt}  soggetto="${s.fatturaSoggetto}"  numero="${s.fatturaNumero || '—'}"`
  }).join('\n')

  const userPrompt = `Coppie da valutare (${suggestions.length}):

${items}

Decidi per ogni coppia se la trans sta pagando quella fattura. Rispondi col JSON nel formato specificato.`

  let llmText = ''
  try {
    llmText = await askLLM(userPrompt, { system: SYSTEM_PROMPT, maxTokens: 4096, temperature: 0 })
  } catch (e: unknown) {
    return NextResponse.json({
      llmAvailable: true,
      error: e instanceof Error ? e.message : 'Errore chiamata LLM',
    }, { status: 500 })
  }

  const parsed = parseJSONFromLLMResponse<LLMDecision[]>(llmText)
  if (!parsed || !Array.isArray(parsed)) {
    return NextResponse.json({
      llmAvailable: true,
      rawResponse: llmText,
      error: 'LLM ha restituito un formato non parsabile',
    }, { status: 500 })
  }

  // Normalizza l'output (potrebbe mancare qualche campo)
  const decisions: LLMDecision[] = parsed.map((d, i) => ({
    index: typeof d?.index === 'number' ? d.index : i,
    match: !!d?.match,
    confidence: (d?.confidence === 'high' || d?.confidence === 'medium' || d?.confidence === 'low')
      ? d.confidence : 'low',
    reason: typeof d?.reason === 'string' ? d.reason.slice(0, 1000) : '',
  }))

  // Se apply=true, applica al DB le decisioni high-confidence con match=true
  let applied = 0
  const appliedDetails: Array<{
    fatturaSoggetto: string
    fatturaNumero: string | null
    fatturaTotale: number
    transControparte: string | null
    transData: string
    transImporto: number
    reason: string
  }> = []
  if (apply) {
    const supabase = createServerClient()
    for (const d of decisions) {
      if (!d.match || d.confidence !== 'high') continue
      const s = suggestions[d.index]
      if (!s) continue
      try {
        // Update fattura
        await supabase
          .from('fatture')
          .update({
            transazione_id: s.transazione_id,
            stato_riconciliazione: 'riconciliata',
          })
          .eq('id', s.fattura_id)
        // Update trans
        await supabase
          .from('transazioni')
          .update({ stato_riconciliazione: 'riconciliata' })
          .eq('id', s.transazione_id)
        // Riconciliazioni table
        await supabase
          .from('riconciliazioni')
          .upsert(
            { fattura_id: s.fattura_id, transazione_id: s.transazione_id },
            { onConflict: 'fattura_id' },
          )
        // Alias persistente — il LLM ha confermato che i nomi sono lo stesso soggetto
        if (s.transControparte && s.fatturaSoggetto) {
          const variant = normalizeName(s.transControparte)
          if (variant && variant !== normalizeName(s.fatturaSoggetto)) {
            await supabase.from('soggetti_alias').upsert(
              { variant_normalizzata: variant, soggetto_canonico: s.fatturaSoggetto, source: 'llm' },
              { onConflict: 'variant_normalizzata,soggetto_canonico' },
            )
          }
        }
        // match_history
        const giorniDiff = Math.round(
          (new Date(s.transData).getTime() - new Date(s.fatturaData).getTime()) / (1000 * 60 * 60 * 24),
        )
        await supabase.from('match_history').insert({
          fattura_id: s.fattura_id,
          transazione_id: s.transazione_id,
          soggetto_canonico: s.fatturaSoggetto,
          giorni_diff: giorniDiff,
          importo_diff: Math.abs(s.fatturaTotale - Math.abs(s.transImporto)),
          source: 'llm',
        })
        applied++
        appliedDetails.push({
          fatturaSoggetto: s.fatturaSoggetto,
          fatturaNumero: s.fatturaNumero,
          fatturaTotale: s.fatturaTotale,
          transControparte: s.transControparte,
          transData: s.transData,
          transImporto: s.transImporto,
          reason: d.reason,
        })
      } catch (e) {
        console.error('Errore apply LLM match', e)
      }
    }
  }

  return NextResponse.json({
    llmAvailable: true,
    decisions,
    applied,
    appliedDetails,
    suggestions_count: suggestions.length,
  })
}
