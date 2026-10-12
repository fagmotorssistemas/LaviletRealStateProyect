import test from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { assertPostgresText, PostgresUnicodeError, postgresSafeText, preparePostgresJson, truncateUnicode } from './postgres-json'
import { sanitizePromptSnapshot, sanitizeTraceSummary, traceText } from './trace-summary'

test('real PostgreSQL rejects NUL JSON with 22P05; prepared values and keys retain visible escapes', async () => {
  const db = new PGlite()
  try {
    const value = { reply: '10\u0000000', nested: [{ ['private\u0000key']: '360° 🏠' }] }
    await assert.rejects(db.query('SELECT $1::jsonb AS payload', [JSON.stringify(value)]),
      (error: unknown) => (error as { code?: string }).code === '22P05')
    const prepared = preparePostgresJson(value)
    assert.deepEqual(prepared.diagnostics, { sanitized_strings: 1, sanitized_keys: 1, invalid_codepoints: 2,
      paths: ['$[field#0].value', '$[field#1].value[0][field#0].key'] })
    const stored = (await db.query<{ payload: unknown }>('SELECT $1::jsonb AS payload', [JSON.stringify(prepared.value)])).rows[0].payload
    assert.deepEqual(stored, { reply: '10\\u0000000', nested: [{ ['private\\u0000key']: '360° 🏠' }] })
    assert.equal(value.reply, '10\u0000000', 'preparation does not change the caller tree')
    assert.doesNotMatch(JSON.stringify(prepared.diagnostics), /private|360|10/)
  } finally { await db.close() }
})

test('real PostgreSQL rejects isolated UTF-16 with 22P02 while prepared JSON preserves the visible unit', async () => {
  const db = new PGlite()
  try {
    for (const invalid of ['\ud800', '\udfff']) {
      const original = { text: 'before' + invalid + 'after', [invalid]: 'key' }
      await assert.rejects(db.query('SELECT $1::jsonb', [JSON.stringify(original)]),
        (error: unknown) => (error as { code?: string }).code === '22P02')
      const prepared = preparePostgresJson(original)
      assert.equal(prepared.diagnostics.invalid_codepoints, 2)
      assert.equal(prepared.diagnostics.sanitized_strings, 1)
      assert.equal(prepared.diagnostics.sanitized_keys, 1)
      await db.query('SELECT $1::jsonb', [JSON.stringify(prepared.value)])
    }
    const valid = { text: '🏠 360° café 中文', literal: '\\u0000 \\ud800', emoji_key: { ['🏠']: 'ok' } }
    const prepared = preparePostgresJson(valid)
    assert.deepEqual(prepared.value, valid)
    assert.equal(prepared.diagnostics.invalid_codepoints, 0)
    await db.query('SELECT $1::jsonb', [JSON.stringify(prepared.value)])
  } finally { await db.close() }
})

test('key collisions, cycles and unsupported data fail before a caller can perform an external effect', () => {
  let writes = 0
  const effect = (value: unknown) => { preparePostgresJson(value); writes++ }
  for (const value of [
    { ['a\u0000']: 'first', ['a\\u0000']: 'second' },
    { ['\ud800']: 'first', ['\\ud800']: 'second' },
  ]) assert.throws(() => effect(value), (error: unknown) => error instanceof PostgresUnicodeError
    && error.code === 'POSTGRES_JSON_KEY_COLLISION' && !error.message.includes('first'))
  const cycle: Record<string, unknown> = {}; cycle.self = cycle
  assert.throws(() => effect(cycle), /POSTGRES_JSON_CYCLE/)
  assert.throws(() => effect({ bigint: 1n }), /POSTGRES_JSON_UNSUPPORTED_VALUE/)
  assert.equal(writes, 0)
  const shared = { safe: true }
  assert.deepEqual(preparePostgresJson({ a: shared, b: shared }).value, { a: { safe: true }, b: { safe: true } })
})

test('customer text is rejected instead of repaired; valid emoji and literal escape text remain allowed', () => {
  for (const invalid of ['Please\u0000continue', 'before\ud800after', '\udc00']) {
    assert.throws(() => assertPostgresText(invalid), (error: unknown) => error instanceof PostgresUnicodeError
      && error.code === 'POSTGRES_INVALID_TEXT' && error.path === '$.reply')
  }
  for (const valid of ['Perfecto 🏠. ¿Cuántos dormitorios necesita?', '\\u0000']) assert.doesNotThrow(() => assertPostgresText(valid))
  assert.equal(postgresSafeText('10\u0000000').value, '10\\u0000000')
  assert.notEqual(postgresSafeText('10\u0000000').value, '10000', 'invalid separators are not silently joined')
})

test('all trace length boundaries preserve surrogate pairs and stored snapshots remain PostgreSQL-safe and private', async () => {
  assert.equal(truncateUnicode('a🏠b', 2), 'a')
  assert.equal(truncateUnicode('a🏠b', 3), 'a🏠')
  assert.equal(traceText('a'.repeat(359) + '🏠tail'), 'a'.repeat(359))
  const trace = sanitizeTraceSummary({ other_summary: 'a'.repeat(1499) + '🏠tail',
    final_text: 'a'.repeat(2999) + '🏠tail', ['x'.repeat(79) + '🏠']: 'key',
    broken: 'a\u0000b', email: 'private@example.com', authorization: 'Bearer supersecret' })
  assert.equal(String(trace.other_summary).length, 1499)
  assert.equal(String(trace.final_text).length, 2999)
  assert.ok(Object.hasOwn(trace, 'x'.repeat(79)))
  assert.equal(trace.broken, 'a\\u0000b')
  assert.doesNotMatch(JSON.stringify(trace), /private@example.com|supersecret/)
  const snapshot = sanitizePromptSnapshot({ instructions: 'a'.repeat(119999) + '🏠tail',
    data: { full_name: 'Nombre protegido' } })
  assert.equal(String(snapshot.instructions).length, 119999)
  assert.equal(snapshot.limited, true)
  assert.doesNotMatch(JSON.stringify(snapshot), /Nombre protegido/)
  const unicodeSnapshot = sanitizePromptSnapshot({ instructions: 'Conservar 360° 🏠 y \u0000 evidencia', data: { ['broken\u0000key']: '\ud800' } })
  assert.equal(preparePostgresJson(trace).diagnostics.invalid_codepoints, 0)
  assert.equal(preparePostgresJson(snapshot).diagnostics.invalid_codepoints, 0)
  assert.equal(preparePostgresJson(unicodeSnapshot).diagnostics.invalid_codepoints, 0)
  const db = new PGlite()
  try {
    for (const value of [trace, snapshot, unicodeSnapshot]) await db.query('SELECT $1::jsonb', [JSON.stringify(value)])
  } finally { await db.close() }
})
