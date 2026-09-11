// Keeps custom UI edits. Only replace an unchanged base or refresh our marked addendum.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),Module=require('node:module'),ts=require('typescript')
const root=process.cwd();require('@next/env').loadEnvConfig(root)
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.join(root,'src',id.slice(2));return original.call(this,id,parent,main)}
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,f)
const {COMMERCIAL_EXPERIENCE_RULES}=require('../src/lib/integrations/automation/commercial-experience.ts')
const {createClient}=require('@supabase/supabase-js')
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const marker='\n\nEXPERIENCIA COMERCIAL · 2026-09-11\n',normalize=s=>s.replace(/\r\n/g,'\n').trim()
async function main(){
 const names=['respuesta_comercial','revisor_respuesta']
 const {data,error}=await db.from('agent_prompts').select('*').eq('tenant_id','a1b2c3d4-0001-4000-8000-000000000001').eq('project_id','b1b2c3d4-0001-4000-8000-000000000001').eq('is_active',true).in('name',names)
 if(error||data?.length!==2)throw Error('No se encontraron ambos guiones activos')
 const apply=process.argv.includes('--apply')
 if(apply){const folder=path.join('tmp','experience-prompts-'+Date.now());fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'before.json'),JSON.stringify(data,null,2));console.log('Respaldo:',folder)}
 for(const row of data){
  const file='docs/prompts/'+row.name+'.md',current=fs.readFileSync(file,'utf8'),prior=cp.execFileSync('git',['show','HEAD:'+file],{encoding:'utf8'})
  const base=row.content.split(marker)[0]
  const content=(normalize(base)===normalize(prior)?normalize(current):normalize(base))+marker+COMMERCIAL_EXPERIENCE_RULES.trim()
  if(normalize(content)===normalize(row.content)){console.log(row.name,'sin cambios');continue}
  if(apply){const r=await db.from('agent_prompts').update({content,version:row.version+1,updated_at:new Date().toISOString(),updated_by:null}).eq('id',row.id).eq('version',row.version).eq('content',row.content).select('id');if(r.error||r.data?.length!==1)throw Error('Conflicto de edición: '+row.name)}
  console.log(JSON.stringify({name:row.name,from:row.version,to:row.version+1,applied:apply}))
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
