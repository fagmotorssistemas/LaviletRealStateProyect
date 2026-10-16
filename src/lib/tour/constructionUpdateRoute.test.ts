import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import * as auth from '@/lib/tour/amenityAccess'
import * as clients from '@/lib/supabase/admin'
import { PATCH } from '@/app/api/tour/construction-updates/[id]/route'

const id = '11111111-1111-4111-8111-111111111111'
const file = '22222222-2222-4222-8222-222222222222.webp'
const base = 'https://example.supabase.co/storage/v1/object/public/typology-assets/'
const media = [{ type: 'image', url: `${base}obra/${file}`, caption: '' }]
const body = { date: '2026-10-16', description: 'Nueva descripción', media }
const context = { params: Promise.resolve({ id }) }
const request = (value: unknown) => new Request('http://localhost/api/tour/construction-updates/' + id, { method: 'PATCH', body: JSON.stringify(value) })

test('construction update edits one existing row, preserves title and does not delete media', async t => {
  const calls: { table?: string; fields?: Record<string, unknown>; filter?: [string, string] } = {}
  const query = {
    update: (fields: Record<string, unknown>) => { calls.fields = fields; return query },
    eq: (key: string, value: string) => { calls.filter = [key, value]; return query },
    select: () => query,
    maybeSingle: async () => ({ data: { id, title: 'Título existente', ...calls.fields }, error: null }),
  }
  const client = { from: (table: string) => { calls.table = table; return query }, storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: base + path } }) }) } } as unknown as SupabaseClient
  t.mock.method(auth, 'requireConstructionEditor', async () => ({}))
  t.mock.method(clients, 'createAdminClient', () => client)
  const response = await PATCH(request({ ...body, title: 'No sobrescribir', arbitrary: true }), context)
  assert.equal(response.status, 200)
  assert.equal(calls.table, 'construction_updates')
  assert.deepEqual(calls.filter, ['id', id])
  assert.deepEqual(calls.fields, body)
  assert.equal((await response.json()).item.title, 'Título existente')
})

test('construction updates require authorization before privileged access', async t => {
  let accessed = false
  t.mock.method(clients, 'createAdminClient', () => { accessed = true; throw new Error('not allowed') })
  for (const status of [401, 403]) {
    t.mock.method(auth, 'requireConstructionEditor', async () => ({ error: NextResponse.json({ error: 'No permitido' }, { status }) }))
    assert.equal((await PATCH(request(body), context)).status, status)
  }
  assert.equal(accessed, false)
})

test('construction update rejects invalid data and non-construction storage URLs', async t => {
  let updated = false
  const client = { from: () => { updated = true; throw new Error('must not update') }, storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: base + path } }) }) } } as unknown as SupabaseClient
  t.mock.method(auth, 'requireConstructionEditor', async () => ({}))
  t.mock.method(clients, 'createAdminClient', () => client)
  assert.equal((await PATCH(request(body), { params: Promise.resolve({ id: 'invalid' }) })).status, 400)
  for (const bad of [null, { ...body, date: '2026-02-30' }, { ...body, description: 'x'.repeat(5001) }, { ...body, media: [] }, { ...body, media: Array(31).fill(media[0]) }, { ...body, media: [{ ...media[0], url: 'https://evil.example/photo.webp' }] }, { ...body, media: [null] }]) {
    assert.equal((await PATCH(request(bad), context)).status, 400)
  }
  assert.equal(updated, false)
})

test('construction update returns 404 for a missing row', async t => {
  const query = { update: () => query, eq: () => query, select: () => query, maybeSingle: async () => ({ data: null, error: null }) }
  const client = { from: () => query, storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: base + path } }) }) } } as unknown as SupabaseClient
  t.mock.method(auth, 'requireConstructionEditor', async () => ({}))
  t.mock.method(clients, 'createAdminClient', () => client)
  assert.equal((await PATCH(request(body), context)).status, 404)
})
