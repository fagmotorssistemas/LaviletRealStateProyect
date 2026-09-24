-- Run only AFTER the approved evidence migration. Read-only transport inspection.
-- No default person. Set IDs only after confirming the actual n8n restriction
-- and the internal classification of the chosen contact. NULLs return no rows.
with parameters as (select null::bigint as kommo_id,null::text as contact_id,null::timestamptz as test_start)
select e.id,e.external_message_id,e.chat_id,e.talk_id,e.kommo_lead_id,e.lead_id,
       e.direction,e.author_type,e.media_type,e.delivery_status,e.source,
       e.sent_at,e.observed_at,clock_timestamp() as queried_at,
       extract(epoch from(e.observed_at-e.sent_at)) as origin_to_observation_seconds,
       nullif(trim(e.content),'') is not null as has_text,
       nullif(trim(e.media_url),'') is not null as has_attachment
from public.kommo_message_evidence e cross join parameters p
where e.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
  and e.account_id=36919007 and e.contact_id=p.contact_id
  and (e.kommo_lead_id=p.kommo_id or e.kommo_lead_id is null)
  and e.observed_at>=p.test_start
order by e.sent_at,e.observed_at,e.id;

with parameters as (select null::bigint as kommo_id,null::text as contact_id)
select l.id,l.kommo_id,l.contact_id,l.bot_enabled,c.classification,c.reason,c.recorded_at
from parameters p cross join public.leads l left join lateral (
 select classification,reason,recorded_at from public.crm_contact_classifications
 where tenant_id=l.tenant_id and lead_id=l.id order by recorded_at desc,id desc limit 1
) c on true
where l.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
and l.kommo_id=p.kommo_id and l.contact_id=p.contact_id;
