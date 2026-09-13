import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { disableNutritionSequence, seedNutritionSteps } from './automationRules.service'
import { DEFAULT_NUTRITION_TOPICS } from '../types/automationRules'

function client(fetcher: typeof fetch) {
  return createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher },
  })
}

test('preparing four weeks never activates or approves a message', async () => {
  let requests = 0
  const db = client(async (input, init) => {
    requests++
    assert.equal(new URL(String(input)).pathname, '/rest/v1/nutrition_steps')
    assert.equal(init?.method, 'POST')
    const rows = JSON.parse(String(init?.body))
    assert.equal(rows.length, 4)
    assert.deepEqual(rows.map((row: { week_number: number }) => row.week_number), [1, 2, 3, 4])
    for (const row of rows) {
      assert.equal(row.project_id, 'project-a')
      assert.equal(row.active, false)
      assert.equal(row.is_approved, false)
    }
    return new Response(null, { status: 201 })
  })
  await seedNutritionSteps(db, { projectId: 'project-a', steps: DEFAULT_NUTRITION_TOPICS })
  assert.equal(requests, 1)
})

test('disabling the whole sequence only updates activation in the selected project', async () => {
  let requests = 0
  const db = client(async (input, init) => {
    requests++
    const url = new URL(String(input))
    assert.equal(url.pathname, '/rest/v1/nutrition_steps')
    assert.equal(url.searchParams.get('project_id'), 'eq.project-a')
    assert.equal(init?.method, 'PATCH')
    assert.deepEqual(JSON.parse(String(init?.body)), { active: false })
    return new Response(null, { status: 204 })
  })
  await disableNutritionSequence(db, 'project-a')
  assert.equal(requests, 1)
})

test('a missing project cannot trigger a bulk update', async () => {
  const db = client(async () => { assert.fail('No request should be made') })
  await assert.rejects(disableNutritionSequence(db, ''), /proyecto/)
})

test('permission failures are surfaced instead of reporting a successful pause', async () => {
  const db = client(async () => new Response(JSON.stringify({ message: 'permission denied' }), {
    status: 403, headers: { 'Content-Type': 'application/json' },
  }))
  await assert.rejects(disableNutritionSequence(db, 'project-a'), /permission denied/)
})
