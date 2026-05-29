// Client minimale per Anthropic API (raw fetch — niente dipendenza npm).
// Configurazione via env Vercel:
//   ANTHROPIC_API_KEY (obbligatorio per llmAvailable() = true)
//   ANTHROPIC_MODEL   (opzionale, default 'claude-haiku-4-5-20251001')

const ANTHROPIC_MODEL_DEFAULT = 'claude-haiku-4-5-20251001'

export function llmAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

export interface LLMOptions {
  system?: string
  maxTokens?: number
  temperature?: number
}

export async function askLLM(userPrompt: string, opts?: LLMOptions): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non impostata')
  const model = process.env.ANTHROPIC_MODEL || ANTHROPIC_MODEL_DEFAULT

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: opts?.maxTokens ?? 4096,
      temperature: opts?.temperature ?? 0,
      system: opts?.system,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`LLM API ${res.status}: ${errText.slice(0, 500)}`)
  }
  const data = await res.json()
  // Estrae il primo blocco text dalla risposta
  const blocks = Array.isArray(data?.content) ? data.content : []
  const firstText = blocks.find((b: { type: string; text?: string }) => b.type === 'text')?.text || ''
  return String(firstText).trim()
}

// Helper: estrae il primo blocco JSON da una risposta LLM che potrebbe avere
// del testo prima/dopo. Restituisce null se non lo trova.
export function parseJSONFromLLMResponse<T>(text: string): T | null {
  // Cerca il primo carattere [ o {
  const startBracket = text.search(/[[{]/)
  if (startBracket < 0) return null
  const startChar = text[startBracket]
  const endChar = startChar === '[' ? ']' : '}'
  // Trova la fine bilanciata (semplice — non gestisce stringhe quote, ma per
  // l'output JSON che chiediamo a Claude basta)
  let depth = 0
  for (let i = startBracket; i < text.length; i++) {
    if (text[i] === startChar) depth++
    else if (text[i] === endChar) {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(startBracket, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}
