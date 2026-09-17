const normalize = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const words = (v: string) => normalize(v).split(/[^a-z]+/).filter(w => w.length > 2 && !['para','por','que','una','uno','los','las','del','con','sus','mis','quiero','quisiera','interesa','interesante','deseo','busco','comercial'].includes(w)).map(w=>w.replace(/(?:es|s)$/,''))

/** Remove only redundant framing; never rewrite facts, questions or operational notices. */
export function directReply(reply: string, current: string): string {
  let result=reply.trim()
  const echo=result.match(/^((?:(?:Hola|Buenos días|Buenas tardes|Buenas noches)(?:,\s*[\p{L}-]+)?[.!]\s*)?)(?:Comprendo|Entiendo|Veo|Noto) que (?:le interesa|desea|quiere|busca) ([^.!?]+)\.\s+([\s\S]+)$/iu)
  if(echo) {
    const clause=echo[2], tokens=words(clause), source=new Set(words(current))
    // Compound statements, constraints, dates, identifiers and links can carry useful information.
    const protectedContent=/\d|https?:|[,;:]|\b(?:no|sin|pero|aunque|porque|si|solo|solamente|confirmad\w*|registrad\w*)\b/i.test(normalize(clause))
    if(!protectedContent && tokens.length>0 && tokens.every(w=>source.has(w))) result=echo[1]+echo[3]
  }
  result=result.replace(/\s+As[ií] (?:puedo orientarle mejor seg[uú]n sus planes|le oriento con lo que m[aá]s se ajuste a lo que busca|puedo orientarle mejor|podemos ayudarle mejor|podr[eé] orientarle mejor)[.!]?\s*$/iu,'')
  return result.trim() || reply
}

export const DIRECT_REPLY_RULE = '\nEn todos los modos, responda a la necesidad sin repetirla como introducción: evite «Comprendo que le interesa…», «Veo que desea…» o «Entiendo que busca…» cuando solo reformulan el mensaje anterior. La calidez se expresa mediante trato respetuoso y ayuda concreta; reconozca expresamente una preocupación o dificultad real cuando sea útil. No agregue cierres que expliquen su intención, como «Así puedo orientarle mejor según sus planes». El detalle amplía datos, diferencias o pasos relevantes, no saludos, introducciones ni justificaciones de preguntas. Conserve confirmaciones necesarias, condiciones, negaciones, fechas, enlaces y respuestas a todas las consultas. El revisor debe corregir el eco del cliente, no sustituirlo por un sinónimo.\n'
