import { LAVILET_PROJECT_ID } from '@/lib/integrations/lavilet'
import { ProjectReadinessSettings } from '@/components/inmobiliaria/automation/ProjectReadinessSettings'
import { loadProjectReadiness } from './actions'
export default async function ProjectReadinessPage() {
  return <ProjectReadinessSettings projectId={LAVILET_PROJECT_ID} initial={await loadProjectReadiness(LAVILET_PROJECT_ID)}/>
}
