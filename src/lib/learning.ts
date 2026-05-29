// Apprendimento da match_history: per ogni soggetto, stima quanti giorni
// passano in media tra emissione fattura e pagamento. Lo usiamo per
// stringere la finestra date nel matching, riducendo i falsi positivi
// (es. ENI che paghi sempre intorno al 25 del mese successivo non deve
// matchare bolette di tre mesi prima/dopo).

import { createServerClient } from '@/lib/supabase'

export interface LearnedDateWindow {
  minDays: number
  maxDays: number
  basedOn: number // numero di match storici usati
  mean: number
  std: number
}

// Per soggetto canonico restituisce la finestra date appresa, o null se
// non ci sono abbastanza dati (< 3 match storici).
export async function getLearnedDateWindow(
  supabase: ReturnType<typeof createServerClient>,
  soggettoCanonico: string,
): Promise<LearnedDateWindow | null> {
  if (!soggettoCanonico) return null

  const { data, error } = await supabase
    .from('match_history')
    .select('giorni_diff')
    .eq('soggetto_canonico', soggettoCanonico)
    .not('giorni_diff', 'is', null)
    .gte('giorni_diff', -60)
    .lte('giorni_diff', 240)
    .range(0, 199)

  if (error || !data || data.length < 3) return null

  const days = data
    .map(r => r.giorni_diff as number)
    .filter(d => typeof d === 'number' && !isNaN(d))
  if (days.length < 3) return null

  const mean = days.reduce((a, b) => a + b, 0) / days.length
  const variance = days.reduce((a, b) => a + (b - mean) ** 2, 0) / days.length
  const std = Math.sqrt(variance)

  // Finestra: media ± (2 std + 5 giorni di buffer). Clamp ai limiti ragionevoli.
  const buffer = 5
  const minDays = Math.max(-30, Math.floor(mean - 2 * std - buffer))
  const maxDays = Math.min(180, Math.ceil(mean + 2 * std + buffer))

  return { minDays, maxDays, basedOn: days.length, mean, std }
}

// Versione batch: data una lista di soggetti, restituisce una mappa
// soggetto -> LearnedDateWindow. Più efficiente per l'auto-match che
// scorre N transazioni.
export async function getLearnedDateWindowsBatch(
  supabase: ReturnType<typeof createServerClient>,
  soggetti: string[],
): Promise<Map<string, LearnedDateWindow>> {
  const result = new Map<string, LearnedDateWindow>()
  if (soggetti.length === 0) return result

  // Carico TUTTA la match_history dei soggetti in un colpo. Per il volume
  // tipico (qualche centinaio di righe) è veloce.
  const { data } = await supabase
    .from('match_history')
    .select('soggetto_canonico, giorni_diff')
    .in('soggetto_canonico', soggetti)
    .not('giorni_diff', 'is', null)
    .gte('giorni_diff', -60)
    .lte('giorni_diff', 240)
    .range(0, 9999)

  if (!data) return result

  const bySoggetto = new Map<string, number[]>()
  for (const r of data) {
    const s = r.soggetto_canonico as string
    if (!s) continue
    if (!bySoggetto.has(s)) bySoggetto.set(s, [])
    bySoggetto.get(s)!.push(r.giorni_diff as number)
  }

  for (const [soggetto, days] of bySoggetto.entries()) {
    if (days.length < 3) continue
    const mean = days.reduce((a, b) => a + b, 0) / days.length
    const variance = days.reduce((a, b) => a + (b - mean) ** 2, 0) / days.length
    const std = Math.sqrt(variance)
    const buffer = 5
    const minDays = Math.max(-30, Math.floor(mean - 2 * std - buffer))
    const maxDays = Math.min(180, Math.ceil(mean + 2 * std + buffer))
    result.set(soggetto, { minDays, maxDays, basedOn: days.length, mean, std })
  }

  return result
}
