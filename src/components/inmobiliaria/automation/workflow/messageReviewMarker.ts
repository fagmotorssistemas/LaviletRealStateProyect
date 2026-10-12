import type { WorkflowExecutionStep } from './executionWorkflow'
import { isObservedReview } from './reviewDecision'

type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : []
const text = (value: unknown) => typeof value === 'string' ? value : ''
const rejectedStatus = (value: unknown) => /^(rejected|invalid)_/.test(text(value))

export type MessageReviewMarker = {
  tone: 'rejected' | 'warning'
  kind: 'blocked' | 'repaired' | 'observed'
  label: string
  description: string
}

function discarded(output: Row) {
  return output.draft_rejected === true || rejectedStatus(output.status) || output.status === 'recovered_catalog_result'
}

/** Classify the recorded review, never an extractor or delivery failure. */
export function messageReviewMarker(steps: WorkflowExecutionStep[]): MessageReviewMarker | null {
  const coverage = steps.filter(step => step.key === 'response_coverage').sort((a, b) => a.order - b.order)
  const final = coverage.at(-1)?.output
  if (!final) return null

  if (isObservedReview(final)) {
    const observation = row(final.observation)
    const status = text(observation.status) || text(final.observed_status) || text(row(final.semantic_review).status)
    const rejected = rejectedStatus(status) || status === 'rejected' || row(final.final_validation).passed === false
    return rejected ? {
      tone: 'warning', kind: 'observed', label: 'Rechazo observado · demo',
      description: 'La revisión registró un resultado sin aprobar en modo demostración. Ese resultado no bloqueó el borrador; el envío se comprueba por separado.',
    } : null
  }

  if (discarded(final) || row(final.recovery).pending === true || row(row(final.turn_completeness).recovery).pending === true) {
    const metadata = final.status === 'invalid_coverage' || final.status === 'unavailable'
      || rows(row(final.semantic_review).validation_details).length > 0
        && rows(row(final.semantic_review).validation_details).every(issue => issue.kind === 'review_metadata')
    return {
      tone: 'rejected', kind: 'blocked', label: metadata ? 'Revisión sin aprobar' : 'Borrador rechazado',
      description: 'La revisión no aprobó el borrador final. Puede deberse al contenido o a su ficha interna; no confirma que el texto enviado fuera rechazado por Kommo.',
    }
  }

  if (final.status !== 'checked') return null
  const attempts = rows(final.repair_attempts)
  const failedAttempts = attempts.filter(attempt => rejectedStatus(attempt.status)
    || attempt.target === 'review_metadata' && (rows(attempt.issues).length > 0 || Array.isArray(attempt.issues) && attempt.issues.length > 0))
  const priorRejection = coverage.slice(0, -1).some(step => !isObservedReview(step.output) && discarded(step.output))
  if (!failedAttempts.length && !priorRejection) return null
  const draftChanged = priorRejection || failedAttempts.some(attempt => attempt.target === 'commercial_draft')
  return {
    tone: 'warning', kind: 'repaired', label: draftChanged ? 'Rechazo corregido' : 'Ficha reparada',
    description: draftChanged
      ? 'Un borrador anterior no superó la revisión y se corrigió. El borrador final quedó aprobado en este paso; el envío se comprueba por separado.'
      : 'La ficha interna necesitó reparación antes de aprobar el borrador. Esto no demuestra que el mensaje comercial tuviera un error.',
  }
}
