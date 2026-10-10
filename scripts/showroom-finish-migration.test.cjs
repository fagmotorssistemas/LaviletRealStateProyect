/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS regression tests. */
const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { pickRoomScene } = require('../src/lib/tour/roomScene')
const { pickCatalogPanoUrl } = require('../src/lib/tour/pickTourWidth')
const { buildGaleriaStills } = require('../src/lib/tour/galeriaStills')
const { PGlite } = require('@electric-sql/pglite')

test('missing finish does not borrow another finish, generic image or panorama variants', () => {
  const scene = { finish: 'acabado-1', light: 'dia', url: '/nogal.webp' }
  const scenes = [scene, { finish: null, light: 'noche', url: '/generic.webp' }]
  assert.equal(pickRoomScene(scenes, 'roble', 'dia'), undefined)
  assert.equal(pickRoomScene(scenes, 'nogal', 'noche'), scene)
  const panorama = { url: '/nogal.webp', variants: { 2048: '/wrong.webp' }, scenes }
  assert.equal(pickCatalogPanoUrl(panorama, 2048, 'roble', 'dia', { coarse: false }), null)
  assert.equal(pickCatalogPanoUrl(panorama, 2048, 'nogal', 'dia', { coarse: false }), '/nogal.webp')
  const typology = { vistas: [{ slug: 'vista-sala', label: 'Sala', url: '/nogal.webp', scenes }], rooms: [], renders: [] }
  assert.deepEqual(buildGaleriaStills(typology, [], { finish: 'roble', light: 'dia' }), [])
})

test('migration permits showroom requests and preserves every previous interaction type', async () => {
  const db = new PGlite()
  try {
    await db.exec("CREATE TABLE lead_interactions (type text CONSTRAINT lead_interactions_type_check CHECK(type IN ('llamada','whatsapp','visita','propuesta','seguimiento','email','otro')))")
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261010175103_allow_showroom_solicitud_interactions.sql'), 'utf8'))
    for (const type of ['llamada','whatsapp','visita','propuesta','seguimiento','email','otro','showroom_solicitud']) await db.query('INSERT INTO lead_interactions VALUES ($1)', [type])
    await assert.rejects(db.query('INSERT INTO lead_interactions VALUES ($1)', ['invalid']), /lead_interactions_type_check/)
    assert.equal((await db.query('SELECT count(*)::int AS count FROM lead_interactions')).rows[0].count, 8)
  } finally { await db.close() }
})
