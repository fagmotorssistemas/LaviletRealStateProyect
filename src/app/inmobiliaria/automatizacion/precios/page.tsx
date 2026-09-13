import { assertAdmin } from '@/lib/auth/session'
import { UnitPricesView } from '@/components/inmobiliaria/automation/UnitPricesView'

export default async function UnitPricesPage() {
  await assertAdmin()
  return <UnitPricesView />
}
