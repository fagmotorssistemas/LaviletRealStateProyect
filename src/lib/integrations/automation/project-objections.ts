import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'

export const PROJECT_OBJECTION_CONTEXT_VERSION = 'project-objections-v1'
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const normalize = (value: string) => value.normalize('NFKC').toLowerCase()
const literal = (evidence: unknown, source: string) => !!text(evidence).trim()
  && normalize(source).includes(normalize(text(evidence).trim()))
const identity = (request: Row) => JSON.stringify([text(request.request), text(request.evidence),
  request.source === 'pending' ? text(request.source_message_id) : 'current'])

/** Interpretation belongs to the extractor. Admission requires a typed topic
 * and literal current proof, or a shared pending request tied to its message. */
export function projectObjectionRequests(info: Row, current: string): Row[] {
  const shared = rows(object(info.contrato_turno).requests)
  const interpreted = rows(info.solicitudes_interpretadas || object(info.semantica_turno).requests)
    .filter(request => request.source !== 'pending')
  const pending = rows(info.consultas_pendientes).filter(message => message.answered !== true
    && !['answered', 'resolved', 'cancelled', 'superseded'].includes(text(message.status)))
  const seen = new Set<string>()
  return [...shared, ...interpreted].filter(request => {
    if (request.domain !== 'property' || !acceptedExtractorConfidence(request.confidence)
      || !Array.isArray(request.topics) || !request.topics.includes('value_objection')) return false
    const grounded = request.source === 'pending'
      ? !!text(request.source_message_id) && pending.some(message =>
        request.source_message_id === (message.message_id || message.id)
        && literal(request.evidence, text(message.content)))
      : (!request.source || request.source === 'current') && literal(request.evidence, current)
    const key = identity(request)
    if (!grounded || seen.has(key)) return false
    seen.add(key)
    return true
  }).map(request => ({ domain: 'property', topics: [...request.topics as unknown[]],
    request: text(request.request), evidence: text(request.evidence), confidence: request.confidence,
    source: request.source === 'pending' ? 'pending' : 'current',
    ...(request.source === 'pending' ? { source_message_id: request.source_message_id } : {}) }))
}

/** The owner's approved project concept is factual authority. Guidance is
 * deliberately separate and cannot certify additional benefits or policies.
 * Canonical amenities, policies and location facts stay in their own blocks;
 * copying them here would bypass the normal per-turn disclosure projection. */
export function withProjectObjectionContext(info: Row, current: string): Row {
  const result = { ...info }
  delete result.objeciones_proyecto
  const requests = projectObjectionRequests(result, current)
  if (!requests.length) return result
  result.objeciones_proyecto = {
    version: PROJECT_OBJECTION_CONTEXT_VERSION,
    requests,
    project_facts: {
      subject: 'project',
      source: 'Concepto comercial aprobado por el responsable del proyecto en la conversación del 15 de octubre de 2026',
      concept: 'El proyecto combina viviendas y espacios comerciales.',
      commercial_floors: 2,
      commercial_offer_status: 'Propuesta de reunir distintos productos y servicios; no acredita negocios u operadores confirmados.',
    },
    guidance: {
      objective: 'Atender la preocupación del lead y explicar la utilidad de atributos documentados para su objetivo, sin discutir ni presionarlo.',
      value: 'Una objeción de precio o valor no solicita necesariamente la fórmula de fijación del precio. Puede explicar el concepto aprobado y atributos pertinentes sin conocer una fórmula contable. No enumere precios, unidades o superficies por rutina.',
      location: 'Si la objeción trata la ubicación, relacione hechos aprobados del entorno con las necesidades de desplazamiento declaradas. Puede preguntar qué destino le preocupa; no invente minutos, distancias ni conveniencia universal.',
      security: 'Si plantea inseguridad, reconozca la preocupación y explique únicamente medidas documentadas del edificio. No confunda esas medidas con estadísticas o garantías de seguridad del barrio.',
      comparison: 'Compare características y condiciones equivalentes cuando existan datos de ambas ofertas. Lo dicho por el lead sobre otro proyecto es una oferta reportada, no una verificación de la competencia. No invente diferencias ni superioridad.',
      investment: 'Relacione el espacio comercial con distribución, ubicación y usos expresamente aprobados. La propuesta de actividad comercial no prueba afluencia, ocupación, rentabilidad, rentas ni permisos para una actividad concreta.',
      construction: 'Si cuestiona la etapa de obra, use estado_proyecto y entrega_proyecto vigentes. Distinga renders de espacios terminados; no prometa plazos, permisos ni acceso físico sin respaldo.',
      continuation: 'Una continuación debe ayudar a resolver esta inquietud. No retome presupuesto, crédito, reserva o cita por el solo hecho de que aparezca una objeción; conserve las decisiones y el modo informativo vigentes.',
    },
    limits: [
      'La propuesta comercial no acredita variedad ya operativa ni que el residente pueda resolver todas sus actividades dentro del proyecto.',
      'No existe respaldo en este bloque para afirmar exclusividad de mercado, liderazgo, ausencia de riesgos ni valorización garantizada.',
      'Las fuentes canónicas y response_content_scope siguen determinando qué hechos y cifras pueden comunicarse en este turno. Este bloque no autoriza precios, dirección exacta ni orientación financiera.',
      'No convierta una explicación de valor en una causa contable del precio. Si solicita esa causa concreta y no consta, distinga la explicación pendiente de los atributos que sí puede explicar.',
    ],
  }
  return result
}

export const PROJECT_OBJECTION_WRITER_RULES = `OBJECIONES Y VALOR DEL PROYECTO:
Cuando exista objeciones_proyecto, atienda las inquietudes identificadas en sus requests con redacción libre. Sus project_facts son hechos del concepto aprobado; guidance orienta la respuesta, pero no demuestra nuevos hechos. Responda primero la preocupación y conecte solo atributos canónicos pertinentes con el objetivo del lead. Puede explicar la propuesta de viviendas y comercio en dos plantas comerciales sin afirmar negocios confirmados, disponibilidad de todos los servicios, exclusividad en la zona o resultados de inversión.
Una duda como «por qué tan caro» no obliga a disculparse por desconocer la metodología del precio, repetir un rango de precios ni ofrecer crédito. Si pregunta expresamente por cómo se calculó, no invente una fórmula: aclare lo pendiente y explique lo que sí está respaldado. Evite respuestas defensivas o discutir la experiencia del lead; una pregunta útil puede ayudar a precisar su preocupación y no es obligatoria en cada mensaje.
Para ubicación, seguridad, comparación, renta o avance de obra, use únicamente las fuentes vigentes del tema efectivamente planteado. Las fuentes ausentes no prueban que un beneficio o permiso exista o no exista. Respete response_content_scope, el alcance residencial o comercial, el modo informativo y las decisiones operativas; la objeción no crea presupuesto, consentimiento financiero ni obligación de reserva o cita. No copie este bloque como mensaje ni enumere todos sus argumentos.`
