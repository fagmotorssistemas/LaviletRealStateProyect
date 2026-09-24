export function normalizeVoiceText(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim()
}

/** Preguntar sobre una opción no equivale a pedir que se abra. */
export function isVoiceQuestion(value: string): boolean {
  if (/\b(compare|difference|which|what|how|why|can you|could you|does it|do you|recommend|bigger than|cheaper than)\b/.test(normalizeVoiceText(value))) return true
  if (/\bmas (ampli\w*|barat\w*|grande|pequen\w*) que\b|\bpara (vivir|mi familia|mis hijos|invertir|alquilar)\b/.test(normalizeVoiceText(value))) return true
  return /[¿?]|\b(compar\w*|diferenci\w*|versus|vs|cual|cuanto\w*|como|por que|que tal|que tiene|que incluye|que ofrece|que me|tiene|tienen|puedo|conviene|recomiend\w*|explica\w*|ayuda\w*|no entiendo|no me alcanza|me preocupa|vale la pena|no quiero dejar|no quiero dar)\b|^(y\s+)?(el |la |los |las )?(precio|vista|distribucion|financiacion|acabados)\b/.test(normalizeVoiceText(value))
}

export function isVoiceComparison(value: string): boolean {
  if (/\b(compare|difference|versus)\b|\bwhich.*\b(better|bigger|cheaper|larger|best)\b/.test(normalizeVoiceText(value))) return true
  return /\b(compar\w*|diferenci\w*|versus|vs)\b|\b(cual|que opcion).*\b(mejor|grande|barat\w*|car\w*|ampli\w*|conviene)\b/.test(normalizeVoiceText(value))
}
