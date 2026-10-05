import { TestResponseSettings } from '@/components/inmobiliaria/automation/TestResponseSettings'
import { loadTestResponseAction } from './actions'
export default async function TestResponsePage(){
  const result = await loadTestResponseAction()
  return <TestResponseSettings initial={result.ok && result.state ? result.state : {contacts:[]}} initialError={result.ok?'':result.error}/>
}
