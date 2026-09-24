-- REVIEW ONLY. Do not execute before the owner's approval for production.
-- Prerequisite: 20260923174920_kommo_message_evidence.sql reviewed/applied.
-- One confirmed person; no name matching, no campaign exclusion or deletion.
begin;
do $$
declare target uuid;
begin
  select id into strict target from public.leads
  where tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
    and kommo_id=4453096 and contact_id='9431328';
  perform public.classify_crm_contact(
    'a1b2c3d4-0001-4000-8000-000000000001',target,'internal',
    'Pablo Andrés Márquez confirmado como interno por el responsable; solicitud de auditoría 2026-09-23.',
    'Responsable: confirmación explícita en solicitud de auditoría 2026-09-23');
end $$;
-- Preview leaves production unchanged. Replace only after explicit approval.
rollback;
