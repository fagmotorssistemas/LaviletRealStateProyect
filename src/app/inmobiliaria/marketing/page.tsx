import { redirect } from 'next/navigation'

/** Entrada del módulo Marketing → bitácora CAPI (evita ruta huérfana sin page). */
export default function MarketingIndexPage() {
  redirect('/inmobiliaria/marketing/capi')
}
