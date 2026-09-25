import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildHomeListingCatalog,
  formatHomeListingPrice,
  homeListingImagePublicUrl,
  mapPropertyType,
  mapUnitAvailability,
  rowsToHomeListingCsv,
  type HomeListingUnitInput,
} from './homeListingCatalog'

const project = {
  id: 'project-1',
  name: 'EDIFICIO LA VILET',
  address: 'Ricardo Darquea Granda y Elena Landívar',
  city: 'Cuenca',
  country: 'Ecuador',
  latitude: -2.892287,
  longitude: -79.030259,
  neighborhood: 'Puertas del Sol',
  region: 'Azuay',
  postalCode: null as string | null,
  siteOrigin: 'https://www.lavilett.com',
  commercialImageUrl:
    'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/comerciales_lavilet.png',
}

function unit(partial: Partial<HomeListingUnitInput> & Pick<HomeListingUnitInput, 'id' | 'unit_number'>): HomeListingUnitInput {
  return {
    category: 'suite',
    status: 'disponible',
    is_published: true,
    published_commercial_price: 210000,
    bedrooms: 1,
    bathrooms: 1,
    bathrooms_full: 1,
    area_internal_m2: 67.96,
    area_total_m2: null,
    floor: 'Planta Baja',
    description: null,
    typology_code: '1A',
    parking_assigned: 1,
    project_id: 'project-1',
    ...partial,
  }
}

test('home_listing_id usa el UUID de la unidad (content_ids)', () => {
  const id = '7945f316-b72f-4b59-a15b-cf4241979f7f'
  const result = buildHomeListingCatalog({
    units: [unit({ id, unit_number: '001' })],
    project,
    typologyImages: [
      {
        typologyCode: '1A',
        fileName: 'vista-sala_roble_dia.png',
        storagePath: '1A/render/vista-sala_roble_dia.png',
        publicUrl: 'https://cdn.example/1A.png',
      },
    ],
    unitMedia: [],
  })
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].home_listing_id, id)
  assert.equal(result.rows[0].url, 'https://www.lavilett.com/tour?unidad=001')
  assert.equal(result.rows[0].virtual_tour_url, 'https://www.lavilett.com/tour?unidad=001')
  assert.equal(result.rows[0].availability, 'for_sale')
  assert.equal(result.rows[0].price, '210,000 USD')
})

test('estados Meta para vendido, reservado, preventa y retirado', () => {
  assert.equal(mapUnitAvailability('vendido', true), 'recently_sold')
  assert.equal(mapUnitAvailability('reservado', true), 'sale_pending')
  assert.equal(mapUnitAvailability('en_preventa', true), 'available_soon')
  assert.equal(mapUnitAvailability('disponible', false), 'off_market')
  assert.equal(mapUnitAvailability('deshabilitado', true), 'off_market')
})

test('excluye sin precio o sin imagen y no inventa filas de ejemplo', () => {
  const result = buildHomeListingCatalog({
    units: [
      unit({ id: 'a', unit_number: '001', published_commercial_price: null }),
      unit({ id: 'b', unit_number: '002', typology_code: 'ZZ' }),
      unit({ id: 'c', unit_number: 'LC-01', category: 'local', typology_code: null }),
    ],
    project,
    typologyImages: [],
    unitMedia: [],
  })
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].home_listing_id, 'c')
  assert.equal(result.rows[0].property_type, 'other')
  assert.match(result.rows[0]['image[0].url'], /comerciales_lavilet/)
  assert.deepEqual(
    result.excluded.map((row) => row.reason),
    ['sin_precio_comercial_publicado', 'sin_imagen_publicable:ZZ'],
  )
  assert.doesNotMatch(result.csv, /K456653443|example\.com/)
})

test('formato de precio y tipos de propiedad', () => {
  assert.equal(formatHomeListingPrice(210000), '210,000 USD')
  assert.equal(mapPropertyType('departamento'), 'apartment')
  assert.equal(mapPropertyType('bodega'), null)
})

test('webp tipología se publica vía render JPEG', () => {
  const url = homeListingImagePublicUrl(
    'https://xhjnyntywqhczdtecgim.supabase.co',
    'typology-assets',
    '2A/render/comedor_nogal_dia.webp',
    'comedor_nogal_dia.webp',
  )
  assert.match(url, /\/storage\/v1\/render\/image\/public\/typology-assets\/2A\/render\/comedor_nogal_dia\.webp/)
  assert.match(url, /width=1200/)
})

test('CSV incluye encabezados Meta y escapa comas', () => {
  const csv = rowsToHomeListingCsv([
    {
      home_listing_id: 'id-1',
      name: 'Suite 001, La Vilet',
      description: 'Texto',
      availability: 'for_sale',
      price: '210,000 USD',
      'image[0].url': 'https://cdn.example/a.png',
      'image[0].tag[0]': 'Sala',
      url: 'https://www.lavilett.com/tour?unidad=001',
      'address.addr1': 'Calle 1',
      'address.city': 'Cuenca',
      'address.region': 'Azuay',
      'address.postal_code': '',
      'address.country': 'Ecuador',
      'address.unit_number': '001',
      latitude: '-2.89',
      longitude: '-79.03',
      'neighborhood[0]': 'Puertas del Sol',
      num_baths: '1',
      num_beds: '1',
      property_type: 'apartment',
      listing_type: '',
      area_size: '67.96',
      area_unit: 'sq_m',
      parking_spaces: '1',
      home_listing_group_id: 'project-1',
      virtual_tour_url: 'https://www.lavilett.com/tour?unidad=001',
      custom_label_0: 'suite',
      custom_label_1: '1A',
    },
  ])
  assert.match(csv, /^home_listing_id,name,description,availability,price/)
  assert.match(csv, /"Suite 001, La Vilet"/)
})
