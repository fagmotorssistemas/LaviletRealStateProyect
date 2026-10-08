import { decimalNumber } from './numeric-relations'

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const numberWords: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, doscientas: 200,
  trescientos: 300, trescientas: 300, cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500,
  seiscientos: 600, seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
}
const ordinals: Record<string, number> = { primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercer: 3, tercero: 3, tercera: 3,
  cuarto: 4, cuarta: 4, quinto: 5, quinta: 5, sexto: 6, sexta: 6, septimo: 7, septima: 7, octavo: 8, octava: 8,
  noveno: 9, novena: 9, decimo: 10, decima: 10 }

/** Values actually written, with stable offsets into the original prose. The
 * reviewer may use digits for a value expressed in words, without dictating copy. */
export function numericMentions(value: string): Array<{ value: number; index: number; end: number; text: string }> {
  const tokens = [...value.matchAll(/\d[\d.,]*|[a-záéíóúüñ]+/gi)]
  const result: Array<{ value: number; index: number; end: number; text: string }> = []
  for (let i = 0; i < tokens.length; i++) {
    const word = normalized(tokens[i][0]), digit = /^\d/.test(word)
    if (!digit && numberWords[word] == null && ordinals[word] == null && word !== 'mil') continue
    const start = tokens[i].index!, ordinal = !digit && ordinals[word] != null && numberWords[word] == null
    if (ordinal && !/^(?:planta|piso|nivel)$/.test(normalized(tokens[i + 1]?.[0] || ''))
      && !/^(?:planta|piso|nivel)$/.test(normalized(tokens[i - 1]?.[0] || ''))) continue
    let end = start + tokens[i][0].length, sum = 0, section = digit ? decimalNumber(word) : (numberWords[word] ?? ordinals[word] ?? 1000)
    if (!ordinal) for (let j = i + 1; j < tokens.length; j++) {
      if (/[.,]$/.test(tokens[j - 1][0]) || !/^\s+$/.test(value.slice(end, tokens[j].index))) break
      const next = normalized(tokens[j][0])
      if (next === 'coma' || next === 'punto') {
        let decimals = '', decimalEnd = end, last = j
        for (let k = j + 1; k < tokens.length; k++) {
          if (!/^\s+$/.test(value.slice(tokens[k - 1].index! + tokens[k - 1][0].length, tokens[k].index))) break
          const fractional = normalized(tokens[k][0])
          if (/^\d+$/.test(fractional)) decimals += fractional
          else if (numberWords[fractional] != null && numberWords[fractional] < 100) {
            let part = numberWords[fractional]
            if (part >= 20 && normalized(tokens[k + 1]?.[0] || '') === 'y'
              && numberWords[normalized(tokens[k + 2]?.[0] || '')] < 10) {
              part += numberWords[normalized(tokens[k + 2][0])]; k += 2
            }
            decimals += String(part)
          } else break
          decimalEnd = tokens[k].index! + tokens[k][0].length; last = k
        }
        if (decimals) { section += Number('0.' + decimals); end = decimalEnd; i = last }
        break
      }
      if (next === 'y' && numberWords[normalized(tokens[j + 1]?.[0] || '')] != null && section % 100 >= 20
        && numberWords[normalized(tokens[j + 1][0])] < 10) {
        end = tokens[j].index! + tokens[j][0].length; i = j; continue
      }
      if (next === 'mil') section = (section || 1) * 1000
      else if (next === 'millon' || next === 'millones') { sum += (section || 1) * 1_000_000; section = 0 }
      else if (numberWords[next] != null && !/^\d/.test(tokens[j - 1][0])
        && (section >= 100 || normalized(tokens[j - 1][0]) === 'y')) section += numberWords[next]
      else break
      end = tokens[j].index! + tokens[j][0].length; i = j
    }
    result.push({ value: sum + section, index: start, end, text: value.slice(start, end) })
  }
  return result
}

