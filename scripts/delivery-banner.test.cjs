/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(relative, mocks = {}) {
  const filename = path.join(root, relative), m = { exports: {} }, req = Module.createRequire(filename)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  new Function('require', 'module', 'exports', source)(id => id in mocks ? mocks[id] : req(id), m, m.exports)
  return m.exports
}
const incidentId = '00000000-0000-4000-8000-000000000001'
const fixture = () => ({ blocked: false, pendingMessages: 1, incidentCount: 1, incidents: [{
  id: incidentId, kommoId: 42, canResolve: false, canReconcile: true, reason: 'WORKER_INTERRUPTED', delivery: 'unknown',
}], transport: { missing: [], delayed: [], error: null, limited: false } })
function harness(role = 'admin') {
  const state = [fixture()]
  let cursor = 0
  // Execute the actual component and event callbacks with controlled hooks. No
  // effects, browser, timer, authentication service or live fetch is started.
  const hooks = { useState(initial) {
    const index = cursor++
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
    return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
  }, useEffect() {}, useCallback: callback => callback }
  const { AutomationDeliveryBanner } = load('src/components/layout/AutomationDeliveryBanner.tsx', {
    react: hooks,
    '@/contexts/AuthContext': { useAuth: () => ({ profile: { role } }) },
    '@/lib/inmobiliaria/roleAccess': load('src/lib/inmobiliaria/roleAccess.ts'),
    '@/lib/inmobiliaria/automationErrors': { reservationServiceError: () => '' },
  })
  const render = () => { cursor = 0; return AutomationDeliveryBanner() }
  return { state, render }
}
function all(tree, type) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(child => all(child, type))
  return [...(tree.type === type ? [tree] : []), ...all(tree.props?.children, type)]
}
function words(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(words).join('')
  return tree && typeof tree === 'object' ? words(tree.props?.children) : ''
}
const button = (tree, label) => all(tree, 'button').find(node => words(node).includes(label))
function openReview(h) {
  button(h.render(), 'Comprobar este envío').props.onClick()
  return h.render()
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('delivery review is visible only to administrators; advisor can read the same incident', () => {
  const advisor = harness('asesor'), admin = harness('admin'), denied = harness('visitante')
  assert.ok(advisor.render())
  assert.equal(button(advisor.render(), 'Comprobar este envío'), undefined)
  advisor.state[3] = incidentId
  assert.equal(all(advisor.render(), 'form').length, 0)
  assert.equal(denied.render(), null)
  assert.ok(button(admin.render(), 'Comprobar este envío'))
  assert.equal(all(openReview(admin), 'form').length, 1)
})

test('review form requires attestation, reference and an ID for a confirmed send', () => {
  const h = harness()
  let tree = openReview(h)
  assert.equal(button(tree, 'Guardar comprobación').props.disabled, true)
  const textarea = all(tree, 'textarea')[0]
  assert.equal(textarea.props.required, true)
  assert.equal(textarea.props.minLength, 10)
  textarea.props.onChange({ target: { value: 'Historial revisado en Kommo' } })
  assert.equal(button(h.render(), 'Guardar comprobación').props.disabled, true)
  all(h.render(), 'input').find(node => node.props.type === 'checkbox').props.onChange({ target: { checked: true } })
  assert.equal(button(h.render(), 'Guardar comprobación').props.disabled, false)
  all(h.render(), 'select')[0].props.onChange({ target: { value: 'sent' } })
  tree = h.render()
  assert.equal(h.state[7], false, 'changing the outcome invalidates the previous attestation')
  const provider = all(tree, 'input').find(node => node.props.type !== 'checkbox')
  assert.equal(provider.props.required, true)
  assert.equal(provider.props.maxLength, 200)
  all(tree, 'input').find(node => node.props.type === 'checkbox').props.onChange({ target: { checked: true } })
  assert.equal(button(h.render(), 'Guardar comprobación').props.disabled, true)
  provider.props.onChange({ target: { value: 'message-42' } })
  assert.equal(button(h.render(), 'Guardar comprobación').props.disabled, false)
  assert.match(words(all(h.render(), 'form')[0]), /no vuelve a enviar ese mensaje/)
})

test('confirmed review posts only the evidence contract and closes the form after success', async t => {
  const requests = []
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push([url, options]); return { ok: true, json: async () => fixture() }
  })
  const h = harness()
  openReview(h)
  h.state[4] = 'sent'; h.state[5] = '  provider-42  '; h.state[6] = '  Revisado destinatario, contenido y hora  '; h.state[7] = true
  all(h.render(), 'form')[0].props.onSubmit({ preventDefault() {} })
  assert.equal(h.state[2], true)
  await settle()
  assert.equal(requests.length, 1)
  assert.equal(requests[0][0], '/api/integrations/delivery')
  assert.deepEqual(JSON.parse(requests[0][1].body), { action: 'reconcile_incident', id: incidentId,
    outcome: 'sent', reviewed: true, providerMessageId: 'provider-42', reviewReference: 'Revisado destinatario, contenido y hora' })
  assert.equal(h.state[2], false)
  assert.equal(h.state[3], null)
  assert.equal(all(h.render(), 'form').length, 0)
})

test('not-sent review does not post a stale provider ID and preserves the form if rejected', async t => {
  const requests = []
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push([url, options]); return { ok: false, json: async () => ({ error: 'DELIVERY_EVIDENCE_REQUIRED' }) }
  })
  const h = harness()
  openReview(h)
  h.state[5] = 'stale-provider'; h.state[6] = ' Historial y hora comprobados '; h.state[7] = true
  all(h.render(), 'form')[0].props.onSubmit({ preventDefault() {} })
  await settle()
  assert.deepEqual(JSON.parse(requests[0][1].body), { action: 'reconcile_incident', id: incidentId,
    outcome: 'not_sent', reviewed: true, reviewReference: 'Historial y hora comprobados' })
  assert.equal(h.state[1], 'DELIVERY_EVIDENCE_REQUIRED')
  assert.equal(h.state[3], incidentId)
  assert.equal(h.state[2], false)
  assert.equal(all(h.render(), 'form').length, 1)
})
