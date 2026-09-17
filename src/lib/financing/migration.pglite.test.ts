/**
 * Prueba REAL de esquema (PGlite local) — no usa Supabase remoto.
 * Aplica la migración 20260917120000 y confirma columnas v2 + ausencia de overwrite por trigger.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '../../..')
const migrationPath = path.join(
  root,
  'supabase/migrations/20260917120000_investment_simulator_assumptions.sql',
)
const visitorMigrationPath = path.join(
  root,
  'supabase/migrations/20260917180000_financing_scenario_visitor_scope.sql',
)

describe('migración investment-v2 en PGlite (persistencia local real de esquema)', () => {
  it('añade columnas v2 y permite insert con supuestos; sin triggers que sobrescriban', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE TABLE financing_scenarios (
        id uuid PRIMARY KEY DEFAULT '11111111-1111-1111-1111-111111111111',
        tenant_id uuid,
        lead_id uuid,
        unit_id uuid,
        financing_partner_id uuid,
        project_id uuid,
        down_payment_percent float8,
        financing_years int,
        estimated_monthly_rent numeric,
        unit_price numeric,
        down_payment_amount numeric,
        financed_amount numeric,
        applied_interest_rate float8,
        monthly_payment numeric,
        annual_mortgage_paid numeric,
        annual_expenses numeric,
        annual_gross_rental numeric,
        annual_net_cash_flow numeric,
        roi_percent float8,
        payback_years float8,
        breakeven_month int,
        is_profitable boolean,
        status varchar,
        ip_address text,
        user_agent text,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
    `)

    const sql = fs.readFileSync(migrationPath, 'utf8')
    await db.exec(sql)
    await db.exec(fs.readFileSync(visitorMigrationPath, 'utf8'))

    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'financing_scenarios'
         and column_name in (
           'simulation_mode','vacancy_rate_snapshot','calculation_version',
           'rate_type','assumptions_json','expense_breakdown','created_by_visitor_key'
         )
       order by column_name`,
    )
    const names = cols.rows.map((r) => r.column_name)
    assert.deepEqual(names, [
      'assumptions_json',
      'calculation_version',
      'created_by_visitor_key',
      'expense_breakdown',
      'rate_type',
      'simulation_mode',
      'vacancy_rate_snapshot',
    ])

    const triggers = await db.query<{ tgname: string }>(
      `select t.tgname from pg_trigger t
       where t.tgrelid = 'financing_scenarios'::regclass and not t.tgisinternal`,
    )
    assert.equal(triggers.rows.length, 0)

    await db.exec(`
      INSERT INTO financing_scenarios (
        unit_price, estimated_monthly_rent, applied_interest_rate,
        annual_expenses, annual_net_cash_flow, status,
        simulation_mode, vacancy_rate_snapshot, calculation_version,
        rate_type, assumptions_json
      ) VALUES (
        310000, 1200, 7.8,
        4280, -9345.44, 'saved',
        'manual', 0.05, 'investment-v2',
        'nominal_annual', '{"vacancyAppliedOnce":true}'::jsonb
      );
    `)

    const row = await db.query<{
      simulation_mode: string
      vacancy_rate_snapshot: number
      calculation_version: string
      applied_interest_rate: number
      annual_net_cash_flow: number
    }>(`select simulation_mode, vacancy_rate_snapshot, calculation_version,
               applied_interest_rate, annual_net_cash_flow
        from financing_scenarios limit 1`)

    assert.equal(row.rows[0].simulation_mode, 'manual')
    assert.equal(Number(row.rows[0].vacancy_rate_snapshot), 0.05)
    assert.equal(row.rows[0].calculation_version, 'investment-v2')
    assert.equal(Number(row.rows[0].applied_interest_rate), 7.8)
    assert.equal(Number(row.rows[0].annual_net_cash_flow), -9345.44)

    // Simula que NO llamamos calculate_investment_analysis: valores permanecen.
    const again = await db.query<{ annual_expenses: number }>(
      `select annual_expenses from financing_scenarios limit 1`,
    )
    assert.equal(Number(again.rows[0].annual_expenses), 4280)

    await db.close()
  })
})
