import { TestResponseSettings } from '@/components/inmobiliaria/automation/TestResponseSettings'
import { loadTestResponseAction } from './actions'
import { loadResponseReviewAction } from './review-actions'
import { ResponseReviewControl } from '@/components/inmobiliaria/automation/ResponseReviewControl'
export default async function TestResponsePage(){
  const [result, review] = await Promise.all([loadTestResponseAction(), loadResponseReviewAction()])
  return <TestResponseSettings initial={result.ok && result.state ? result.state : {contacts:[]}} initialError={result.ok?'':result.error}
    reviewControl={<ResponseReviewControl initial={review}/>}/>
}
