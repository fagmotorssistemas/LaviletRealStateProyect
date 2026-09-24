import { NextResponse } from 'next/server'
import { secretMatches } from '@/lib/integrations/automation/config'
import { rpc } from '@/lib/integrations/automation/data'
import { limitedBody, normalizeKommoWebhook } from '@/lib/integrations/automation/webhook'

export const runtime='nodejs'
export const dynamic='force-dynamic'

/** Parallel observer: never calls inbox receivers, workers, Kommo or Meta.
 * Its subscription is separate from existing commercial webhooks.
 */
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'}
 const provided=request.headers.get('x-kommo-webhook-secret') || new URL(request.url).searchParams.get('key')
 if(!secretMatches(provided,process.env.KOMMO_WEBHOOK_SECRET))return NextResponse.json({error:'No autorizado'},{status:401,headers})
 let observations
 try{
  const raw=await limitedBody(request)
  observations=normalizeKommoWebhook(raw,request.headers.get('content-type') || '').evidence
 }catch{return NextResponse.json({error:'Evento inválido'},{status:400,headers})}
 try{
  const inserted=await rpc<number>('lv_record_message_evidence',{p_events:observations})
  // No message content, query string, credentials or attachment URLs in logs.
  console.info(JSON.stringify({event:'kommo_observer_stored',observed:observations.length,inserted,incoming:observations.filter(e=>e.direction==='incoming').length,outgoing:observations.filter(e=>e.direction==='outgoing').length}))
  return NextResponse.json({accepted:true,observed:observations.length,inserted,automation:false},{headers})
 }catch{
  console.error(JSON.stringify({event:'kommo_observer_storage_failed',observed:observations.length}))
  return NextResponse.json({error:'No se pudo guardar la observación'},{status:503,headers})
 }
}
