/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic authentication only: no accounts, credentials or external requests.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
require('./test-typescript.cjs')
const { loginDestination, LOGIN_RETRY_MESSAGE, LOGIN_TRANSPORT_MESSAGE } = require('../src/lib/auth/login-result.ts')
const { submitLogin } = require('../src/lib/auth/submit-login.ts')
const { UnrecognizedActionError } = require('next/dist/client/components/unrecognized-action-error')
const noRefresh = () => assert.fail('Only an unrecognized action can refresh the form')

function compile(file, mocks) {
  const fixture = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'module', 'exports', code)(id => {
    assert.ok(id in mocks, `Unexpected import: ${id}`)
    return mocks[id]
  }, fixture, fixture.exports)
  return fixture.exports
}

function harness(options = {}) {
  const calls = [], diagnostics = []
  const user = { id: 'synthetic-user', app_metadata: options.metadata ?? {} }
  const client = {
    auth: {
      async signInWithPassword(input) {
        calls.push(['password', input])
        if (options.authThrows) throw new TypeError('private auth detail')
        return { data: { user: options.missingUser ? null : user, session: options.missingSession ? null : { user } }, error: options.authError ?? null }
      },
      async getUser() { assert.fail('Password response already contains the verified user') },
      async signOut(scope) {
        calls.push(['signOut', scope])
        if (options.cleanupThrows) throw new Error('private cleanup detail')
        return { error: null }
      },
    },
    from(table) {
      assert.equal(table, 'profiles')
      const q = {
        select(columns) { assert.equal(columns, 'role, is_active'); return q },
        eq(column, id) { assert.equal(column, 'id'); assert.equal(id, user.id); return q },
        abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return q },
        async maybeSingle() {
          calls.push(['profile'])
          if (options.profileThrows) throw new Error('private profile detail')
          return { data: options.noProfile ? null : { role: options.role ?? 'admin', is_active: options.active ?? true }, error: options.profileError ?? null }
        },
      }
      return q
    },
  }
  const { login } = compile('src/app/(auth)/login/actions.ts', {
    '@/lib/auth/accessPending': require('../src/lib/auth/accessPending.ts'),
    '@/lib/auth/login-result': require('../src/lib/auth/login-result.ts'),
    '@/lib/inmobiliaria/roleAccess': require('../src/lib/inmobiliaria/roleAccess.ts'),
    '@/lib/supabase/admin': { tryCreateAdminClient(config) { assert.equal(config.requestTimeoutMs, 8000); return options.admin ? client : null } },
    '@/lib/supabase/server': { async createClient(config) { assert.equal(config.requestTimeoutMs, 12000); return client } },
  })
  const data = new FormData()
  data.set('email', ' synthetic@example.test ')
  data.set('password', 'synthetic-password')
  const run = async () => {
    const previous = console.error
    console.error = (...args) => diagnostics.push(args)
    try { return await login(null, data) }
    finally { console.error = previous }
  }
  return { run, calls, data, diagnostics }
}

test('successful password authentication returns one destination without a duplicate user or profile lookup', async () => {
  for (const admin of [false, true]) {
    const h = harness({ admin })
    assert.deepEqual(await h.run(), { destination: '/inmobiliaria/inventario' })
    assert.deepEqual(h.calls.map(x => x[0]), ['password', 'profile'])
    assert.equal(h.calls[0][1].email, 'synthetic@example.test')
  }
})

test('invalid credentials, unconfirmed email and rate limits stay in the form without profile queries', async () => {
  for (const [authError, expected] of [
    [{ code: 'invalid_credentials' }, 'Correo o contraseña incorrectos'],
    [{ message: 'Invalid login credentials' }, 'Correo o contraseña incorrectos'],
    [{ code: 'email_not_confirmed' }, 'Confirma tu correo antes de ingresar'],
    [{ status: 429 }, 'Demasiados intentos. Espera un momento e inténtalo de nuevo'],
    [{ message: 'private provider response' }, LOGIN_RETRY_MESSAGE],
  ]) {
    const h = harness({ authError })
    assert.deepEqual(await h.run(), { error: expected })
    assert.deepEqual(h.calls.map(x => x[0]), ['password'])
  }
})

test('missing credentials never call authentication', async () => {
  const h = harness(); h.data.delete('password')
  assert.deepEqual(await h.run(), { error: 'Ingresa tu correo y contraseña' })
  assert.equal(h.calls.length, 0)
})

test('a thrown authentication request returns a controlled error without private diagnostic data', async () => {
  const h = harness({ authThrows: true })
  assert.deepEqual(await h.run(), { error: LOGIN_RETRY_MESSAGE })
  assert.doesNotMatch(JSON.stringify(h.diagnostics), /private|example|password/i)
})

test('missing sessions and failed profile checks never return a destination and clear only this login session', async () => {
  for (const options of [{ missingUser: true }, { missingSession: true }, { profileThrows: true }, { profileError: { message: 'private DB detail' } }, { profileThrows: true, cleanupThrows: true }]) {
    const h = harness(options)
    assert.deepEqual(await h.run(), { error: LOGIN_RETRY_MESSAGE })
    assert.deepEqual(h.calls.at(-1), ['signOut', { scope: 'local' }])
    assert.doesNotMatch(JSON.stringify(h.diagnostics), /private|example|password/i)
  }
})

test('inactive accounts do not enter the CRM and unknown roles do not gain CRM permissions', async () => {
  const inactive = harness({ active: false })
  assert.match((await inactive.run()).error, /desactivada/)
  assert.deepEqual(inactive.calls.at(-1), ['signOut', { scope: 'local' }])
  assert.deepEqual(await harness({ role: 'unrecognized' }).run(), { destination: '/cuenta' })
  assert.deepEqual(await harness({ noProfile: true }).run(), { destination: '/cuenta' })
})

test('pending approval wins over next and trusted CRM assignments retain their route restrictions', async () => {
  const pending = harness({ metadata: { access_pending: true } })
  pending.data.set('next', '/inmobiliaria/inventario')
  assert.deepEqual(await pending.run(), { destination: '/acceso-pendiente' })
  const restricted = harness({ role: 'asesor', metadata: { crm_paths: ['/inmobiliaria/leads'] } })
  restricted.data.set('next', '/inmobiliaria/usuarios')
  assert.deepEqual(await restricted.run(), { destination: '/inmobiliaria/leads' })
})

test('next preserves allowed query/hash and rejects external URLs, normalized permission bypasses and auth loops', () => {
  assert.equal(loginDestination('/tour?unidad=302#detalle', 'asesor', null, false), '/tour?unidad=302#detalle')
  assert.equal(loginDestination('/inmobiliaria/leads?view=board', 'asesor', null, false), '/inmobiliaria/leads?view=board')
  for (const next of ['https://other.test', '//other.test', '/\\other.test', '/\t/other.test', '/login', '/login?next=/login', '/register', '/acceso-pendiente', '/inmobiliaria/leads/../usuarios']) {
    assert.equal(loginDestination(next, 'asesor', null, false), '/inmobiliaria/inventario', next)
  }
})

test('successful client submission starts one document navigation and never resubmits credentials', async () => {
  const navigations = [], data = new FormData(); let calls = 0
  const result = await submitLogin(async () => { calls++; return { destination: '/inmobiliaria/leads' } }, null, data, url => navigations.push(url), noRefresh)
  assert.deepEqual(result, { destination: '/inmobiliaria/leads' })
  assert.equal(calls, 1); assert.deepEqual(navigations, ['/inmobiliaria/leads'])
})

test('client transport and navigation failures are contained without refreshing or automatic login retries', async () => {
  let calls = 0
  const result = await submitLogin(async () => { calls++; throw new TypeError('private transport detail') }, null, new FormData(), () => assert.fail('No destination on error'), noRefresh)
  assert.deepEqual(result, { error: LOGIN_TRANSPORT_MESSAGE }); assert.equal(calls, 1)
  assert.deepEqual(await submitLogin(async () => ({ error: 'Incorrecto' }), null, new FormData(), () => assert.fail('No navigation'), noRefresh), { error: 'Incorrecto' })
  assert.deepEqual(await submitLogin(async () => ({ destination: '/cuenta' }), null, new FormData(), () => { throw new Error('Navigation unavailable') }, noRefresh), { error: LOGIN_TRANSPORT_MESSAGE })
})

test('an action retired by a deployment refreshes the form once and never resubmits or preserves credentials', async () => {
  let calls = 0, refreshes = 0
  const result = await submitLogin(async () => { calls++; throw new UnrecognizedActionError('Synthetic retired action') }, null, new FormData(), () => assert.fail('No authenticated destination'), () => { refreshes++ })
  assert.equal(calls, 1); assert.equal(refreshes, 1); assert.match(result.error, /Actualizando/)
  assert.deepEqual(await submitLogin(async () => { throw new UnrecognizedActionError('Synthetic retired action') }, null, new FormData(), () => assert.fail('No navigation'), () => { throw new Error('Refresh blocked') }), { error: LOGIN_TRANSPORT_MESSAGE })
})

test('server client deadlines are opt-in and preserve cookie options for login sessions', async () => {
  const configs = [], cookieWrites = [], store = { getAll: () => [], set: (...args) => cookieWrites.push(args) }
  const { createClient } = compile('src/lib/supabase/server.ts', {
    '@supabase/ssr': { createServerClient(_url, _key, config) { configs.push(config); return {} } },
    'next/headers': { cookies: async () => store },
    './request': { fetchWithTimeout: (_input, _init, ms) => ms },
  })
  await createClient()
  assert.equal(configs[0].global, undefined)
  await createClient({ requestTimeoutMs: 12000 })
  assert.equal(await configs[1].global.fetch('https://synthetic.invalid'), 12000)
  configs[1].cookies.setAll([{ name: 'synthetic-cookie', value: 'synthetic-value', options: { httpOnly: true, sameSite: 'lax' } }])
  assert.deepEqual(cookieWrites, [['synthetic-cookie', 'synthetic-value', { httpOnly: true, sameSite: 'lax' }]])
})
