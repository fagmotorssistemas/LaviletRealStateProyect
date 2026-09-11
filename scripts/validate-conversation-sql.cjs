// Isolated PostgreSQL validation; external assignment/auth helpers are test doubles.
const fs=require('node:fs'), assert=require('node:assert/strict')
const { PGlite }=require('../tmp/sql-validation/node_modules/@electric-sql/pglite')
const db=new PGlite()
const project='b1b2c3d4-0001-4000-8000-000000000001',tenant='a1b2c3d4-0001-4000-8000-000000000001'
const read=p=>fs.readFileSync('supabase/migrations/'+p,'utf8')
async function main(){
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`)
 const schema=JSON.parse(fs.readFileSync('scripts/fixtures/integration-schema.json','utf8'))
 for(const [table,columns] of Object.entries(schema)){
  await db.exec(`CREATE TABLE public.${table} (${Object.entries(columns).map(([c,t])=>`"${c}" ${t.startsWith('public.')?'text':t}${c==='id'?' PRIMARY KEY DEFAULT gen_random_uuid()': ''}`).join(',')})`)
 }
 await db.exec(`CREATE TABLE public.project_automation_config(project_id uuid,tenant_id uuid,timezone text,business_hours jsonb,review_sla_minutes int);
 CREATE TABLE public.appointment_time_holds(request_id uuid);
 CREATE TABLE public.lv_appointment_assignment_events(tenant_id uuid,project_id uuid,appointment_id uuid,request_id uuid,from_advisor_id uuid,to_advisor_id uuid,action text,reason text);
 CREATE FUNCTION public.lv_assign_appointment_fairly(uuid,uuid[]) RETURNS void LANGUAGE sql AS $$ SELECT $$;
 CREATE FUNCTION public.lv_cancel_pending_visit_outbox(uuid,text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
 CREATE TABLE public.appointment_change_log(id uuid primary key default gen_random_uuid(),appointment_id uuid,actor_id uuid,action text,detail jsonb,created_at timestamptz default clock_timestamp());
 CREATE FUNCTION public.lv_assert_can_act_on_request(r public.appointment_reschedule_requests) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF; END $$;
 CREATE FUNCTION public.lv_advisor_eligible_on_project(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
 CREATE FUNCTION public.lv_advisor_has_conflict(uuid,timestamptz,timestamptz,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
 CREATE FUNCTION public.lv_interval_within_business_hours(p_project uuid,s timestamptz,e timestamptz) RETURNS boolean LANGUAGE sql AS $$
 SELECT coalesce((s AT TIME ZONE timezone)::date=(e AT TIME ZONE timezone)::date AND
 (s AT TIME ZONE timezone)::time >= (business_hours->extract(isodow FROM s AT TIME ZONE timezone)::text->>'open')::time AND
 (e AT TIME ZONE timezone)::time <= (business_hours->extract(isodow FROM s AT TIME ZONE timezone)::text->>'close')::time,false) FROM public.project_automation_config WHERE project_id=p_project $$;
 CREATE FUNCTION public.agenda_can_manage_appointment(a public.appointments) RETURNS boolean LANGUAGE sql AS $$ SELECT a.responsible_id=auth.uid() $$;
 CREATE FUNCTION public.mark_appointment_attendance(uuid,boolean,text,uuid[]) RETURNS public.appointments LANGUAGE sql AS $$ SELECT a FROM public.appointments a WHERE false $$;
 CREATE FUNCTION public.lv_intake_visit_once(l uuid,p uuid,pref text,s timestamptz,e timestamptz,mid text,body text) RETURNS uuid LANGUAGE plpgsql AS $$
 DECLARE a uuid; BEGIN INSERT INTO public.appointments(tenant_id,project_id,lead_id,status,updated_at) VALUES('${tenant}',p,l,'solicitada',now()) RETURNING id INTO a;
 INSERT INTO public.appointment_reschedule_requests(tenant_id,project_id,lead_id,appointment_id,source_message_id,source_message_text,preferred_time_text,proposed_by,status,created_at)
 VALUES('${tenant}',p,l,a,mid,body,pref,'client','awaiting_advisor',now()); RETURN a; END $$;`)
 const config={timezone:'America/Guayaquil',business_hours:Object.fromEntries([1,2,3,4,5].map(d=>[d,{open:'08:30',close:'18:30'}]).concat([[6,{open:'09:30',close:'13:30'}]]))}
 await db.query('INSERT INTO project_automation_config VALUES($1,$2,$3,$4,90)',[project,tenant,config.timezone,config.business_hours])
 let base=read('20260910163000_visit_preference_ambiguity.sql'); base=base.slice(0,base.indexOf('CREATE OR REPLACE FUNCTION public.lv_requested_visit_slot'))
 await db.exec(base)
 for(const name of ['20260910233000_visit_intake_collection.sql','20260910234000_attendance_edit_audit.sql']){await db.exec(read(name));console.log('MIGRATION COMPILED',name)}
 const user=(await db.query('INSERT INTO profiles(full_name) VALUES($1) RETURNING id',['Asesor prueba'])).rows[0].id
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user])
 const newLead=async()=>{
  const l=(await db.query('INSERT INTO leads(tenant_id,project_id) VALUES($1,$2) RETURNING id',[tenant,project])).rows[0].id
  const c=(await db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel) VALUES($1,$2,$3,'whatsapp') RETURNING id",[tenant,project,l])).rows[0].id
  return {l,c}
 }
 const turn=async ({l,c},message,help=false)=>{
  const m=(await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,clock_timestamp()) RETURNING id",[c,message])).rows[0].id
  const result=(await db.query('SELECT lv_collect_visit_intake($1,$2,$3) r',[l,m,help])).rows[0].r
  await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'bot','Respuesta de prueba',clock_timestamp())",[c])
  return result
 }
 const lead=await newLead()
 assert.equal((await turn(lead,'Quiero agendar una cita')).action,'collecting')
 assert.equal((await db.query('SELECT count(*)::int n FROM appointments')).rows[0].n,0)
 const day=(await db.query("SELECT d::date::text AS day FROM generate_series(current_date+1,current_date+7,interval '1 day') d WHERE extract(isodow FROM d) BETWEEN 1 AND 5 LIMIT 1")).rows[0].day
 let result=await turn(lead,'Para el '+day)
 assert.equal(result.action,'collecting'); assert.equal(result.slot.requested_date,day)
 result=await turn(lead,'a lass 14 horas')
 assert.equal(result.action,'submitted'); assert.equal(result.slot.requested_date,day);assert.equal(result.slot.confidence,'exact')
 assert.equal(new Date(result.slot.start_time).getUTCHours(),19)
 assert.equal(result.slot.source_messages.length,3)
 const uncertain=await newLead()
 await turn(uncertain,'Quiero una cita para el '+day)
 result=await turn(uncertain,'No estoy seguro, en la tarde',true)
 assert.equal(result.action,'submitted');assert.equal(result.slot.requested_date,day)
 let options=(await db.query('SELECT lv_visit_scheduling_options($1) r',[result.request_id])).rows[0].r
 assert.equal(options.requested.needs_help,true); assert.equal(options.slots.length,3)
 assert.ok(options.slots.every(s=>new Date(s.start_time).getUTCHours()>=17 && s.start_time.slice(0,10)>=day))
 const sunday=(await db.query("SELECT d::date::text AS day FROM generate_series(current_date+1,current_date+7,interval '1 day') d WHERE extract(isodow FROM d)=7 LIMIT 1")).rows[0].day
 const closed=await newLead()
 result=await turn(closed,'El '+sunday+' a las 14 horas'); assert.equal(result.action,'closed_day')
 assert.equal((await db.query('SELECT count(*)::int n FROM appointments WHERE lead_id=$1',[closed.l])).rows[0].n,0)
 result=await turn(closed,'El '+day+' a las 22 horas');assert.equal(result.action,'outside_hours')
 // A vague counterproposal also remains private collection until ready.
 const request=(await db.query('SELECT * FROM appointment_reschedule_requests WHERE lead_id=$1 LIMIT 1',[lead.l])).rows[0]
 const change=async(message)=>{
  const m=(await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,clock_timestamp()) RETURNING id",[lead.c,message])).rows[0].id
  const r=(await db.query('SELECT lv_collect_visit_intake($1,$2,false,$3,NULL) r',[lead.l,m,request.id])).rows[0].r
  await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'bot','Respuesta de prueba',clock_timestamp())",[lead.c])
  return r
 }
 result=await change('Mejor quiero cambiar la hora')
 assert.equal(result.action,'collecting')
 assert.equal((await db.query("SELECT count(*)::int n FROM appointment_reschedule_requests WHERE lead_id=$1 AND status='awaiting_advisor'",[lead.l])).rows[0].n,0)
 result=await change('a las 15 horas')
 assert.equal(result.action,'submitted');assert.equal(result.slot.requested_date,day);assert.equal(new Date(result.slot.start_time).getUTCHours(),20)
 const appt=(await db.query("INSERT INTO appointments(tenant_id,project_id,lead_id,responsible_id,status,updated_at) VALUES($1,$2,$3,$4,'aceptado',clock_timestamp()) RETURNING *",[tenant,project,lead.l,user])).rows[0]
 const record=async(attended,version,notes,reason)=> (await db.query('SELECT to_jsonb(lv_record_appointment_attendance($1,$2,$3,$4,$5,$6)) result',[appt.id,attended,version,notes,[],reason])).rows[0].result
 let attendance=await record(true,appt.updated_at,'Asistió',null)
 assert.equal(attendance.no_show,false)
 await assert.rejects(()=>record(false,attendance.updated_at,'Corregido',''),/motivo/)
 await assert.rejects(()=>record(false,appt.updated_at,'Corregido','Error al marcar'),/cambió/)
 attendance=await record(false,attendance.updated_at,'Corregido','Error al marcar')
 const logs=(await db.query('SELECT * FROM appointment_change_log WHERE appointment_id=$1 ORDER BY created_at',[appt.id])).rows
 assert.equal(logs.length,2); assert.equal(logs[1].detail.actor_name,'Asesor prueba');assert.equal(logs[1].detail.previous_no_show,false);assert.equal(logs[1].detail.no_show,true)
 await record(false,attendance.updated_at,'Corregido',null)
 assert.equal((await db.query('SELECT count(*)::int n FROM appointment_change_log WHERE appointment_id=$1',[appt.id])).rows[0].n,2)
 console.log('PASS: collection, cross-turn dates, help, afternoon recommendations, closed days, outside hours, audit, mandatory reason, stale edits, idempotency')
 await db.close()
}
main().catch(async e=>{console.error(e.message,e.where||'',e.query||'');await db.close();process.exitCode=1})
