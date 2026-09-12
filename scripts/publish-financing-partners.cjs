// Explicitly authorized in the chat: publish Pichincha/JEP for all leads.
const fs=require('node:fs'),path=require('node:path')
require('@next/env').loadEnvConfig(process.cwd())
const {createClient}=require('@supabase/supabase-js')
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
async function main(){
 const {data:row,error}=await db.from('project_financing_partners').select('*').eq('id','dbe11b77-c27d-49c6-a062-7d5cc4ee4c42').eq('project_id','b1b2c3d4-0001-4000-8000-000000000001').single()
 if(error)throw Error('PARTNER_CONFIG_NOT_FOUND')
 const names=(row.financing_options||[]).map(o=>o.name).sort()
 if(JSON.stringify(names)!==JSON.stringify(['Banco Pichincha','Cooperativa JEP']))throw Error('PARTNER_CONFIG_CHANGED')
 if(!process.argv.includes('--apply'))return console.log({names,from:{test_only:row.test_only,agreement_status:row.agreement_status},to:{test_only:false,agreement_status:'activo',public_enabled:true}})
 const folder=path.join('tmp','financing-public-'+Date.now());fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'before.json'),JSON.stringify(row,null,2))
 const update=await db.from('project_financing_partners').update({test_only:false,agreement_status:'activo',public_enabled:true,updated_at:new Date().toISOString()}).eq('id',row.id).eq('updated_at',row.updated_at).select('id,test_only,agreement_status,public_enabled')
 if(update.error||update.data?.length!==1)throw Error('PARTNER_UPDATE_CONFLICT')
 console.log({backup:folder,result:update.data[0]})
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
