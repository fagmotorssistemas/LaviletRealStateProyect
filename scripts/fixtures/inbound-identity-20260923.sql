-- Read-only snapshot of deployed functions on 2026-09-23; test fixture only.
CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when nullif(regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'), '') is null then null
    when regexp_replace(p_phone, '[^0-9]', '', 'g') like '593%' then '+' || regexp_replace(p_phone, '[^0-9]', '', 'g')
    when regexp_replace(p_phone, '[^0-9]', '', 'g') like '0%' then '+593' || substr(regexp_replace(p_phone, '[^0-9]', '', 'g'), 2)
    else '+' || regexp_replace(p_phone, '[^0-9]', '', 'g')
  end;
$function$
;
CREATE OR REPLACE FUNCTION public.register_inbound_message(p_tenant_id uuid, p_project_id uuid, p_phone text, p_name text, p_source text, p_channel text, p_campaign text, p_contact_id text, p_kommo_id integer, p_external_message_id text, p_content text, p_tracking_consent boolean DEFAULT false)
 RETURNS TABLE(lead_id uuid, conversation_id uuid, message_id uuid, is_duplicate boolean, bot_enabled boolean, stage text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_phone text;
  v_lead public.leads;
  v_conv uuid;
  v_message uuid;
begin
  v_phone := public.normalize_phone(p_phone);

  if v_phone is null then
    raise exception 'Telefono obligatorio';
  end if;

  insert into public.leads(
    tenant_id,
    project_id,
    name,
    phone,
    phone_normalized,
    source,
    source_campaign,
    contact_id,
    kommo_id,
    channel_origin,
    last_interaction_at,
    tracking_consent,
    tracking_consent_at
  )
  values(
    p_tenant_id,
    p_project_id,
    coalesce(nullif(trim(p_name), ''), 'Sin nombre'),
    p_phone,
    v_phone,
    p_source,
    p_campaign,
    nullif(trim(p_contact_id), ''),
    p_kommo_id,
    p_channel,
    now(),
    p_tracking_consent,
    case
      when p_tracking_consent then now()
      else null
    end
  )
  on conflict (tenant_id, phone_normalized)
    where phone_normalized is not null
  do update set

    -- El perfil del canal no reemplaza un nombre ya guardado.
    -- El nombre declarado se actualiza por el flujo de datos.
    name = case
      when nullif(trim(leads.name), '') is null
        or lower(trim(leads.name)) = 'sin nombre'
      then excluded.name
      else leads.name
    end,

    project_id = coalesce(excluded.project_id, leads.project_id),
    source = coalesce(leads.source, excluded.source),
    source_campaign = coalesce(
      excluded.source_campaign,
      leads.source_campaign
    ),
    contact_id = coalesce(excluded.contact_id, leads.contact_id),
    kommo_id = coalesce(excluded.kommo_id, leads.kommo_id),
    channel_origin = coalesce(
      excluded.channel_origin,
      leads.channel_origin
    ),
    last_interaction_at = now(),
    updated_at = now(),
    tracking_consent =
      leads.tracking_consent or excluded.tracking_consent,
    tracking_consent_at = case
      when not leads.tracking_consent
           and excluded.tracking_consent
      then now()
      else leads.tracking_consent_at
    end
  returning * into v_lead;

  insert into public.conversations(
    tenant_id,
    project_id,
    lead_id,
    channel,
    external_thread_id,
    status,
    last_message_at
  )
  values(
    p_tenant_id,
    p_project_id,
    v_lead.id,
    p_channel,
    nullif(trim(p_contact_id), ''),
    'activa',
    now()
  )
  on conflict (tenant_id, channel, external_thread_id)
    where external_thread_id is not null
  do update set
    lead_id = excluded.lead_id,
    project_id = excluded.project_id,
    last_message_at = now(),
    status = 'activa'
  returning id into v_conv;

  insert into public.messages(
    conversation_id,
    role,
    content,
    external_message_id,
    sent_at
  )
  values(
    v_conv,
    'cliente',
    p_content,
    nullif(trim(p_external_message_id), ''),
    now()
  )
  on conflict do nothing
  returning id into v_message;

  return query
  select
    v_lead.id,
    v_conv,
    v_message,
    (v_message is null),
    v_lead.bot_enabled,
    v_lead.stage;
end;
$function$
;
