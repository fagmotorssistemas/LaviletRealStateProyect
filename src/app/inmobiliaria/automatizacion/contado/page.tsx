import { CashPaymentSettings } from '@/components/inmobiliaria/automation/CashPaymentSettings'
import { loadCashPaymentRules } from './actions'
export default async function CashPaymentPage() {
  return <CashPaymentSettings initial={await loadCashPaymentRules()} />
}
