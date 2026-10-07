import 'server-only'
import { responseReviewSettings, scopeResponseReview } from '@/lib/inmobiliaria/responseReview'
import { db, scope } from './data'

export async function loadResponseReviewPolicy(kommoId?: number) {
  const { data, error } = await db().from('projects').select('policies_json')
    .eq('id', scope.project_id).eq('tenant_id', scope.tenant_id)
    .abortSignal(AbortSignal.timeout(10_000)).single()
  if (error || !data) throw new Error('RESPONSE_REVIEW_SETTINGS_UNAVAILABLE')
  const settings = responseReviewSettings(data.policies_json)
  if (!settings.observationOnly || !Number.isSafeInteger(kommoId)) return scopeResponseReview(settings, false)
  const contacts = await db().from('lv_test_contacts_state').select('lead_id')
    .match(scope).eq('matches', 1).eq('kommo_id', kommoId)
    .abortSignal(AbortSignal.timeout(10_000))
  // Enrollment uncertainty never broadens demonstration to real customers.
  return scopeResponseReview(settings, !contacts.error && contacts.data?.length === 1 && Boolean(contacts.data[0].lead_id))
}
