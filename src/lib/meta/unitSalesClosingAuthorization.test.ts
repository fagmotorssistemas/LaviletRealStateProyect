import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20260924183000_unit_sales_closings_scoped_authorization.sql', 'utf8')

test('cierres niegan anon y eliminan la política authenticated abierta', () => {
  assert.match(sql, /REVOKE ALL ON TABLE public\.unit_sales_closings FROM PUBLIC, anon/i)
  assert.doesNotMatch(sql, /FOR ALL TO authenticated\s+USING \(true\)/i)
})

test('asesor autorizado requiere sold_by propio y pertenencia al proyecto', () => {
  assert.match(sql, /p_sold_by_id = \(SELECT auth\.uid\(\)\)/i)
  assert.match(sql, /project_salespeople[\s\S]*salesperson_id = \(SELECT auth\.uid\(\)\)/i)
  assert.match(sql, /public\.is_admin\(\)/i)
  assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path = public/i)
  assert.match(sql, /AS RESTRICTIVE FOR INSERT/i)
  assert.match(sql, /AS RESTRICTIVE FOR UPDATE/i)
})

test('el contrato conserva roles y permisos cerrados', () => {
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*TO authenticated/i)
  assert.match(sql, /GRANT ALL[\s\S]*TO service_role/i)
  assert.match(sql, /GRANT EXECUTE[\s\S]*TO authenticated, service_role/i)
  assert.doesNotMatch(sql, /GRANT (?:ALL|SELECT|INSERT|UPDATE|DELETE)[\s\S]*TO anon/i)
})

test('las columnas evaluadas por RLS tienen índices preparados', () => {
  assert.match(sql, /unit_sales_closings\(unit_id\)/i)
  assert.match(sql, /unit_sales_closings\(tenant_id\)/i)
  assert.match(sql, /unit_sales_closings\(sold_by_id\)/i)
  assert.match(sql, /project_salespeople\(salesperson_id, project_id, tenant_id\)/i)
})
