import 'server-only'
import { db, scope } from './data'
import { CURRENT_TONE } from './conversation-tone'
import { DEFAULT_TONE, toneDirection, type ToneSettings } from '@/lib/inmobiliaria/conversationTone'
import { readToneRow, toneState } from '@/services/conversationTone.service'

export async function configuredToneInstructions(instructions: string, override?: ToneSettings) {
  // Extraction and non-writing tasks must not receive conversational style rules.
  if (!Object.values(CURRENT_TONE).some(fragment => instructions.includes(fragment))) return instructions
  let settings=override
  if (!settings) {
    try { settings=toneState(await readToneRow(db(),{tenantId:scope.tenant_id,projectId:scope.project_id})).current }
    catch { settings=DEFAULT_TONE } // A style lookup failure must not silence a lead.
  }
  return instructions + toneDirection(settings)
}
