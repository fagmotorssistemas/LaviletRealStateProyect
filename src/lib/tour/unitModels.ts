/** Models reviewed against the published inventory; never infer another floor's geometry. */
export const UNIT_MODEL_PATH = '/tour/modelo-3d/segunda-planta.html'
export const UNIT_MODEL_ORIGIN = 'https://www.lavilett.com'
export const UNIT_MODELS = [
  { number: '201', id: 'a88ce32b-4f7d-4dbd-8c3d-bfcd7b8ac485' },
  { number: '202', id: 'af29eae0-658d-432a-9ea0-eba48deb89ce' },
  { number: '203', id: '5f592068-3fa6-4ea7-8865-228c326d536a' },
  { number: '204', id: 'a6ca40db-ab05-4ac9-8141-50018a9e7915' },
  { number: '205', id: '5622b22c-b929-4fa9-9b75-50d629aeac5f' },
  { number: '206', id: 'c1c6cd6a-b898-4351-ace1-c06b0fd82c3f' },
  { number: '207', id: '795da15a-08f0-4898-96fc-35b47e9ed7df' },
  { number: '208', id: 'a974716f-fd87-4cd7-aaa7-a7793a33fb3b' },
  { number: '209', id: '34cef07d-448f-4109-9a31-3d1f5a349f7e' },
  { number: '210', id: 'cb053324-daa5-4188-9b3c-01ae77f144aa' },
  { number: '211', id: 'b2b8e02e-b3c1-47d0-a1d0-693f2e5359f8' },
] as const

export function unitModelUrl(unit: Record<string, unknown>) {
  const model = UNIT_MODELS.find(m => m.id === unit.id && m.number === unit.unit_number)
  if (!model || !['suite', 'departamento'].includes(String(unit.category))
    || unit.is_published === false || (unit.status && unit.status !== 'disponible')) return null
  return `${UNIT_MODEL_ORIGIN}${UNIT_MODEL_PATH}?unidad=${model.number}`
}
