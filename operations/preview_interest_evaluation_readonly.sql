-- READ ONLY. This is a review inventory, not a scoring or recovery command.
select l.id as crm_id,l.kommo_id as commercial_file_id,l.contact_id,
 l.temperature as stored_temperature,l.temperature_score,l.temperature_updated_at,
 case when l.temperature_updated_at is null then 'not_evaluated' else 'recorded_calculation_requires_source_audit' end as review_state,
 (select count(*) from public.lead_score_events e where e.lead_id=l.id) as score_events,
 (select jsonb_agg(jsonb_build_object('event',e.event_type,'points',e.points,'reason',e.reason,
   'source_message_id',e.source_message_id,'recorded_at',e.created_at))
  from public.lead_score_events e where e.lead_id=l.id) as recorded_evidence,
 'VERIFY_ORIGINAL_KOMMO_IDENTITIES_AND_HISTORY_BEFORE_EVALUATING' as required_next_step
from public.leads l
where l.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
order by l.created_at,l.id;
