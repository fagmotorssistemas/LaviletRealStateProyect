// Run only after deploying resolveToneReferences. Default mode is read-only.
// Changes prompt storage, not the effective instructions; sends no messages.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
require('@next/env').loadEnvConfig(process.cwd())
const { createClient } = require('@supabase/supabase-js')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {auth:{persistSession:false}})
const scope = {tenant_id:'a1b2c3d4-0001-4000-8000-000000000001',project_id:'b1b2c3d4-0001-4000-8000-000000000001'}
const changes = require('../operations/unificar_tono_prompts.json')
const hash = value => createHash('sha256').update(value).digest('hex')
async function main() {
  const {data,error} = await db.from('agent_prompts').select('*').match(scope).eq('is_active',true).in('name',changes.map(p=>p.name))
  if(error) throw Error(error.message)
  const pending=[]
  for(const change of changes) {
    const rows=data.filter(row=>row.name===change.name)
    if(rows.length!==1)throw Error('AMBIGUOUS_ACTIVE_PROMPT_'+change.name)
    const row=rows[0]
    if(row.content===change.content)continue
    if(hash(row.content)!==change.previous_sha256)throw Error('PROMPT_CHANGED_'+change.name)
    pending.push({row,change})
  }
  if(!process.argv.includes('--apply'))return console.log(JSON.stringify({mode:'read_only',pending:pending.map(p=>p.row.name)}))
  if(pending.length) {
    const backup=path.join('tmp','tone-prompts-backup-'+Date.now()+'.json')
    fs.writeFileSync(backup,JSON.stringify(pending.map(p=>p.row),null,2))
    console.log(JSON.stringify({backup}))
  }
  for(const {row,change} of pending) {
    const {data:saved,error:writeError}=await db.from('agent_prompts').update({content:change.content}).match(scope).eq('id',row.id).eq('content',row.content).eq('is_active',true).select('id,name,content')
    if(writeError||saved?.length!==1)throw Error('PROMPT_UPDATE_CONFLICT_'+row.name)
    console.log(JSON.stringify({updated:row.name,stored_content_verified:saved[0].content===change.content}))
  }
  console.log('No lead state changed; no messages sent.')
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
