import { currentGuidanceSource, type FinancingLenderTerms } from '@/lib/inmobiliaria/financingGuidance'

/** Published product requirements, separate from the project's intake fields.
 * A URL in a lender's terms is not a retrieval of that page's contents. */
const references = {
  pichincha: {
    source: 'https://www.pichincha.com/detalle-producto/personas-credito-hipotecario-de-vivienda',
    checkedOn: '2026-10-15', reviewBy: '2026-11-15',
    basic: ['Solicitud completa y firmada.', 'Cédula de identidad y papeleta de votación.',
      'Respaldo de ingresos y declaración del impuesto a la renta según el perfil del solicitante.'],
    by_profile: {
      dependent: ['Último rol de pagos y certificado de ingresos actualizado con tiempo de trabajo y cargo.'],
      independent: ['Registro tributario y declaraciones de IVA según las condiciones publicadas del producto.'],
    },
    additional: ['Documentos de bienes o ingresos adicionales cuando corresponda.'],
    eligibility: 'La entidad evalúa ingresos comprobables, estabilidad y antecedentes crediticios; esta lista no confirma elegibilidad.',
  },
  jep: {
    source: 'https://www.jep.coop/productos-servicios/creditos/credimivivienda',
    checkedOn: '2026-10-15', reviewBy: '2026-11-15',
    basic: ['Ser socio de la Cooperativa JEP.', 'Cédula de identidad.',
      'Documentos que justifiquen los ingresos, como roles, certificados de trabajo o declaraciones tributarias.',
      'Documentación del inmueble a hipotecar: predio, escrituras y certificado del registro de la propiedad.'],
    by_profile: {}, additional: [],
    eligibility: 'CrediMIVIVIENDA está publicado para primera vivienda; no se presume que aplica a inversión o segunda vivienda.',
  },
} as const

export function publishedFinancingRequirements(lender: FinancingLenderTerms, today?: string) {
  const reference = references[lender.id]
  // Never attach one product's documents to custom terms, paused rules or an
  // unrelated lender page. Expiration is independent of the rate's review date.
  const sources = lender.source.split(/\s+/)
  const expectedProduct = lender.id === 'jep' ? 'CrediMIVIVIENDA' : 'Crédito hipotecario de vivienda'
  if (!lender.enabled || lender.product !== expectedProduct || !sources.includes(reference.source)
    || !currentGuidanceSource(reference, today)) return null
  return { ...reference, kind: 'published_lender_requirements', exhaustive: false,
    instruction: 'Explique los requisitos principales publicados que respondan a la consulta, con su entidad y producto. Distinga informarlos de pedir al cliente que los entregue. La recopilación de este chat sigue financing_collection; una lista bancaria no autoriza pedir documentos, RUC ni datos adicionales. La entidad confirma la lista aplicable al perfil y la aprobación. No imponga elegir entidad antes de explicar las alternativas.' }
}
