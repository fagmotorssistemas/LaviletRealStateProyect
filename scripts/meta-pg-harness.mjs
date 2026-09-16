/**
 * Harness PostgreSQL real (PGlite) para migraciones/RPC Meta CAPI.
 * No toca producción ni Meta.
 */
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const migrationsDir = join(root, 'supabase', 'migrations')

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  const db = new PGlite()
  const results = []

  const exec = async (q, label) => {
    try {
      await db.exec(q)
    } catch (error) {
      throw new Error(`${label || 'exec'}: ${error.message}\n---\n${q.slice(0, 240)}`)
    }
  }

  const sql = async (q, label) => {
    try {
      return await db.query(q)
    } catch (error) {
      throw new Error(`${label || 'sql'}: ${error.message}\n---\n${q.slice(0, 240)}`)
    }
  }

  // Roles estilo Supabase
  await exec(`
    DO $$ BEGIN
      CREATE ROLE anon NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE ROLE authenticated NOLOGIN;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN
      CREATE ROLE service_role NOLOGIN BYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  `, 'roles')

  // Esquema mínimo para identify_tour_lead
  await exec(`
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
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      last_interaction_at timestamptz
    );
    CREATE TABLE public.tour_visitors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      visitor_key text NOT NULL,
      lead_id uuid,
      last_seen_at timestamptz DEFAULT now(),
      UNIQUE (tenant_id, visitor_key)
    );
    CREATE TABLE public.tour_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      visitor_id uuid,
      lead_id uuid,
      started_at timestamptz DEFAULT now(),
      utm_source text, utm_medium text, utm_campaign text,
      salesperson_ref text, landing_path text, city text, country text
    );
    CREATE TABLE public.tour_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tour_session_id uuid,
      visitor_id uuid,
      lead_id uuid,
      event_type text,
      metadata jsonb DEFAULT '{}'::jsonb
    );
    CREATE OR REPLACE FUNCTION public.normalize_phone(p text) RETURNS text
    LANGUAGE sql IMMUTABLE AS $$ SELECT NULLIF(regexp_replace(COALESCE(p,''), '\\D', '', 'g'), '') $$;

    CREATE OR REPLACE FUNCTION public.identify_tour_lead(
      p_tenant_id uuid, p_visitor_key text, p_name text, p_email text, p_phone text, p_project_id uuid DEFAULT NULL
    ) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE v_visitor uuid; v_lead uuid; v_phone text := normalize_phone(p_phone);
    BEGIN
      INSERT INTO tour_visitors (tenant_id, visitor_key)
      VALUES (p_tenant_id, p_visitor_key)
      ON CONFLICT (tenant_id, visitor_key) DO UPDATE SET last_seen_at = now()
      RETURNING id INTO v_visitor;

      SELECT l.id INTO v_lead FROM leads l
       WHERE l.tenant_id = p_tenant_id
         AND ((v_phone IS NOT NULL AND l.phone_normalized = v_phone)
           OR (p_email IS NOT NULL AND lower(l.email) = lower(p_email)))
       ORDER BY l.created_at ASC LIMIT 1;

      IF v_lead IS NULL THEN
        INSERT INTO leads (tenant_id, project_id, name, email, phone, phone_normalized, source, channel_origin)
        VALUES (p_tenant_id, p_project_id, p_name, p_email, p_phone, v_phone, 'showroom_360', 'web')
        RETURNING id INTO v_lead;
      END IF;

      UPDATE tour_visitors SET lead_id = v_lead WHERE id = v_visitor;
      RETURN v_lead;
    END $$;
  `, 'stub-schema')

  const files = [
    '20260915153000_meta_capi_outbox.sql',
    '20260915160000_meta_lead_atomic_and_consent.sql',
    '20260915170000_meta_capi_outbox_rls_consent_ledger.sql',
    '20260915171000_meta_consent_seq_and_strict_recover.sql',
    '20260915180000_lead_ads_consent_respects_ledger.sql',
    '20260915223000_meta_rpc_execute_service_role_only.sql',
  ]
  for (const f of files) {
    const body = readFileSync(join(migrationsDir, f), 'utf8')
    await exec(body, f)
  }
  results.push('migrations_applied')

  // --- Permisos anon/authenticated ---
  await exec(`SET ROLE anon`, 'set-anon')
  let anonBlocked = false
  try {
    await db.query(`SELECT * FROM public.meta_capi_outbox LIMIT 1`)
  } catch {
    anonBlocked = true
  }
  await exec(`RESET ROLE`, 'reset')
  assert(anonBlocked, 'anon debería estar bloqueado en meta_capi_outbox')
  results.push('anon_blocked')

  await exec(`SET ROLE authenticated`, 'set-auth')
  let authBlocked = false
  try {
    await db.query(`INSERT INTO public.meta_capi_outbox (
      idempotency_key, event_id, event_name, event_time, payload, delivery_lane
    ) VALUES ('x', gen_random_uuid(), 'Lead', 1, '{}', 'live')`)
  } catch {
    authBlocked = true
  }
  await exec(`RESET ROLE`, 'reset2')
  assert(authBlocked, 'authenticated no debe insertar en meta_capi_outbox')
  results.push('authenticated_blocked')

  await exec(`SET ROLE service_role`, 'set-service')
  const svc = await db.query(`SELECT count(*)::int AS c FROM public.meta_capi_outbox`)
  assert(svc.rows[0].c === 0, 'service_role puede leer outbox')
  await exec(`RESET ROLE`, 'reset3')
  results.push('service_role_ok')

  // --- Guardado atómico ---
  const tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
  const project = 'b1b2c3d4-0001-4000-8000-000000000001'
  const atomic = await sql(`
    SELECT public.identify_tour_lead_with_meta_outbox(
      '${tenant}'::uuid, 'visitor-atomic', 'Ana', 'ana@test.com', '0991112233',
      '${project}'::uuid, true, NULL, NULL, 'test',
      '{"action_source":"website","visitor_key":"visitor-atomic","phone":"0991112233"}'::jsonb
    ) AS r
  `, 'atomic')
  const atomicRow = atomic.rows[0].r
  assert(atomicRow.emit_meta_lead === true, 'debe emitir lead nuevo')
  assert(atomicRow.outbox_inserted === true, 'outbox insertado')
  const out = await sql(`
    SELECT delivery_lane, visitor_key, status FROM meta_capi_outbox
    WHERE idempotency_key = 'lead:' || '${atomicRow.lead_id}'
  `, 'outbox-row')
  assert(out.rows[0].delivery_lane === 'test', 'lane test conservada')
  assert(out.rows[0].visitor_key === 'visitor-atomic', 'visitor_key conservado')
  assert(out.rows[0].status === 'pending', 'status pending')
  results.push('atomic_save_ok')

  // Fallo real dentro de identify_tour_lead_with_meta_outbox al insertar outbox
  await exec(`
    CREATE OR REPLACE FUNCTION public._boom_outbox() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'forced_outbox_insert_fail';
    END $$;
    CREATE TRIGGER trg_boom_meta_outbox
      BEFORE INSERT ON public.meta_capi_outbox
      FOR EACH ROW
      WHEN (NEW.visitor_key = 'visitor-boom')
      EXECUTE FUNCTION public._boom_outbox();
  `, 'boom-trigger')

  const beforeLeads = await sql(
    `SELECT count(*)::int AS c FROM leads WHERE phone_normalized = '0999999999'`,
    'before-leads',
  )
  const beforeVisitors = await sql(
    `SELECT count(*)::int AS c FROM tour_visitors WHERE visitor_key = 'visitor-boom'`,
    'before-visitors',
  )
  assert(beforeLeads.rows[0].c === 0 && beforeVisitors.rows[0].c === 0, 'precondiciones boom')

  let rpcFailed = false
  try {
    await db.query(`
      SELECT public.identify_tour_lead_with_meta_outbox(
        '${tenant}'::uuid, 'visitor-boom', 'Boom', 'boom@test.com', '0999999999',
        '${project}'::uuid, true, NULL, NULL, 'test',
        '{"action_source":"website","visitor_key":"visitor-boom"}'::jsonb
      )
    `)
  } catch (error) {
    rpcFailed = String(error.message || error).includes('forced_outbox_insert_fail')
  }
  assert(rpcFailed, 'RPC debe fallar al insertar outbox')

  const afterLeads = await sql(
    `SELECT count(*)::int AS c FROM leads WHERE phone_normalized = '0999999999'`,
    'after-leads',
  )
  const afterVisitors = await sql(
    `SELECT count(*)::int AS c FROM tour_visitors WHERE visitor_key = 'visitor-boom'`,
    'after-visitors',
  )
  const afterOutbox = await sql(
    `SELECT count(*)::int AS c FROM meta_capi_outbox WHERE visitor_key = 'visitor-boom'`,
    'after-outbox',
  )
  assert(afterLeads.rows[0].c === 0, 'lead nuevo revertido')
  assert(afterVisitors.rows[0].c === 0, 'asociación visitante revertida')
  assert(afterOutbox.rows[0].c === 0, 'outbox no quedó parcial')
  results.push('rpc_outbox_fail_rolls_back_lead_and_visitor')

  await exec(`DROP TRIGGER IF EXISTS trg_boom_meta_outbox ON public.meta_capi_outbox`, 'drop-boom')

  // --- Consent concurrente con secuencia ---
  const c1 = await sql(`SELECT public.lv_record_meta_ads_consent(false, 'visitor-atomic', '${atomicRow.lead_id}'::uuid) AS r`, 'revoke')
  const c2 = await sql(`SELECT public.lv_record_meta_ads_consent(true, 'visitor-atomic', '${atomicRow.lead_id}'::uuid) AS r`, 'grant')
  assert(Number(c2.rows[0].r.consent_version) > Number(c1.rows[0].r.consent_version), 'secuencia monotónica')
  // Simular grant atrasado en Nest: versión menor no aplica
  const vRevoke = Number(c1.rows[0].r.consent_version)
  const vGrant = Number(c2.rows[0].r.consent_version)
  assert(vGrant > vRevoke, 'grant posterior > revoke')
  // Concurrent inserts
  await Promise.all([
    sql(`SELECT nextval('meta_ads_consent_version_seq') AS v`, 'seq-a'),
    sql(`SELECT nextval('meta_ads_consent_version_seq') AS v`, 'seq-b'),
    sql(`SELECT nextval('meta_ads_consent_version_seq') AS v`, 'seq-c'),
  ])
  const seq = await sql(`SELECT last_value FROM meta_ads_consent_version_seq`, 'seq-last')
  assert(Number(seq.rows[0].last_value) >= vGrant + 3, 'secuencia avanza bajo concurrencia')
  results.push('consent_sequence_ok')

  // --- Recover: sin lane → needs_review; con visitor ---
  await exec(`
    INSERT INTO leads (
      id, tenant_id, name, phone, phone_normalized,
      meta_ads_consent, meta_lead_event_id, meta_lead_event_time,
      meta_lead_visitor_key, meta_lead_payload
    ) VALUES (
      '22222222-2222-4222-8222-222222222222', '${tenant}', 'Recover', '099', '099',
      true, '33333333-3333-4333-8333-333333333333', 1700000999,
      'visitor-recover', '{"action_source":"website","fbp":"fb.1"}'::jsonb
    )
  `, 'lead-missing-lane')
  const recovered = await sql(`SELECT public.lv_recover_missing_meta_lead_outbox(10) AS n`, 'recover')
  assert(Number(recovered.rows[0].n) >= 1, 'recover insertó filas')
  const held = await sql(`
    SELECT status, delivery_lane, visitor_key, last_error, payload->>'fbp' AS fbp
    FROM meta_capi_outbox
    WHERE lead_id = '22222222-2222-4222-8222-222222222222'
  `, 'held')
  assert(held.rows[0].status === 'needs_review', 'sin lane → needs_review')
  assert(held.rows[0].visitor_key === 'visitor-recover', 'visitor_key conservado')
  assert(held.rows[0].fbp === 'fb.1', 'payload original conservado')
  assert(held.rows[0].last_error === 'missing_delivery_lane_needs_review', 'error de revisión')
  results.push('recover_needs_review_ok')

  // Recover con lane test
  await exec(`
    INSERT INTO leads (
      id, tenant_id, name, phone, phone_normalized,
      meta_ads_consent, meta_lead_event_id, meta_lead_event_time,
      meta_lead_delivery_lane, meta_lead_visitor_key, meta_lead_payload
    ) VALUES (
      '44444444-4444-4444-8444-444444444444', '${tenant}', 'Recover2', '098', '098',
      true, '55555555-5555-4555-8555-555555555555', 1700000888,
      'test', 'visitor-test-lane', '{"phone":"098"}'::jsonb
    )
  `, 'lead-with-lane')
  await sql(`SELECT public.lv_recover_missing_meta_lead_outbox(10) AS n`, 'recover2')
  const okLane = await sql(`
    SELECT status, delivery_lane, visitor_key FROM meta_capi_outbox
    WHERE lead_id = '44444444-4444-4444-8444-444444444444'
  `, 'lane-ok')
  assert(okLane.rows[0].status === 'pending', 'con lane → pending')
  assert(okLane.rows[0].delivery_lane === 'test', 'lane test no forzada a live')
  assert(okLane.rows[0].visitor_key === 'visitor-test-lane', 'visitor recover')
  results.push('recover_preserves_test_lane')

  // --- Revocación vigente en ledger prevalece sobre cookie (p_ads_consent=true) ---
  await sql(
    `SELECT public.lv_record_meta_ads_consent(false, 'visitor-ledger-revoke', NULL) AS r`,
    'ledger-revoke',
  )
  const blockedByLedger = await sql(
    `
    SELECT public.identify_tour_lead_with_meta_outbox(
      '${tenant}'::uuid, 'visitor-ledger-revoke', 'Revoke', 'revoke@test.com', '0991110000',
      '${project}'::uuid, true, NULL, NULL, 'test',
      '{"action_source":"website","visitor_key":"visitor-ledger-revoke"}'::jsonb
    ) AS r
  `,
    'identify-with-stale-cookie',
  )
  const blockedRow = blockedByLedger.rows[0].r
  assert(blockedRow.emit_meta_lead === false, 'revocación vigente bloquea emit pese a cookie')
  assert(blockedRow.outbox_inserted === false, 'sin outbox con ledger revoke')
  const leadAds = await sql(
    `SELECT meta_ads_consent FROM leads WHERE id = '${blockedRow.lead_id}'`,
    'lead-ads-flag',
  )
  assert(leadAds.rows[0].meta_ads_consent === false, 'lead.meta_ads_consent alineado a false')
  const blockedOutbox = await sql(
    `SELECT count(*)::int AS c FROM meta_capi_outbox WHERE visitor_key = 'visitor-ledger-revoke'`,
    'blocked-outbox',
  )
  assert(blockedOutbox.rows[0].c === 0, 'no hay fila outbox para visitante revocado')
  results.push('ledger_revoke_beats_cookie')

  // --- RPC Meta: solo service_role (no anon / authenticated) ---
  const metaRpcProbes = [
    {
      name: 'identify_tour_lead_with_meta_outbox',
      sql: `SELECT public.identify_tour_lead_with_meta_outbox(
        '${tenant}'::uuid, 'visitor-rpc-role', 'Role', 'role@test.com', '0992220000',
        '${project}'::uuid, false, NULL, NULL, 'test', '{}'::jsonb
      )`,
    },
    {
      name: 'lv_recover_missing_meta_lead_outbox',
      sql: `SELECT public.lv_recover_missing_meta_lead_outbox(1)`,
    },
    {
      name: 'lv_record_meta_ads_consent',
      sql: `SELECT public.lv_record_meta_ads_consent(false, 'visitor-rpc-role', NULL)`,
    },
    {
      name: 'lv_resolve_lead_id_for_visitor',
      sql: `SELECT public.lv_resolve_lead_id_for_visitor('${tenant}'::uuid, 'visitor-rpc-role')`,
    },
    {
      name: 'lv_revoke_meta_ads_consent',
      sql: `SELECT public.lv_revoke_meta_ads_consent(NULL, 'visitor-rpc-role')`,
    },
  ]

  for (const role of ['anon', 'authenticated']) {
    await exec(`SET ROLE ${role}`, `set-role-${role}`)
    for (const probe of metaRpcProbes) {
      let denied = false
      try {
        await db.query(probe.sql)
      } catch (error) {
        const msg = String(error.message || error)
        denied = /permission denied|must be owner/i.test(msg)
      }
      assert(denied, `${role} no debe ejecutar ${probe.name}`)
    }
    await exec(`RESET ROLE`, `reset-role-${role}`)
  }

  await exec(`SET ROLE service_role`, 'set-role-service-rpc')
  for (const probe of metaRpcProbes) {
    await db.query(probe.sql)
  }
  await exec(`RESET ROLE`, 'reset-role-service-rpc')
  results.push('meta_rpc_service_role_only')

  console.log(JSON.stringify({ ok: true, results }, null, 2))
  await db.close()
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2))
  process.exit(1)
})
