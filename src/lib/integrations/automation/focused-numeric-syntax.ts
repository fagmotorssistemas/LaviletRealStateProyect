import { numericMentions } from './semantic-review'
import { projectQuantities } from './project-quantities'

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const ordinals: Record<string, number> = { primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2,
  tercer: 3, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6,
  septimo: 7, septima: 7, octavo: 8, octava: 8, noveno: 9, novena: 9, decimo: 10, decima: 10,
  undecimo: 11, undecima: 11, duodecimo: 12, duodecima: 12, vigesimo: 20, vigesima: 20,
  trigesimo: 30, trigesima: 30, cuadragesimo: 40, cuadragesima: 40, quincuagesimo: 50, quincuagesima: 50,
  sexagesimo: 60, sexagesima: 60, septuagesimo: 70, septuagesima: 70, octogesimo: 80, octogesima: 80,
  nonagesimo: 90, nonagesima: 90, centesimo: 100, centesima: 100 }
const unitPattern = '(?:por ciento|kil[oó]metros?|cent[ií]metros?|dec[ií]metros?|hect[aá]reas?|minutos?|horas?|metros?|d[oó]lares?|mill[oó]n(?:es)?|mil|km|cm|dm|m(?:²|2)?|h|hrs?|min|USD|%)'

/** Numeric syntax only, retaining offsets into the unchanged draft. */
function numericalSyntax(original: string) {
  let value = original
  let starts = Array.from({ length: original.length }, (_, index) => index)
  let ends = starts.map(index => index + 1)
  const replace = (pattern: RegExp, substitute: (match: RegExpMatchArray) => string) => {
    for (const match of [...value.matchAll(pattern)].reverse()) {
      const from = match.index!, to = from + match[0].length, replacement = substitute(match)
      const start = starts[from], end = ends[to - 1]
      value = value.slice(0, from) + replacement + value.slice(to)
      starts = [...starts.slice(0, from), ...Array(replacement.length).fill(start), ...starts.slice(to)]
      ends = [...ends.slice(0, from), ...Array(replacement.length).fill(end), ...ends.slice(to)]
    }
  }
  replace(/https?:\/\/\S+/gi, match => ' '.repeat(match[0].length))
  replace(/(?<!\p{L})m2\b/giu, () => 'm²')
  replace(/(?<![\p{L}\d.,])([.,])(\d+)(?!\d)/gu, match => `0${match[1]}${match[2]}`)
  replace(/(?<![\p{L}\d.,])\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d{1,2})?(?![\p{L}\d.,])/gu,
    match => match[0].replace(/[ \u00a0\u202f]/g, ''))
  replace(new RegExp(`\\b([\\p{L}\\d.,]+)\\s+(${unitPattern})\\s+y\\s+medi[oa]\\b`, 'giu'), match => {
    const parsed = numericMentions(match[1])
    return parsed.length === 1 ? `${parsed[0].value + 0.5} ${match[2]}` : match[0]
  })
  replace(new RegExp(`\\bmedi[oa]\\s+(?=${unitPattern}\\b)`, 'gi'), () => '0.5 ')
  replace(/\b(?:un|1)\s+cuarto\s+de\s+(?=mill[oó]n(?:es)?\b)/gi, () => '0.25 ')
  replace(/\b(?:tres|3)\s+cuartos\s+de\s+(?=mill[oó]n(?:es)?\b)/gi, () => '0.75 ')
  return { value, starts, ends }
}

export type FocusedNumericMention = {
  value: number; index: number; end: number; text: string;
  quantities: Array<{ value: number; dimension: string; unit: string }>;
}

/** Bounded Spanish numeric grammar shared by extraction coverage and comparison.
 * It is not a general natural-language/mathematical parser: articles and ordinal
 * words remain ambiguous occurrences for the model to classify explicitly. */
export function focusedNumericMentions(original: string): FocusedNumericMention[] {
  const syntax = numericalSyntax(original), mentions = numericMentions(syntax.value)
  // The legacy helper starts another span after a million-scale section. Join
  // the following written lower-order section without applying business rules.
  for (let index = 0; index < mentions.length - 1; index++) {
    const left = mentions[index], right = mentions[index + 1]
    if (left.value >= 1_000_000 && /millon(?:es)?$/.test(normalize(left.text)) && right.value < 1_000_000
      && /^[\p{L}]/u.test(right.text) && /^\s+$/.test(syntax.value.slice(left.end, right.index))) {
      left.value += right.value; left.end = right.end; left.text = syntax.value.slice(left.index, left.end)
      mentions.splice(index + 1, 1)
    }
  }
  const words = [...syntax.value.matchAll(/[\p{L}]+/gu)]
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    let value = ordinals[normalize(word[0])], end = word.index! + word[0].length
    if (value == null) continue
    const next = words[index + 1], nextValue = next && ordinals[normalize(next[0])]
    if (value >= 10 && value % 10 === 0 && nextValue > 0 && nextValue < 10
      && /^\s+$/.test(syntax.value.slice(end, next.index))) {
      value += nextValue; end = next.index! + next[0].length; index++
    }
    for (let position = mentions.length - 1; position >= 0; position--)
      if (word.index! < mentions[position].end && end > mentions[position].index) mentions.splice(position, 1)
    mentions.push({ value, index: word.index!, end, text: syntax.value.slice(word.index, end) })
  }
  const sorted = mentions.sort((a, b) => a.index - b.index)
  return sorted.filter(mention => Number.isFinite(mention.value)).map((mention, index) => {
    let value = mention.value, normalizedStart = mention.index
    const sign = syntax.value.slice(0, mention.index).match(/(?:^|[\s(:=$€£])([+\-−])\s*(?:[$€£]\s*)?$/)
    if (sign) {
      const position = mention.index - sign[0].length + sign[0].lastIndexOf(sign[1])
      const previous = sorted[index - 1]
      const rangeSeparator = previous && /^\s*$/.test(syntax.value.slice(previous.end, position))
      if (!rangeSeparator) { normalizedStart = position; if (sign[1] !== '+') value = -value }
    }
    const start = syntax.starts[normalizedStart], end = syntax.ends[mention.end - 1]
    const suffix = syntax.value.slice(mention.end).match(new RegExp(`^\\s*(${unitPattern})(?![\\p{L}\\d²]|\\s*(?:cuadrad|2\\b))`, 'iu'))
    const quantities = suffix ? projectQuantities(`${Math.abs(value)} ${suffix[1]}`)
      .map(quantity => ({ value: quantity.value * (value < 0 ? -1 : 1), dimension: quantity.dimension, unit: quantity.unit })) : []
    return { value, index: start, end, text: original.slice(start, end), quantities }
  })
}
