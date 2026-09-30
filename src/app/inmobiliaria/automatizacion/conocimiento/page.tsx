import { KnowledgeCenter } from '@/components/inmobiliaria/automation/KnowledgeCenter'
import { LAVILET_PROJECT_ID } from '@/lib/integrations/lavilet'
import { loadBusinessPolicies } from './actions'

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ seccion?: string; politica?: string }> }) {
  const params = await searchParams
  const initial = await loadBusinessPolicies(LAVILET_PROJECT_ID)
  return <KnowledgeCenter key={`${params.seccion || 'proyecto'}:${params.politica || ''}`} projectId={LAVILET_PROJECT_ID} initial={initial} section={params.seccion} policyId={params.politica} />
}
