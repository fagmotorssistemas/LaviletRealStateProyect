const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/
export const WORKFLOW_PAGE_SIZE = 30
export type WorkflowCursor = { at: string; id: string }

export function readWorkflowCursor(value: string | null): WorkflowCursor | null {
  if (!value) return null
  if (value.length > 400 || !/^[\w-]+$/.test(value)) throw new Error('INVALID_CURSOR')
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (typeof parsed.at !== 'string' || !timestamp.test(parsed.at) || !Number.isFinite(Date.parse(parsed.at))
      || typeof parsed.id !== 'string' || !uuid.test(parsed.id)) throw new Error('INVALID_CURSOR')
    return { at: parsed.at, id: parsed.id }
  } catch { throw new Error('INVALID_CURSOR') }
}

export function writeWorkflowCursor(at: string, id: string) {
  return Buffer.from(JSON.stringify({ at, id })).toString('base64url')
}
