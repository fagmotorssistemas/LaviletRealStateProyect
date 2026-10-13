import test from 'node:test'
import assert from 'node:assert/strict'
import { kommoConnectionFailure, recordedKommoFailure, kommoFailureExplanation } from './kommo-failure'
import { ProviderError } from './kommo'
import { AutomationExecutionTrace } from './execution-trace'
import { sanitizeTraceSummary } from './trace-summary'

test('network errors preserve safe causes and distinguish timeout from a connection reset', () => {
 const reset=Object.assign(Error('private URL and customer data'),{cause:{code:'ECONNRESET',token:'secret'}})
 assert.deepEqual(kommoConnectionFailure(reset),{failure_kind:'network',response_received:false,network_code:'ECONNRESET'})
 assert.equal(kommoConnectionFailure(new DOMException('private URL','TimeoutError')).failure_kind,'timeout')
 assert.deepEqual(kommoConnectionFailure(Object.assign(Error('customer'),{cause:{code:'private request'}})),{failure_kind:'network',response_received:false})
})

test('a failed transport trace stores the operation and safe cause without arbitrary provider details', async () => {
 let stored: Record<string,unknown>[]=[]
 const trace=new AutomationExecutionTrace([{id:'11111111-1111-4111-8111-111111111111'}],{persist:async rows=>{stored=rows;return {}}})
 const step=trace.start('message_delivery','Envío a Kommo','action','fixture')
 const error=new ProviderError(0,true,'launch_bot',{failure_kind:'network',network_code:'ECONNRESET',response_received:false})
 Object.assign(error.diagnostic,{body:'private provider body',authorization:'Bearer secret'})
 trace.finish(step,'failed',{},error)
 await trace.flush()
 const details=(stored.find(item=>item.step_key==='message_delivery')!.output_summary as Record<string,unknown>).kommo_diagnostics as Record<string,unknown>
 assert.equal(details.provider_operation,'launch_bot');assert.equal(details.network_code,'ECONNRESET')
 assert.doesNotMatch(JSON.stringify(stored),/private provider body|Bearer secret/)
 assert.match(kommoFailureExplanation('KOMMO_UNAVAILABLE',details)!,/conexión se cerró inesperadamente/)
 assert.equal(recordedKommoFailure(Error('OPENAI_NETWORK_ERROR')),null)
})

test('lead fields keep original values and nulls while actual credentials remain excluded', () => {
 const output={full_name:'Carlos',national_id:null,ruc:null,job_title:null,email:'carlos@example.com',phone:'+593987110032',salary:2500}
 const capture=sanitizeTraceSummary({output_snapshot:{capture_version:2,data:output},secret:'never-display'})
 assert.deepEqual((capture.output_snapshot as Record<string,unknown>).data,output)
 assert.equal(capture.secret,'[credencial protegida]')
 assert.deepEqual(sanitizeTraceSummary(capture),capture)
})
