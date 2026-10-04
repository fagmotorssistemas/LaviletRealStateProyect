-- Explicit legal-name confirmation and cedula-only intake for every applicant.
-- No messages are sent and no lead is resumed by this migration.
BEGIN;
ALTER TABLE public.financing_prequalifications ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE public.financing_prequalifications ADD COLUMN IF NOT EXISTS legal_name_confirmed boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.process_financing_message_v3(p_lead_id uuid, p_asked_financing boolean DEFAULT false, p_financing_consent boolean DEFAULT NULL::boolean, p_financing_partner text DEFAULT NULL::text, p_full_name text DEFAULT NULL::text, p_applicant_type text DEFAULT NULL::text, p_national_id text DEFAULT NULL::text, p_employment_stability_months integer DEFAULT NULL::integer, p_job_title text DEFAULT NULL::text, p_monthly_income numeric DEFAULT NULL::numeric, p_ruc text DEFAULT NULL::text, p_source_message_id text DEFAULT NULL::text, p_current_message text DEFAULT NULL::text, p_name_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lead public.leads%rowtype;
  v_prequalification public.financing_prequalifications%rowtype;
  v_summary text;
  v_options jsonb := '[]'::jsonb;
  v_selected_partner text;
  v_partner_id uuid;
  v_state text;
  v_next_question text;
  v_name_complete boolean;
  v_available boolean := false;
  v_ready boolean := false;
  v_applicant_type text;
begin
  select l.*
  into v_lead
  from public.leads l
  where l.id = p_lead_id;

  if not found then
    raise exception 'Lead no encontrado';
  end if;

  select
    pfp.public_summary,
    coalesce(pfp.financing_options, '[]'::jsonb)
  into
    v_summary,
    v_options
  from public.project_financing_partners pfp
  where pfp.tenant_id = v_lead.tenant_id
    and pfp.project_id = v_lead.project_id
    and pfp.public_enabled = true
    and (
      pfp.test_only = false
      or regexp_replace(
           coalesce(pfp.test_phone, ''),
           '[^0-9]',
           '',
           'g'
         ) =
         regexp_replace(
           coalesce(v_lead.phone, ''),
           '[^0-9]',
           '',
           'g'
         )
    )
  order by pfp.updated_at desc
  limit 1;

  v_available := found;

  select fp.*
  into v_prequalification
  from public.financing_prequalifications fp
  where fp.lead_id = p_lead_id;

  if not found and (p_asked_financing = true or p_financing_consent = true) then
    insert into public.financing_prequalifications (
      tenant_id,
      project_id,
      lead_id,
      status
    )
    values (
      v_lead.tenant_id,
      v_lead.project_id,
      p_lead_id,
      'recolectando'
    )
    returning *
    into v_prequalification;
  end if;

  if v_prequalification.id is null then
    return jsonb_build_object(
      'active', false,
      'available', v_available,
      'state', 'inactivo',
      'public_summary', v_summary,
      'financing_options', v_options,
      'current_message', p_current_message
    );
  end if;

  if p_financing_consent = true then
    update public.financing_prequalifications fp
    set
      explicit_consent = true,
      consent_text =
        'El cliente confirmó que desea continuar con la revisión preliminar.',
      consent_at = coalesce(fp.consent_at, now()),
      consent_source_message_id =
        coalesce(
          fp.consent_source_message_id,
          p_source_message_id
        ),
      updated_at = now()
    where fp.id = v_prequalification.id;
  end if;

  if p_financing_partner is not null
     and trim(p_financing_partner) <> '' then

    select option_item ->> 'name'
    into v_selected_partner
    from jsonb_array_elements(v_options) option_item
    where
      lower(option_item ->> 'name')
        like '%' || lower(trim(p_financing_partner)) || '%'
      or lower(trim(p_financing_partner))
        like '%' || lower(option_item ->> 'name') || '%'
      or (
        lower(trim(p_financing_partner)) like '%pichincha%'
        and lower(option_item ->> 'name') like '%pichincha%'
      )
      or (
        lower(trim(p_financing_partner)) like '%jep%'
        and lower(option_item ->> 'name') like '%jep%'
      )
    limit 1;

    if v_selected_partner is not null then
      select fp.id
      into v_partner_id
      from public.financing_partners fp
      where
        lower(fp.partner_name) = lower(v_selected_partner)
        or lower(fp.partner_name) like '%' || lower(v_selected_partner) || '%'
        or lower(v_selected_partner) like '%' || lower(fp.partner_name) || '%'
      order by fp.active desc
      limit 1;

      update public.financing_prequalifications fp
      set
        selected_partner_name = v_selected_partner,
        financing_partner_id =
          coalesce(v_partner_id, fp.financing_partner_id),
        updated_at = now()
      where fp.id = v_prequalification.id;
    end if;
  end if;

  if nullif(trim(p_full_name), '') is not null and (v_prequalification.explicit_consent or p_financing_consent is true) then
    update public.financing_prequalifications set legal_name = trim(p_full_name), legal_name_confirmed = coalesce(p_name_complete, false), updated_at = now() where id = v_prequalification.id;
    if p_name_complete then update public.leads set name = trim(p_full_name), updated_at = now() where id = p_lead_id; end if;
  end if;

  v_applicant_type :=
    case lower(coalesce(trim(p_applicant_type), ''))
      when 'dependiente' then 'empleado'
      when 'dependencia' then 'empleado'
      when 'empleado' then 'empleado'
      when 'independiente' then 'independiente'
      else null
    end;

  update public.financing_prequalifications fp
  set
    applicant_type =
      coalesce(v_applicant_type, fp.applicant_type),

    national_id = case
      when p_national_id is null then case when fp.national_id ~ '^[0-9]{10}$' then fp.national_id else null end
      when regexp_replace(coalesce(p_national_id, ''), '[^0-9]', '', 'g') ~ '^[0-9]{10}$' then regexp_replace(p_national_id, '[^0-9]', '', 'g')
      when regexp_replace(coalesce(p_national_id, ''), '[^0-9]', '', 'g') ~ '^(0[1-9]|1[0-9]|2[0-4]|30)[0-5][0-9]{7}001$' then left(regexp_replace(p_national_id, '[^0-9]', '', 'g'), 10)
      else null end,

    employment_stability_months =
      coalesce(
        p_employment_stability_months,
        fp.employment_stability_months
      ),

    job_title =
      coalesce(
        nullif(trim(coalesce(p_job_title, '')), ''),
        fp.job_title
      ),

    monthly_income =
      coalesce(
        p_monthly_income,
        fp.monthly_income
      ),

    updated_at = now()

  where fp.id = v_prequalification.id;

  update public.leads l
  set
    financing = true,
    updated_at = now()
  where l.id = p_lead_id;

  select fp.*
  into v_prequalification
  from public.financing_prequalifications fp
  where fp.id = v_prequalification.id;

  select l.*
  into v_lead
  from public.leads l
  where l.id = p_lead_id;

  v_name_complete :=
    v_prequalification.legal_name_confirmed
    and nullif(trim(v_prequalification.legal_name), '') is not null;

  if v_prequalification.explicit_consent = false then
    v_state := 'continuacion_pendiente';
    v_next_question :=
      'Si le parece, podemos iniciar una revisión preliminar; solo necesitaríamos algunos datos básicos. ¿Desea continuar?';

  elsif v_prequalification.selected_partner_name is null then
    v_state := 'entidad_pendiente';
    v_next_question :=
      '¿Con cuál entidad le gustaría realizar la revisión: Banco Pichincha o Cooperativa JEP?';

  elsif v_name_complete = false
        and v_prequalification.national_id is null then
    v_state := 'identificacion_pendiente';
    v_next_question :=
      '¿Me confirma su nombre completo y su número de cédula, por favor?';

  elsif v_name_complete = false then
    v_state := 'nombre_pendiente';
    v_next_question :=
      '¿Me confirma su nombre completo, por favor?';

  elsif v_prequalification.national_id is null then
    v_state := 'cedula_pendiente';
    v_next_question :=
      '¿Me indica su número de cédula, por favor?';

  elsif v_prequalification.applicant_type is null then
    v_state := 'tipo_solicitante_pendiente';
    v_next_question :=
      '¿Actualmente trabaja bajo relación de dependencia o de manera independiente?';

  elsif v_prequalification.applicant_type = 'empleado'
        and v_prequalification.employment_stability_months is null then
    v_state := 'estabilidad_pendiente';
    v_next_question :=
      '¿Cuánto tiempo lleva trabajando en su empleo actual?';

  elsif v_prequalification.applicant_type = 'empleado'
        and v_prequalification.job_title is null then
    v_state := 'cargo_pendiente';
    v_next_question :=
      '¿Cuál es su cargo actual?';

  elsif v_prequalification.monthly_income is null then
    v_state := 'ingreso_pendiente';
    v_next_question :=
      '¿Cuál es su ingreso mensual aproximado?';

  else
    v_state := 'lista_para_revision';
    v_next_question := null;
    v_ready := true;

    update public.financing_prequalifications fp
    set
      status = 'lista',
      updated_at = now()
    where fp.id = v_prequalification.id;

    insert into public.asesoria_financiamiento (
      tenant_id,
      project_id,
      lead_id,
      prequalification_id,
      mensaje_completo,
      status
    )
    select
      v_lead.tenant_id,
      v_lead.project_id,
      p_lead_id,
      v_prequalification.id,
      'Precalificación lista para revisión',
      'pendiente'
    where not exists (
      select 1
      from public.asesoria_financiamiento af
      where af.prequalification_id = v_prequalification.id
        and af.status in ('pendiente', 'enviada')
    );
  end if;

  return jsonb_build_object(
    'active', true,
    'available', v_available,
    'state', v_state,
    'next_question', v_next_question,
    'ready_for_handoff', v_ready,
    'public_summary', v_summary,
    'financing_options', v_options,
    'selected_partner_name',
      v_prequalification.selected_partner_name,
    'full_name', v_prequalification.legal_name,
    'legal_name_confirmed', v_prequalification.legal_name_confirmed,
    'national_id', v_prequalification.national_id,
    'applicant_type', v_prequalification.applicant_type,
    'employment_stability_months',
      v_prequalification.employment_stability_months,
    'job_title', v_prequalification.job_title,
    'monthly_income', v_prequalification.monthly_income,
    'ruc', v_prequalification.ruc,
    'current_message', p_current_message
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.process_financing_message_v3(uuid,boolean,boolean,text,text,text,text,integer,text,numeric,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_financing_message_v3(uuid,boolean,boolean,text,text,text,text,integer,text,numeric,text,text,text,boolean) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
