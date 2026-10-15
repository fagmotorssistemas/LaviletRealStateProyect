import { PoolAccessSettings } from '@/components/inmobiliaria/automation/PoolAccessSettings'
import { loadPoolAccess } from './actions'
export default async function PoolAccessPage() { return <PoolAccessSettings initial={await loadPoolAccess()} /> }
