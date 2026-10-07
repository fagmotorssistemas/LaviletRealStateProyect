export type ResponseReviewSettings = { enabled: boolean; observationOnly?: boolean; updatedAt: string | null }
export type ResponseReviewState = ResponseReviewSettings & { version: string }
export type ResponseReviewResult = { ok: true; state: ResponseReviewState } | { ok: false; error: string }

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Existing projects keep their reviews unless an administrator explicitly disables them. */
export function responseReviewSettings(policies: unknown): ResponseReviewSettings {
  const setting = record(record(policies).response_review)
  const observationOnly = setting.observation_only === true
  return { enabled: setting.enabled !== false, observationOnly,
    updatedAt: typeof setting.updated_at === 'string' ? setting.updated_at : null }
}

/** Only an enabled test contact may use the administrator's observation mode. */
export function scopeResponseReview(settings: ResponseReviewSettings, isTestContact: boolean): ResponseReviewSettings {
  const observationOnly = settings.observationOnly === true && isTestContact === true
  return { ...settings, enabled: observationOnly || settings.enabled, observationOnly }
}

export function changeResponseReview(policies: unknown, enabled: boolean, userId: string, at: string) {
  if (typeof enabled !== 'boolean') throw Error('Seleccione activar o desactivar la revisión de respuestas.')
  return { ...record(policies), response_review: { ...record(record(policies).response_review),
    enabled, ...(enabled ? {} : { observation_only: false }), updated_by: userId, updated_at: at } }
}

/** Observation evaluates replies for the demonstration without enforcing review findings. */
export function changeResponseReviewObservation(policies: unknown, observationOnly: boolean, userId: string, at: string) {
  if (typeof observationOnly !== 'boolean') throw Error('Seleccione activar o desactivar el modo demostración.')
  const previous = record(record(policies).response_review)
  return { ...record(policies), response_review: { ...previous,
    enabled: previous.enabled !== false, observation_only: observationOnly,
    updated_by: userId, updated_at: at } }
}

/** Continuity may remember an actually delivered question without certifying its business claims. */
export function responseSupportsContinuity(value: unknown) {
  const audit = record(value), control = record(audit.review_control), validation = record(audit.final_validation)
  const transport = record(audit.transport_validation)
  return audit.status === 'checked' || (audit.status === 'review_observed' && control.observationOnly === true
    && control.source === 'project_setting' && transport.passed === true) || (audit.status === 'review_disabled' && control.enabled === false
    && control.source === 'project_setting' && ['transport_only', 'mandatory_server_guards'].includes(String(validation.policy)) && validation.passed === true)
}
