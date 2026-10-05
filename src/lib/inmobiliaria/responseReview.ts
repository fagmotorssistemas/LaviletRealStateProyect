export type ResponseReviewSettings = { enabled: boolean; updatedAt: string | null }
export type ResponseReviewState = ResponseReviewSettings & { version: string }

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Existing projects keep their reviews unless an administrator explicitly disables them. */
export function responseReviewSettings(policies: unknown): ResponseReviewSettings {
  const setting = record(record(policies).response_review)
  return { enabled: setting.enabled !== false, updatedAt: typeof setting.updated_at === 'string' ? setting.updated_at : null }
}

export function changeResponseReview(policies: unknown, enabled: boolean, userId: string, at: string) {
  if (typeof enabled !== 'boolean') throw Error('Seleccione activar o desactivar la revisión de respuestas.')
  return { ...record(policies), response_review: { ...record(record(policies).response_review),
    enabled, updated_by: userId, updated_at: at } }
}

/** Continuity may remember an actually delivered question without certifying its business claims. */
export function responseSupportsContinuity(value: unknown) {
  const audit = record(value), control = record(audit.review_control), validation = record(audit.final_validation)
  return audit.status === 'checked' || (audit.status === 'review_disabled' && control.enabled === false
    && control.source === 'project_setting' && validation.policy === 'transport_only' && validation.passed === true)
}
