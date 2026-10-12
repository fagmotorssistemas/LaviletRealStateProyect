import { normalized } from './sdr-rules'
import { replyQuestions } from './reply-question'

/** A short acknowledgement contains no prerequisite or independent request.
 * It authorizes nothing without a verified invitation and a current answer. */
export function simpleReservationAcceptance(current: string): boolean {
  if (/[¿?]/.test(current)) return false
  const value = normalized(current)
  const acknowledgement = '(?:si|claro|bueno|correcto|perfecto|de acuerdo|por supuesto|adelante)'
  const acceptance = '(?:si|claro|correcto|perfecto|de acuerdo|por supuesto|adelante|esta bien|me parece bien|me gustaria|acepto|autorizo|hagamoslo|continuemos|sigamos|avancemos)'
  return new RegExp(`^(?:${acknowledgement} )*${acceptance}(?: (?:por favor|gracias))*$`).test(value)
}

/** Recognize the invitation actually delivered, never a remembered topic or
 * an explanation of conditions. Alternative actions require clarification. */
export function operationalReservationInvitation(reply: string): boolean {
  const questions = replyQuestions(reply)
  if (questions.length !== 1) return false
  const question = normalized(questions[0])
  const subject = /\b(?:reserva|reservar|reservamos|reservemos|separacion|separar|separamos|separemos)\b/.test(question)
  const action = /\b(?:iniciar|iniciemos|iniciamos|empezar|empecemos|continuar|continuemos|avanzar|avancemos|solicitar|solicitemos|tramitar|tramitemos|reservar|reservamos|reservemos|separar|separamos|separemos)\b/.test(question)
  const invitation = /\b(?:le gustaria|te gustaria|desea|deseas|quiere|quieres|podemos|iniciemos|iniciamos|empecemos|continuemos|avancemos|solicitemos|tramitemos|reservamos|reservemos|separamos|separemos)\b/.test(question)
  const informationOrAlternative = /\b(?:no|nunca|o|como|cuanto|requisitos|condiciones|detalles|informacion|conocer|saber|explicar|expliquemos|cancelar|anular|posponer)\b/.test(question)
  return subject && action && invitation && !informationOrAlternative
}

/** Codes explicitly named in the invitation must agree with its stored target. */
export function reservationInvitationUnitNumbers(reply: string): string[] {
  const question = normalized(replyQuestions(reply).at(-1) || '')
  return [...new Set([...question.matchAll(/\b(?:unidad|departamento|apartamento|suite|penthouse|local(?: comercial)?|el|la|del)\s*(?:numero\s*)?((?:lc\s*)?\d{1,4})(?!\d)(?!\s*(?:dormitorios?|habitaciones?|cuartos?|banos?|metros?|m2))\b/g)]
    .map(match => match[1].startsWith('lc') ? `lc-${Number(match[1].replace(/\D/g, ''))}` : String(Number(match[1]))))]
}

/** A model's operational label cannot turn gratitude or a property answer into
 * a reservation. Contextual acknowledgements use the delivered invitation. */
export function explicitReservationAction(evidence: string): boolean {
  // An infinitive needs a requesting predicate; a mention of the process or
  // its status is not an action. Informational predicates govern the following
  // verb until another direct request replaces them in the same clause.
  const requested = /\b(?:quiero|quisiera|deseo|necesito|prefiero|acepto|autorizo|solicito|pido|me gustaria|me interesa|ayud(?:a|e)(?:me|nos)|ayuden(?:me|nos))\b/g
  const informative = /\b(?:conocer|saber|entender|aprender|consultar|informarme|informarnos|informacion|explicar|expliqueme|explicame|requisitos|condiciones|como|cuanto|cuesta|costo|precio|cancelar|anular|posponer|evitar)\b/
  const infinitive = /\b(?:reservar|separar|serpar|apartar|asegurar)\b/g
  const initiation = /\b(iniciar|empezar|solicitar|tramitar|gestionar|inicie|iniciemos|empiece|empecemos|solicite|solicitemos|tramite|tramitemos|gestione|gestionemos)\s+(?:(?:la|una|mi|nuestra)\s+)?(?:solicitud\s+de\s+)?(?:reserva|separacion)\b/g
  const imperative = /\b(?:reserv(?:e|emos)|separ(?:e|emos)|serpar(?:e|emos)|apart(?:e|emos)|asegur(?:e|emos))(?:me|nos)?(?:lo|la|los|las)?\b|\b(?:reserva|separa|aparta|asegura)(?:me|nos|lo|la|los|las)\b|\b(?:reserva|separa|aparta|asegura)(?=\s+(?:el|la|este|esta|ese|esa|unidad|departamento|suite|penthouse|local|\d)\b)/g
  return evidence.split(/[.!?;\n]+/).some(rawClause => {
    // Accent normalization must not turn a completed "reservé" into the
    // imperative "reserve" (the same distinction applies to the other verbs).
    const clause = normalized(rawClause.normalize('NFC').replace(/\b(?:reserv|separ|apart|asegur)é(?=$|[\s,;.!?])/gi, 'accion_pasada'))
    const candidates = [
      ...[...clause.matchAll(infinitive)].map(match => ({ index: match.index!, imperative: false })),
      ...[...clause.matchAll(initiation)].map(match => ({ index: match.index!, imperative: !match[1].endsWith('r') })),
      ...[...clause.matchAll(imperative)].map(match => ({ index: match.index!, imperative: true })),
    ]
    return candidates.some(candidate => {
      const prefix = clause.slice(0, candidate.index)
      const request = [...prefix.matchAll(requested)].at(-1)
      const governing = request ? prefix.slice(request.index! + request[0].length) : prefix
      if (informative.test(governing)) return false
      const politeHelp = /\b(?:puede|pueden|puedes|podria|podrian|podrias)\s+(?:por favor\s+)?ayudar(?:me|nos)\b/.test(governing)
      // A finite form is imperative only in a command position. Otherwise
      // "el asesor reserva la unidad" is a statement about another actor.
      const commandOpening = /^(?:(?:si|claro|bueno|perfecto|entonces|mejor|por favor)\s*)*$/.test(prefix.trim())
      return !!request || politeHelp || candidate.imperative && commandOpening
    })
  })
}
