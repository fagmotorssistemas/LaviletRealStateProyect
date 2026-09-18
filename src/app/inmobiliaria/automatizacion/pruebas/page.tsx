import { TestResponseSettings } from '@/components/inmobiliaria/automation/TestResponseSettings'
import { loadTestResponseAction } from './actions'
export default async function TestResponsePage(){return <TestResponseSettings initial={await loadTestResponseAction()}/>}
