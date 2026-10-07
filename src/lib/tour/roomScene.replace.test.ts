import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRoomScenes, parseRoomSceneFileName, fileMatchesScene } from './roomScene'
import { pickCatalogPanoUrl } from './pickTourWidth'

test('revision suffix does not change the scene identity', () => {
  const parsed = parseRoomSceneFileName('sala_nogal_dia-r171000.webp')
  assert.equal(parsed?.room, 'sala')
  assert.equal(parsed?.finish, 'nogal')
  assert.equal(parsed?.light, 'dia')
  assert.equal(parsed?.width, null)
  const hi = parseRoomSceneFileName('sala_nogal_dia_8192-r171000.webp')
  assert.equal(hi?.width, 8192)
  assert.equal(hi?.light, 'dia')
})

test('acabado 1 and nogal are the same slot, and the newer file wins', () => {
  const scenes = buildRoomScenes(
    [
      {
        file_name: 'sala_nogal_dia.webp',
        url: 'https://cdn.test/old.webp?v=2020-01-01T00:00:00.000Z',
      },
      {
        file_name: 'sala_acabado-1_dia-r20.jpg',
        url: 'https://cdn.test/new.jpg?v=2026-01-01T00:00:00.000Z',
      },
      {
        file_name: 'sala_nogal_dia_8192.webp',
        url: 'https://cdn.test/old-hi.webp?v=2020-01-01T00:00:00.000Z',
      },
    ],
    'sala',
  )
  assert.equal(scenes.length, 1)
  assert.match(scenes[0]!.url, /new\.jpg/)
  assert.equal(scenes[0]!.widths?.['8192'], undefined)
  assert.equal(
    fileMatchesScene('sala_nogal_dia.webp', 'sala', 'acabado-1', 'dia', { exactRoom: true }),
    true,
  )
  assert.equal(
    fileMatchesScene('vista-sala_nogal_dia.webp', 'sala', 'nogal', 'dia', { exactRoom: true }),
    false,
  )
})

test('an older 8k variant does not hide the replaced panorama', () => {
  const url = pickCatalogPanoUrl(
    {
      url: 'https://cdn.test/sala_nogal_dia-r200.webp?v=2020-01-01T00:00:00.000Z',
      variants: { '8192': 'https://cdn.test/sala_nogal_dia_8192-r100.webp?v=2026-01-02T00:00:00.000Z' },
      scenes: [
        {
          finish: 'nogal',
          light: 'dia',
          url: 'https://cdn.test/sala_nogal_dia-r200.webp?v=2020-01-01T00:00:00.000Z',
          widths: { '8192': 'https://cdn.test/sala_nogal_dia_8192-r100.webp?v=2026-01-02T00:00:00.000Z' },
        },
      ],
    },
    8192,
    'acabado-1',
    'dia',
  )
  assert.match(url ?? '', /-r200\.webp/)
  assert.doesNotMatch(url ?? '', /_8192/)
})

test('the same filename revision keeps a variant even when created_at is older', () => {
  const url = pickCatalogPanoUrl(
    {
      url: 'https://cdn.test/sala_dia-r200.webp?v=2026-06-01T00:00:00.000Z',
      scenes: [
        {
          finish: null,
          light: 'dia',
          url: 'https://cdn.test/sala_dia-r200.webp?v=2026-06-01T00:00:00.000Z',
          widths: {
            '4096': 'https://cdn.test/sala_dia_4096-r200.webp?v=2020-01-01T00:00:00.000Z',
          },
        },
      ],
    },
    8192,
  )
  assert.match(url ?? '', /_4096-r200/)
})

test('a coarse pointer never receives an 8192 file', () => {
  const shared = pickCatalogPanoUrl(
    {
      url: 'https://proj.supabase.co/storage/v1/object/public/tour/sala_dia-r9.webp',
      scenes: [
        {
          finish: null,
          light: 'dia',
          url: 'https://proj.supabase.co/storage/v1/object/public/tour/sala_dia-r9.webp',
          widths: {
            '8192': 'https://proj.supabase.co/storage/v1/object/public/tour/sala_dia_8192-r9.webp',
            '4096': 'https://proj.supabase.co/storage/v1/object/public/tour/sala_dia_4096-r9.webp',
          },
        },
      ],
    },
    8192,
    null,
    'dia',
    { coarse: true },
  )
  assert.match(shared ?? '', /_4096-r9/)
  const transformed = pickCatalogPanoUrl(
    {
      url: 'https://proj.supabase.co/storage/v1/object/public/tour/sala_dia-r9.webp',
      scenes: [
        {
          finish: null,
          light: 'dia',
          url: 'https://proj.supabase.co/storage/v1/object/public/tour/sala_dia-r9.webp',
          widths: {
            '8192': 'https://proj.supabase.co/storage/v1/object/public/tour/sala_dia_8192-r9.webp',
          },
        },
      ],
    },
    8192,
    null,
    'dia',
    { coarse: true },
  )
  assert.match(transformed ?? '', /\/render\/image\/public\//)
  assert.match(transformed ?? '', /width=2048/)
  assert.doesNotMatch(transformed ?? '', /_8192/)
  const missing = pickCatalogPanoUrl(
    {
      url: 'https://cdn.test/sala_dia-r9.webp',
      scenes: [
        {
          finish: null,
          light: 'dia',
          url: 'https://cdn.test/sala_dia-r9.webp',
          widths: { '8192': 'https://cdn.test/sala_dia_8192-r9.webp' },
        },
      ],
    },
    8192,
    null,
    'dia',
    { coarse: true },
  )
  assert.equal(missing, null)
})
