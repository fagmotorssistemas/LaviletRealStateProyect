import { ConversationToneSettings } from '@/components/inmobiliaria/automation/ConversationToneSettings'
import { LAVILET_PROJECT_ID } from '@/lib/integrations/lavilet'
import { loadToneAction } from './actions'

export default async function ConversationStylePage() {
  const initial=await loadToneAction(LAVILET_PROJECT_ID)
  return <ConversationToneSettings projectId={LAVILET_PROJECT_ID} projectName={initial.projectName} initial={initial.state} />
}
