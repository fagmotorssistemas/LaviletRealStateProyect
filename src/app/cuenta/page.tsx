import type { Metadata } from 'next'
import { VisitanteHome } from '@/components/marketing/VisitanteHome'
import { CuentaGate } from '@/components/marketing/CuentaGate'

export const metadata: Metadata = {
  title: 'Mi cuenta',
  description: 'Showroom virtual 360° y información Lavilet',
}

export default function CuentaPage() {
  return (
    <CuentaGate>
      <VisitanteHome />
    </CuentaGate>
  )
}
