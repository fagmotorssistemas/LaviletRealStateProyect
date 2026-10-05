import 'server-only'
import { responseReviewSettings } from '@/lib/inmobiliaria/responseReview'
import { db, scope } from './data'

export async function loadResponseReviewPolicy() {
  const { data, error } = await db().from('projects').select('policies_json')
    .eq('id', scope.project_id).eq('tenant_id', scope.tenant_id)
    .abortSignal(AbortSignal.timeout(10_000)).single()
  if (error || !data) throw new Error('RESPONSE_REVIEW_SETTINGS_UNAVAILABLE')
  return responseReviewSettings(data.policies_json)
}
