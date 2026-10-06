import 'server-only'
import { createHash } from 'node:crypto'

/** Route identical instruction/schema prefixes together without lead data,
 * persistent response storage or changes to the configured model. */
export function aiPromptCacheKey(options: { model: string; instructions: string; schema?: unknown }) {
  const hash = createHash('sha256').update(JSON.stringify([options.model, options.instructions, options.schema])).digest('hex')
  return `lavilet:${hash.slice(0, 48)}`
}
