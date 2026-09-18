import { MetaCapiBitacoraView } from '@/components/inmobiliaria/marketing/MetaCapiBitacoraView'

export const metadata = {
  title: 'CAPI Meta · Marketing',
}

/** Bitácora principal: outbox Meta con alcance tenant (origin/main). */
export default function MarketingCapiPage() {
  return <MetaCapiBitacoraView />
}
