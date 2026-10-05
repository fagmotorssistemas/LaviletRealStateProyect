import { FinancingGuidanceSettings } from '@/components/inmobiliaria/automation/FinancingGuidanceSettings'
import { loadFinancingGuidance } from './actions'

export default async function FinancingGuidancePage() {
  return <FinancingGuidanceSettings initial={await loadFinancingGuidance()} />
}
