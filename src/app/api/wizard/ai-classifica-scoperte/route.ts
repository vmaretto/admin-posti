import { NextRequest, NextResponse } from 'next/server'
import { askLLM, llmAvailable, parseJSONFromLLMResponse } from '@/lib/llm'

export const dynamic = 'force-dynamic'

// POST /api/wizard/ai-classifica-scoperte
//
// Body: { trans: [{ id, data, importo, controparte, descrizione, conto }, ...] }
//
// Per ogni trans residua (scoperta dopo auto-match e regole), l'AI propone:
//   - categoria: stipendio | imposte | commissioni | bonifico_fornitore |
//     acquisto_carta | abbonamento_software | fornitore_estero | giroconto |
//     altro
//   - possibile_causa: testo breve (es. "Fattura probabilmente emessa in
//     altro mese; verifica marzo/maggio")
//   - azione_suggerita: cosa fare (es. "Cerca fattura MEDIAWORLD in marzo o
//     maggio 2026 nel cassetto fiscale")
//   - motivo_tralascia (opzionale): se l'AI è sicura che non serve fattura,
//     propone il motivo per la tabella Tralascia.

interface TransInput {
  id: string
  data: string
  importo: number
  controparte: string | null
  descrizione: string | null
  conto: string
}

const SYSTEM_PROMPT = `Sei un assistente per la riconciliazione contabile di una S.r.l. italiana.

Ti vengono passate transazioni bancarie SCOPERTE (senza fattura riconciliata).
Per ognuna devi proporre:
1) categoria: una di [stipendio, imposte_tasse, commissioni_bancarie, bonifico_fornitore_italiano, acquisto_carta, abbonamento_software, fornitore_estero, giroconto, movimento_personale, altro]
2) possibile_causa: in italiano, perché probabilmente NON è stata trovata una fattura. Esempi tipici:
   - Per fornitori italiani con bonifico/carta su importi rilevanti (>200€): "Fattura non ancora arrivata via SDI oppure caricata in mese diverso. Verifica mese precedente e successivo."
   - Per MEDIAWORLD, IKEA e simili: "Acquisto da catena retail: la fattura non è automatica via SDI, va richiesta esplicitamente al banco/punto vendita."
   - Per AWS, OpenAI, Google, Microsoft, Stripe: "Fornitore estero, fattura PDF da scaricare dal portale del servizio."
   - Per Agenzia Entrate, F24: "Imposte/tasse, non c'è fattura associata."
   - Per stipendi: "Erogazione stipendio, no fattura."
   - Per bar/ristoranti/taxi/parcheggio piccoli importi: "Spesa di rappresentanza o piccolo importo, fattura non richiesta o non ottenuta."
3) azione_suggerita: cosa fare concretamente, in italiano (es. "Vai sul cassetto fiscale e cerca fatture MEDIAWORLD marzo-aprile-maggio 2026")
4) motivo_tralascia: SOLO se sei sicuro che la trans non dovrà mai avere fattura, proponi una delle categorie standard: [Stipendi, Imposte e tasse, Commissioni bancarie, Spostamento tra conti, Movimento personale, Importo piccolo, Spesa sbagliata]. Altrimenti null.

USA la tua conoscenza dei fornitori (Anthropic, OpenAI, AWS, Google, Stripe, Vimeo, REGUS, Vercel, LIME, ATAC, Trenitalia, ALD AUTOMOTIVE, TIM, Wind Tre, ...) per riconoscere subito chi è il soggetto.

Rispondi SOLO con un JSON array, una entry per trans nell'ordine ricevuto:
[
  {"id": "...", "categoria": "...", "possibile_causa": "...", "azione_suggerita": "...", "motivo_tralascia": "Stipendi" | null},
  ...
]`

export async function POST(request: NextRequest) {
  if (!llmAvailable()) {
    return NextResponse.json({
      llmAvailable: false,
      error: 'ANTHROPIC_API_KEY non impostata. Aggiungila su Vercel.',
    }, { status: 503 })
  }

  let body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }
  const trans: TransInput[] = Array.isArray(body?.trans) ? body.trans : []
  if (trans.length === 0) {
    return NextResponse.json({ llmAvailable: true, classifications: [] })
  }

  // Limito a 30 per chiamata per evitare prompt troppo lunghi
  const slice = trans.slice(0, 30)

  const items = slice.map(t => {
    const segno = t.importo < 0 ? '−' : '+'
    return `- id: ${t.id}
  data: ${t.data}
  conto: ${t.conto}
  importo: ${segno}${Math.abs(t.importo).toFixed(2)} EUR
  controparte: "${t.controparte || '—'}"
  descrizione: "${(t.descrizione || '').slice(0, 200)}"`
  }).join('\n')

  const userPrompt = `${slice.length} transazioni da analizzare:

${items}

Restituisci il JSON array delle classificazioni.`

  let llmText = ''
  try {
    llmText = await askLLM(userPrompt, { system: SYSTEM_PROMPT, maxTokens: 8000, temperature: 0 })
  } catch (e: unknown) {
    return NextResponse.json({
      llmAvailable: true,
      error: e instanceof Error ? e.message : 'Errore LLM',
    }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = parseJSONFromLLMResponse<any[]>(llmText)
  if (!parsed || !Array.isArray(parsed)) {
    return NextResponse.json({
      llmAvailable: true,
      error: 'LLM ha restituito un formato non parsabile',
      rawResponse: llmText.slice(0, 500),
    }, { status: 500 })
  }

  return NextResponse.json({
    llmAvailable: true,
    classifications: parsed,
    analyzed: slice.length,
    total: trans.length,
  })
}
