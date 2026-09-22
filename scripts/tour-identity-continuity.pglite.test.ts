/**
 * Persistencia real (PGlite) — continuidad showroom + identidad + solicitudes.
 * No toca Supabase remoto ni Meta.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import {
  isWaLeadSubmittedDeliveryEnabled,
  isWaLeadSubmittedEnabled,
} from '../src/lib/meta/waLeadSubmittedFlags'

const root = path.resolve(__dirname, '..')
const migrationPath = path.join(
  root,
  'supabase/migrations/20260921174509_tour_identity_continuity.sql',
)

const TENANT = 'a1b2c3d4-0001-4000-8000-000000000001'
const PROJECT = 'b1b2c3d4-0001-4000-8000-000000000001'
const OTHER_TENANT = 'a1b2c3d4-0002-4000-8000-000000000002'
const UNIT = 'c1b2c3d4-0001-4000-8000-000000000001'

function asJson(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') return value as Record<string, unknown>
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>
  throw new Error('expected jsonb object')
}

async function boot() {
  const db = new PGlite()
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS public;

    CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
    RETURNS text LANGUAGE sql IMMUTABLE AS $$
      select case
        when nullif(regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g'), '') is null then null
        when regexp_replace(p_phone, '[^0-9]', '', 'g') like '593%' then '+' || regexp_replace(p_phone, '[^0-9]', '', 'g')
        when regexp_replace(p_phone, '[^0-9]', '', 'g') like '0%' then '+593' || substr(regexp_replace(p_phone, '[^0-9]', '', 'g'), 2)
        else '+' || regexp_replace(p_phone, '[^0-9]', '', 'g')
      end;
    $$;

    CREATE TABLE public.tenants (id uuid PRIMARY KEY);
    CREATE TABLE public.leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      project_id uuid,
      name text,
      email text,
      phone text,
      phone_normalized text,
      source text,
      channel_origin text,
      first_utm_source text,
      first_utm_medium text,
      first_utm_campaign text,
      first_salesperson_ref text,
      first_landing_path text,
      first_touch_at timestamptz,
      city text,
      country text,
      last_interaction_at timestamptz,
      tracking_consent boolean DEFAULT false,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );
    CREATE UNIQUE INDEX leads_tenant_phone_uq ON public.leads (tenant_id, phone_normalized)
      WHERE phone_normalized IS NOT NULL;

    CREATE TABLE public.units (
      id uuid PRIMARY KEY,
      tenant_id uuid NOT NULL,
      unit_number text
    );

    CREATE TABLE public.tour_visitors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      visitor_key text NOT NULL,
      lead_id uuid REFERENCES public.leads(id),
      first_seen_at timestamptz DEFAULT now(),
      last_seen_at timestamptz DEFAULT now(),
      created_at timestamptz DEFAULT now(),
      UNIQUE (tenant_id, visitor_key)
    );

    CREATE TABLE public.tour_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      visitor_id uuid NOT NULL REFERENCES public.tour_visitors(id),
      lead_id uuid REFERENCES public.leads(id),
      unit_id uuid,
      unit_type_id uuid,
      utm_source text,
      utm_medium text,
      utm_campaign text,
      salesperson_ref text,
      landing_path text,
      city text,
      country text,
      started_at timestamptz DEFAULT now(),
      last_seen_at timestamptz,
      total_seconds int DEFAULT 0,
      tracking_consent boolean DEFAULT false
    );

    CREATE TABLE public.tour_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tour_session_id uuid REFERENCES public.tour_sessions(id),
      visitor_id uuid REFERENCES public.tour_visitors(id),
      lead_id uuid REFERENCES public.leads(id),
      event_type text NOT NULL,
      room text,
      seconds int,
      metadata jsonb DEFAULT '{}'::jsonb,
      unit_type_id uuid,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE public.lead_units (
      lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
      unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
      priority int DEFAULT 0,
      source text,
      interest_level text,
      updated_at timestamptz,
      created_at timestamptz DEFAULT now(),
      PRIMARY KEY (lead_id, unit_id)
    );

    CREATE TABLE public.lead_interactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      lead_id uuid NOT NULL REFERENCES public.leads(id),
      responsible_id uuid,
      type text,
      content text,
      result text,
      channel text,
      created_at timestamptz DEFAULT now()
    );

    INSERT INTO public.tenants (id) VALUES ('${TENANT}'::uuid), ('${OTHER_TENANT}'::uuid);
    INSERT INTO public.units (id, tenant_id, unit_number) VALUES ('${UNIT}'::uuid, '${TENANT}'::uuid, '1204');
  `)

  await db.exec(`
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `)

  await db.exec(fs.readFileSync(migrationPath, 'utf8'))
  return db
}

async function seedVisitor(db: PGlite, key: string, rooms = true) {
  await db.exec(`
    INSERT INTO public.tour_visitors (tenant_id, visitor_key)
    VALUES ('${TENANT}'::uuid, '${key}');
  `)
  const visitor = await db.query<{ id: string }>(
    `SELECT id FROM tour_visitors WHERE visitor_key = '${key}'`,
  )
  const visitorId = visitor.rows[0].id
  await db.exec(`
    INSERT INTO public.tour_sessions (tenant_id, visitor_id, utm_source, landing_path)
    VALUES ('${TENANT}'::uuid, '${visitorId}'::uuid, 'meta', '/tour');
  `)
  const session = await db.query<{ id: string }>(
    `SELECT id FROM tour_sessions WHERE visitor_id = '${visitorId}'::uuid ORDER BY started_at LIMIT 1`,
  )
  const sessionId = session.rows[0].id
  if (rooms) {
    await db.exec(`
      INSERT INTO public.tour_events (tour_session_id, visitor_id, event_type, room, seconds, metadata)
      VALUES
        ('${sessionId}'::uuid, '${visitorId}'::uuid, 'entrada', 'Sala', 0, '{"typology_code":"A2"}'::jsonb),
        ('${sessionId}'::uuid, '${visitorId}'::uuid, 'ambiente', 'Sala', 40, '{"typology_code":"A2"}'::jsonb),
        ('${sessionId}'::uuid, '${visitorId}'::uuid, 'ambiente', 'Cocina', 25, '{"typology_code":"A2"}'::jsonb);
    `)
  }
  return { visitorId, sessionId }
}

describe('tour identity continuity (PGlite)', () => {
  it('anónimo → celular → formulario → nueva sesión: mismo lead y continuidad', async () => {
    const db = await boot()
    const { visitorId, sessionId } = await seedVisitor(db, 'vid-flow-1')

    const leadsBefore = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM leads`)
    assert.equal(leadsBefore.rows[0].n, 0)

    const phoneLead = await db.query<{ identify_tour_lead: string }>(
      `SELECT identify_tour_lead(
        '${TENANT}'::uuid, 'vid-flow-1', 'WhatsApp ····2233', 'wa.0991112233@showroom.lavilet',
        '0991112233', '${PROJECT}'::uuid
      ) AS identify_tour_lead`,
    )
    const leadId = phoneLead.rows[0].identify_tour_lead
    assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM leads`)).rows[0].n, 1)

    const linkedAnon = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tour_events
       WHERE visitor_id = '${visitorId}'::uuid AND lead_id = '${leadId}'::uuid AND event_type <> 'lead_identificado'`,
    )
    assert.equal(linkedAnon.rows[0].n, 3)

    const fullForm = await db.query<{ identify_tour_lead: string }>(
      `SELECT identify_tour_lead(
        '${TENANT}'::uuid, 'vid-flow-1', 'Ana Pérez', 'ana@example.com', '099 111 2233', '${PROJECT}'::uuid
      ) AS identify_tour_lead`,
    )
    assert.equal(fullForm.rows[0].identify_tour_lead, leadId)
    assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM leads`)).rows[0].n, 1)
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM tour_events
           WHERE visitor_id = '${visitorId}'::uuid AND event_type = 'lead_identificado'`,
        )
      ).rows[0].n,
      1,
    )

    const leadRow = await db.query<{ name: string; email: string }>(
      `SELECT name, email FROM leads WHERE id = '${leadId}'::uuid`,
    )
    assert.equal(leadRow.rows[0].name, 'Ana Pérez')
    assert.equal(leadRow.rows[0].email, 'ana@example.com')

    const req1 = asJson(
      (
        await db.query<{ register_tour_info_request: unknown }>(
          `SELECT register_tour_info_request(
            '${TENANT}'::uuid, '${leadId}'::uuid, 'vid-flow-1', '${sessionId}'::uuid,
            '${UNIT}'::uuid, NULL, 'A2', 'Quiero más información', 'Horario tarde', 'client-req-1'
          ) AS register_tour_info_request`,
        )
      ).rows[0].register_tour_info_request,
    )
    assert.equal(req1.created, true)

    await db.exec(`
      INSERT INTO public.tour_sessions (tenant_id, visitor_id)
      VALUES ('${TENANT}'::uuid, '${visitorId}'::uuid);
    `)
    await db.query(
      `SELECT identify_tour_lead(
        '${TENANT}'::uuid, 'vid-flow-1', 'Ana Pérez', 'ana@example.com', '0991112233', '${PROJECT}'::uuid
      )`,
    )
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM tour_sessions
           WHERE visitor_id = '${visitorId}'::uuid AND lead_id = '${leadId}'::uuid`,
        )
      ).rows[0].n,
      2,
    )

    await db.close()
  })

  it('doble clic mismo client_request_id y peticiones concurrentes no duplican', async () => {
    const db = await boot()
    const { sessionId } = await seedVisitor(db, 'vid-dup')
    const leadId = (
      await db.query<{ identify_tour_lead: string }>(
        `SELECT identify_tour_lead(
          '${TENANT}'::uuid, 'vid-dup', 'Ana', 'ana@example.com', '0992223344', '${PROJECT}'::uuid
        ) AS identify_tour_lead`,
      )
    ).rows[0].identify_tour_lead

    const a = asJson(
      (
        await db.query<{ register_tour_info_request: unknown }>(
          `SELECT register_tour_info_request(
            '${TENANT}'::uuid, '${leadId}'::uuid, 'vid-dup', '${sessionId}'::uuid,
            '${UNIT}'::uuid, NULL, 'A2', 'Consulta', 'msg', 'same-client-id'
          ) AS register_tour_info_request`,
        )
      ).rows[0].register_tour_info_request,
    )
    const b = asJson(
      (
        await db.query<{ register_tour_info_request: unknown }>(
          `SELECT register_tour_info_request(
            '${TENANT}'::uuid, '${leadId}'::uuid, 'vid-dup', '${sessionId}'::uuid,
            '${UNIT}'::uuid, NULL, 'A2', 'Consulta', 'msg', 'same-client-id'
          ) AS register_tour_info_request`,
        )
      ).rows[0].register_tour_info_request,
    )
    assert.equal(a.created, true)
    assert.equal(b.duplicate, true)
    assert.equal(a.id, b.id)
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM tour_info_requests WHERE lead_id = '${leadId}'::uuid`,
        )
      ).rows[0].n,
      1,
    )

    // Simula dos inserts concurrentes con el mismo id (segundo gana ON CONFLICT DO NOTHING).
    await db.query(
      `SELECT register_tour_info_request(
        '${TENANT}'::uuid, '${leadId}'::uuid, 'vid-dup', '${sessionId}'::uuid,
        '${UNIT}'::uuid, NULL, 'A2', 'Consulta', 'msg', 'concurrent-id'
      )`,
    )
    await db.query(
      `SELECT register_tour_info_request(
        '${TENANT}'::uuid, '${leadId}'::uuid, 'vid-dup', '${sessionId}'::uuid,
        '${UNIT}'::uuid, NULL, 'A2', 'Consulta', 'msg', 'concurrent-id'
      )`,
    )
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM tour_info_requests WHERE client_request_id = 'concurrent-id'`,
        )
      ).rows[0].n,
      1,
    )

    await db.close()
  })

  it('solicitudes legítimas distintas con contenido idéntico se conservan', async () => {
    const db = await boot()
    const { sessionId } = await seedVisitor(db, 'vid-legit')
    const leadId = (
      await db.query<{ identify_tour_lead: string }>(
        `SELECT identify_tour_lead(
          '${TENANT}'::uuid, 'vid-legit', 'Ana', 'ana@example.com', '0993334455', '${PROJECT}'::uuid
        ) AS identify_tour_lead`,
      )
    ).rows[0].identify_tour_lead

    const r1 = asJson(
      (
        await db.query<{ register_tour_info_request: unknown }>(
          `SELECT register_tour_info_request(
            '${TENANT}'::uuid, '${leadId}'::uuid, 'vid-legit', '${sessionId}'::uuid,
            '${UNIT}'::uuid, NULL, 'A2', 'Quiero más información', 'Mismo texto', 'intent-1'
          ) AS register_tour_info_request`,
        )
      ).rows[0].register_tour_info_request,
    )
    const r2 = asJson(
      (
        await db.query<{ register_tour_info_request: unknown }>(
          `SELECT register_tour_info_request(
            '${TENANT}'::uuid, '${leadId}'::uuid, 'vid-legit', '${sessionId}'::uuid,
            '${UNIT}'::uuid, NULL, 'A2', 'Quiero más información', 'Mismo texto', 'intent-2'
          ) AS register_tour_info_request`,
        )
      ).rows[0].register_tour_info_request,
    )
    assert.equal(r1.created, true)
    assert.equal(r2.created, true)
    assert.notEqual(r1.id, r2.id)
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM tour_info_requests WHERE lead_id = '${leadId}'::uuid`,
        )
      ).rows[0].n,
      2,
    )
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM lead_interactions
           WHERE lead_id = '${leadId}'::uuid AND type = 'showroom_solicitud'`,
        )
      ).rows[0].n,
      2,
    )

    await db.close()
  })

  it('reintento tras fallo de solicitud con mismo client_request_id no duplica', async () => {
    const db = await boot()
    const { sessionId } = await seedVisitor(db, 'vid-retry')
    const leadId = (
      await db.query<{ identify_tour_lead: string }>(
        `SELECT identify_tour_lead(
          '${TENANT}'::uuid, 'vid-retry', 'Ana', 'ana@example.com', '0994445566', '${PROJECT}'::uuid
        ) AS identify_tour_lead`,
      )
    ).rows[0].identify_tour_lead

    // Primera vez OK; segunda = reintento seguro del cliente tras 422 simulado.
    await db.query(
      `SELECT register_tour_info_request(
        '${TENANT}'::uuid, '${leadId}'::uuid, 'vid-retry', '${sessionId}'::uuid,
        '${UNIT}'::uuid, NULL, 'A2', 'Consulta', 'reintento', 'retry-id-1'
      )`,
    )
    const again = asJson(
      (
        await db.query<{ register_tour_info_request: unknown }>(
          `SELECT register_tour_info_request(
            '${TENANT}'::uuid, '${leadId}'::uuid, 'vid-retry', '${sessionId}'::uuid,
            '${UNIT}'::uuid, NULL, 'A2', 'Consulta', 'reintento', 'retry-id-1'
          ) AS register_tour_info_request`,
        )
      ).rows[0].register_tour_info_request,
    )
    assert.equal(again.duplicate, true)
    assert.equal(
      (
        await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM tour_info_requests WHERE lead_id = '${leadId}'::uuid`,
        )
      ).rows[0].n,
      1,
    )

    await db.close()
  })

  it('rechaza conflicto teléfono/correo y visitante ya asociado', async () => {
    const db = await boot()

    await db.exec(`
      INSERT INTO public.leads (tenant_id, name, email, phone, phone_normalized, source, channel_origin)
      VALUES
        ('${TENANT}'::uuid, 'Tel', 'tel@example.com', '0990000001', public.normalize_phone('0990000001'), 'web', 'web'),
        ('${TENANT}'::uuid, 'Mail', 'mail@example.com', '0990000002', public.normalize_phone('0990000002'), 'web', 'web');
    `)
    await db.exec(`
      INSERT INTO public.tour_visitors (tenant_id, visitor_key)
      VALUES ('${TENANT}'::uuid, 'vid-conflict');
    `)

    await assert.rejects(
      () =>
        db.query(
          `SELECT identify_tour_lead(
            '${TENANT}'::uuid, 'vid-conflict', 'X', 'mail@example.com', '0990000001', '${PROJECT}'::uuid
          )`,
        ),
      (error: unknown) => String(error).includes('IDENTITY_CONFLICT_PHONE_EMAIL'),
    )

    const linkedLead = (
      await db.query<{ identify_tour_lead: string }>(
        `SELECT identify_tour_lead(
          '${TENANT}'::uuid, 'vid-linked', 'Tel', 'tel@example.com', '0990000001', '${PROJECT}'::uuid
        ) AS identify_tour_lead`,
      )
    ).rows[0].identify_tour_lead

    await assert.rejects(
      () =>
        db.query(
          `SELECT identify_tour_lead(
            '${TENANT}'::uuid, 'vid-linked', 'Otro', 'otro@example.com', '0987654321', '${PROJECT}'::uuid
          )`,
        ),
      (error: unknown) => String(error).includes('VISITOR_ALREADY_LINKED'),
    )

    await db.exec(`
      INSERT INTO public.units (id, tenant_id, unit_number)
      VALUES ('c1b2c3d4-9999-4000-8000-000000000099'::uuid, '${OTHER_TENANT}'::uuid, '999');
    `)
    await assert.rejects(
      () =>
        db.query(
          `SELECT register_tour_info_request(
            '${TENANT}'::uuid, '${linkedLead}'::uuid, 'vid-linked', NULL,
            'c1b2c3d4-9999-4000-8000-000000000099'::uuid, NULL, 'A2',
            'Consulta', NULL, 'cross-tenant-unit'
          )`,
        ),
      (error: unknown) => String(error).includes('TOUR_INFO_REQUEST_UNIT_INVALID'),
    )

    await db.close()
  })

  it('no vincula visitante de otro dispositivo sin identificación compartida', async () => {
    const db = await boot()
    const a = await seedVisitor(db, 'vid-device-a')
    const b = await seedVisitor(db, 'vid-device-b')

    const leadId = (
      await db.query<{ identify_tour_lead: string }>(
        `SELECT identify_tour_lead(
          '${TENANT}'::uuid, 'vid-device-a', 'Ana', 'ana@example.com', '0995556677', '${PROJECT}'::uuid
        ) AS identify_tour_lead`,
      )
    ).rows[0].identify_tour_lead

    const otherLead = await db.query<{ lead_id: string | null }>(
      `SELECT lead_id FROM tour_visitors WHERE id = '${b.visitorId}'::uuid`,
    )
    assert.equal(otherLead.rows[0].lead_id, null)

    const otherEvents = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tour_events
       WHERE visitor_id = '${b.visitorId}'::uuid AND lead_id = '${leadId}'::uuid`,
    )
    assert.equal(otherEvents.rows[0].n, 0)
    void a

    await db.close()
  })

  it('formatos equivalentes de teléfono resuelven al mismo lead', async () => {
    const db = await boot()
    await db.exec(`
      INSERT INTO public.tour_visitors (tenant_id, visitor_key)
      VALUES ('${TENANT}'::uuid, 'vid-phone-fmt');
    `)
    const a = await db.query<{ identify_tour_lead: string }>(
      `SELECT identify_tour_lead(
        '${TENANT}'::uuid, 'vid-phone-fmt', 'P', 'p@example.com', '0991234567', '${PROJECT}'::uuid
      ) AS identify_tour_lead`,
    )
    const b = await db.query<{ identify_tour_lead: string }>(
      `SELECT identify_tour_lead(
        '${TENANT}'::uuid, 'vid-phone-fmt', 'P', 'p@example.com', '+593991234567', '${PROJECT}'::uuid
      ) AS identify_tour_lead`,
    )
    assert.equal(a.rows[0].identify_tour_lead, b.rows[0].identify_tour_lead)
    assert.equal((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM leads`)).rows[0].n, 1)
    await db.close()
  })

  it('mapa: entradas y segundos no mezclan ambiente como visita; un lead_identificado', async () => {
    const db = await boot()
    const { visitorId, sessionId } = await seedVisitor(db, 'vid-metrics')
    await db.query(
      `SELECT identify_tour_lead(
        '${TENANT}'::uuid, 'vid-metrics', 'Ana', 'ana@example.com', '0996667788', '${PROJECT}'::uuid
      )`,
    )
    await db.query(
      `SELECT identify_tour_lead(
        '${TENANT}'::uuid, 'vid-metrics', 'Ana', 'ana@example.com', '0996667788', '${PROJECT}'::uuid
      )`,
    )

    const entradas = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tour_events
       WHERE tour_session_id = '${sessionId}'::uuid AND event_type = 'entrada'`,
    )
    const ambientes = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tour_events
       WHERE tour_session_id = '${sessionId}'::uuid AND event_type = 'ambiente'`,
    )
    const ids = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM tour_events
       WHERE visitor_id = '${visitorId}'::uuid AND event_type = 'lead_identificado'`,
    )
    const seconds = await db.query<{ s: number }>(
      `SELECT coalesce(sum(seconds),0)::int AS s FROM tour_events
       WHERE tour_session_id = '${sessionId}'::uuid AND event_type IN ('ambiente','salida')`,
    )
    assert.equal(entradas.rows[0].n, 1)
    assert.equal(ambientes.rows[0].n, 2)
    assert.equal(ids.rows[0].n, 1)
    assert.equal(seconds.rows[0].s, 65)

    await db.close()
  })
})

describe('regresión WhatsApp flags (sin activar conversiones)', () => {
  it('flags WA default OFF con env vacío o false', () => {
    assert.equal(isWaLeadSubmittedEnabled({}), false)
    assert.equal(isWaLeadSubmittedDeliveryEnabled({}), false)
    assert.equal(
      isWaLeadSubmittedEnabled({ META_WA_LEAD_SUBMITTED_ENABLED: 'false' } as NodeJS.ProcessEnv),
      false,
    )
    assert.equal(
      isWaLeadSubmittedDeliveryEnabled({
        META_WA_LEAD_SUBMITTED_ENABLED: 'true',
        META_WA_LEAD_SUBMITTED_DELIVERY_ENABLED: 'false',
      } as NodeJS.ProcessEnv),
      false,
    )
  })
})
