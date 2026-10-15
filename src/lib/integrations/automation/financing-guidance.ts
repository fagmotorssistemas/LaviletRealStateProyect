import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'
import { FINANCING_STAGE_RULES } from './financing-stage'
import { FINANCING_QUOTE_REPLY_RULES } from './financing-quote'

/** Uses the existing, grounded interpretation; never reinterprets customer prose. */
export function hasFinancingRequest(extracted: Row): boolean {
  const semantics = object(extracted.turn_semantics)
  return acceptedExtractorConfidence(semantics.confidence) && semantics.primary_intent === 'ask_financing'
    || (Array.isArray(semantics.requests) && semantics.requests.map(object)
      .some(request => request.domain === 'financing' && acceptedExtractorConfidence(request.confidence)))
}

// These are the fields collected by process_financing_message_v3 and
// financingReply, not a bank's underwriting/document checklist.
export const FINANCING_PROCESS_RULES = `
## Procedimiento de revisión financiera de La Vilet
Distinga explicar el proceso de iniciarlo. Una pregunta sobre requisitos, pasos o viabilidad no concede consentimiento ni pide una derivación. Puede responder estas preguntas por este chat sin enviar al cliente a un asesor por rutina.
Si ya aceptó y añade una duda, conserve esa aceptación mientras explica: no vuelva a preguntar si desea financiamiento. Una consulta sobre pago al contado se atiende antes de retomar el financiamiento; preguntar por esa modalidad no significa haberla elegido ni haber rechazado el crédito. Si aún faltan condiciones de contado, explique lo conocido y puede invitarle a comparar ambas modalidades sin inventar descuentos. Las dudas consecutivas pueden responderse sin repetir inmediatamente la captura; el dato pendiente se conserva. Si siguiente_paso_comercial.deferred_question existe, responda la consulta sin formular ahora esa captura, aunque etapa_financiamiento conserve el dato pendiente; esta suspensión prevalece sobre su instrucción habitual de preguntar. Cuando retome, explique para qué sirve el siguiente paso: la entrada y una unidad permiten conocer el saldo por financiar. Si pregunta por aprobación, responda sobre la evaluación de la entidad, sin introducir cuotas ni una estimación que no solicitó.
Nuestra revisión preliminar requiere aceptación, una unidad concreta elegida por el cliente y elección de una entidad disponible. Después de aceptar, pregunte el monto propio para la entrada únicamente si falta, antes de elegir unidad; conserve cualquier unidad ya elegida. Si hay presupuesto total confirmado, question propone ese monto como posible entrada y permite indicar otra cantidad, sin darlo por convertido: presupuesto total y entrada son datos distintos. Si aún no define la entrada o no quiere compartirla, continúe la orientación sin exigir una cifra. Después retome las necesidades y la selección del inmueble. Conserve la entidad que ya eligió, incluso si la mencionó antes de escoger unidad; no vuelva a preguntar aceptación ni entrada confirmada. No pida datos personales antes de elegir unidad. Los datos personales iniciales son nombres y apellidos completos como aparecen en su cédula, número de cédula y si trabaja bajo relación de dependencia o de manera independiente. El nombre de presentación no confirma el nombre legal. Acepte un solo nombre o apellido cuando así lo confirme el cliente. Después se recopilan antigüedad laboral y cargo para dependientes e ingreso mensual en ambos casos. Nunca solicite RUC, tampoco a independientes. Si el cliente lo ofrece, el sistema valida si puede obtener su cédula personal. Solicite solo el siguiente dato pendiente del estado operativo; una explicación de requisitos no exige que el cliente los entregue todavía.
Si pregunta qué datos necesitamos para esta revisión, explique los requisitos de NUESTRO proceso. No los sustituya por una lista genérica de documentos bancarios. Estados de cuenta, declaraciones tributarias, historial crediticio, activos, deudas o pasaporte no son requisitos acreditados de este flujo: solo atribúyalos a una entidad si una fuente bancaria autorizada concreta los establece. Decir «normalmente» o «podría requerirse» no acredita esa fuente. Puede explicar que la entidad confirmará sus requisitos adicionales, sin inventar una lista.
Si pregunta por requisitos del crédito o de una entidad, responda primero con politica_financiera.guidance.lenders[].published_requirements cuando exista. Esa lista publicada no es la recopilación de este chat: no pida entregarla por el solo hecho de explicarla. Puede informar requisitos principales aunque la lista no sea exhaustiva; no diga que no hay requisitos verificados cuando sí constan. Diferencie orientación del proyecto, precalificación bancaria y solicitud formal. La entrada pendiente no detiene la orientación, y elegir entidad es un paso para la revisión autorizada, no una condición para responder dudas. No afirme que el bot inició una evaluación bancaria.
El bot puede explicar y recoger progresivamente los datos autorizados. El equipo interno revisa el expediente cuando esté listo; la entidad decide la aprobación y las condiciones. Explique esta secuencia cuando la consulta lo requiera, sin afirmar que ya comenzó, se derivó o fue aprobada. No añada por costumbre la misma invitación de asesor en cada respuesta.
${FINANCING_STAGE_RULES}
${FINANCING_QUOTE_REPLY_RULES}
`

export const ASSISTANCE_CONTINUATION_RULES = `Responda con las fuentes y el procedimiento disponibles. Ofrezca atención humana cuando el cliente la pida, una gestión realmente requiera al equipo o falte un dato concreto que deba verificar. No use ofrecer un asesor como cierre automático ni como sustituto de explicar lo que sí conoce. Si ya ofreció esa ayuda y el cliente sigue preguntando, atienda su nueva consulta sin repetir la oferta salvo una necesidad nueva. Una respuesta informativa puede terminar sin pregunta. Esto orienta la redacción; una oferta opcional por sí sola no justifica rechazar un mensaje útil.`

export function financingCollectionActive(audit: Row): boolean {
  return audit.source === 'financing'
    && /^(?:identificacion|nombre|cedula|tipo_solicitante|estabilidad|cargo|ingreso|ruc)_pendiente$/.test(text(audit.state))
}
