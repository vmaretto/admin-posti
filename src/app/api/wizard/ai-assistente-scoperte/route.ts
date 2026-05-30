import { NextRequest, NextResponse } from 'next/server'
import { askLLM, llmAvailable } from '@/lib/llm'

export const dynamic = 'force-dynamic'

interface AssistantTrans {
  id: string
  data: string
  importo: number
  conto: string
  controparte: string | null
  descrizione: string | null
  noteOperative?: string | null
  ai?: {
    categoria?: string
    possibile_causa?: string
    azione_suggerita?: string
    motivo_tralascia?: string | null
  } | null
  isEstero?: boolean
}

const SYSTEM_PROMPT = `Sei un assistente operativo per la riconciliazione contabile di pOsti S.r.l.

L'utente ti farà domande puntuali sulle transazioni scoperte del wizard, dopo l'analisi AI.
Rispondi in italiano, in modo pratico e verificabile.

Regole:
- Non inventare fatture o riconciliazioni già avvenute.
- Se una trans sembra estera, suggerisci di metterla in coda Step 5 e caricare/scaricare la fattura estera, non di crearla automaticamente.
- Se una trans sembra da tralasciare, indica una motivazione compatibile con le categorie standard.
- Quando utile, cita importo, data, conto e controparte per rendere la risposta azionabile.
- Se i dati non bastano, dillo chiaramente e chiedi quale dettaglio serve.`

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

  const question = typeof body?.question === 'string' ? body.question.trim() : ''
  const periodo = typeof body?.periodo === 'string' ? body.periodo : ''
  const trans: AssistantTrans[] = Array.isArray(body?.trans) ? body.trans.slice(0, 80) : []

  if (!question) {
    return NextResponse.json({ error: 'Domanda richiesta' }, { status: 400 })
  }

  const context = trans.map(t => [
    `id: ${t.id}`,
    `data: ${t.data}`,
    `conto: ${t.conto}`,
    `importo: ${t.importo.toFixed(2)} EUR`,
    `controparte: ${t.controparte || '—'}`,
    `descrizione: ${t.descrizione || '—'}`,
    `estero_step5: ${t.isEstero ? 'si' : 'no'}`,
    t.ai ? `ai_categoria: ${t.ai.categoria || '—'}` : 'ai_categoria: —',
    t.ai?.possibile_causa ? `ai_causa: ${t.ai.possibile_causa}` : '',
    t.ai?.azione_suggerita ? `ai_azione: ${t.ai.azione_suggerita}` : '',
    t.noteOperative ? `note_operative: ${t.noteOperative}` : '',
  ].filter(Boolean).join('\n  ')).join('\n\n')

  const prompt = `Periodo: ${periodo || 'non indicato'}

Domanda utente:
${question}

Transazioni scoperte disponibili:
${context || 'Nessuna transazione nel contesto.'}

Rispondi con una raccomandazione operativa.`

  try {
    const answer = await askLLM(prompt, { system: SYSTEM_PROMPT, maxTokens: 3000, temperature: 0 })
    return NextResponse.json({ llmAvailable: true, answer })
  } catch (e: unknown) {
    return NextResponse.json({
      llmAvailable: true,
      error: e instanceof Error ? e.message : 'Errore LLM',
    }, { status: 500 })
  }
}
