import { EarlyPurchaseDiscountSettings } from '@/components/inmobiliaria/automation/EarlyPurchaseDiscountSettings'
import { loadEarlyPurchaseDiscountSettings } from './actions'
import { assertAdmin } from '@/lib/auth/session'

export default async function EarlyPurchaseDiscountPage() {
  await assertAdmin()
  return <EarlyPurchaseDiscountSettings initial={await loadEarlyPurchaseDiscountSettings()} />
}
