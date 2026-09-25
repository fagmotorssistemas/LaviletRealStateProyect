import { normalized } from './sdr-rules'

export function bedroomOptions(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 30))].sort((a, b) => a - b) : []
}

/** Explicit disjunctions, not ranges, preferences inferred from history or unit numbers. */
export function bedroomOptionsFromText(current: string): number[] {
  const words: Record<string, number> = { uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 }
  const token = '(?:\\d{1,2}|uno|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)'
  const noun = '(?:dormitorios?|habitaciones?|cuartos?)'
  const m = normalized(current)
  if (/no (?:quiero|acepto|necesito)|menos de|mas de|entre|hasta/.test(m)) return []
  const match = m.match(new RegExp(`\\b(${token})\\s*(?:${noun}\\s*)?o\\s*(?:de\\s+)?(${token})(?:\\s*${noun}\\b|(?=[?.,!]|$))`))
  if (!match || !new RegExp(noun).test(m)) return []
  return bedroomOptions([words[match[1]] || Number(match[1]), words[match[2]] || Number(match[2])])
}
