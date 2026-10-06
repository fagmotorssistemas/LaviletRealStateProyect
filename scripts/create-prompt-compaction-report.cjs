/* eslint-disable @typescript-eslint/no-require-imports */
// Regenerate the requested PDF from the saved, isolated evaluation evidence.
const fs = require('node:fs'), path = require('node:path')
const { jsPDF } = require('jspdf')
const { autoTable } = require('jspdf-autotable')
const evidence = JSON.parse(fs.readFileSync('tmp/prompt-compaction/report-evidence.json', 'utf8'))
const pdf = new jsPDF({ unit: 'mm', format: 'a4' }), width = 174
// Embed the actual font: system fallback can render Helvetica as a condensed
// face with incompatible metrics and poor letter spacing in PDF viewers.
const reportFont = 'ReportSans'
for (const [file, style] of [['arial.ttf', 'normal'], ['arialbd.ttf', 'bold']]) {
  pdf.addFileToVFS(file, fs.readFileSync(`C:/Windows/Fonts/${file}`).toString('base64'))
  pdf.addFont(file, reportFont, style)
}
let y = 30
const colors = { ink: '#23382e', muted: '#54665d', pale: '#eef3ef', accent: '#ba7650' }
function page(label) {
  if (pdf.getNumberOfPages() > 1 || y !== 30) pdf.addPage()
  pdf.setFillColor(colors.ink); pdf.rect(0, 0, 210, 6, 'F')
  pdf.setFont(reportFont, 'bold'); pdf.setFontSize(10); pdf.setTextColor(colors.muted)
  pdf.text('LA VILET  /  AUTOMATIZACIÓN', 18, 17)
  pdf.setFontSize(22); pdf.setTextColor(colors.ink); pdf.text(label, 18, 34)
  y = 45
}
function paragraph(text, size = 11) {
  pdf.setFont(reportFont, 'normal'); pdf.setFontSize(size); pdf.setTextColor(colors.ink)
  const lines = pdf.splitTextToSize(text, width)
  if (y + lines.length * size * 0.43 + 5 > 270) {
    page('Continuación del informe')
    pdf.setFont(reportFont, 'normal'); pdf.setFontSize(size); pdf.setTextColor(colors.ink)
  }
  pdf.text(lines, 18, y); y += lines.length * size * 0.43 + 5
}
function heading(text) {
  if (y + 13 > 270) page('Continuación del informe')
  pdf.setFont(reportFont, 'bold'); pdf.setFontSize(13); pdf.setTextColor(colors.ink)
  pdf.text(text, 18, y); y += 8
}
function table(head, body, size = 10) {
  autoTable(pdf, { head: [head], body, startY: y, margin: { left: 18, right: 18, bottom: 23 },
    styles: { font: reportFont, fontSize: size, cellPadding: size <= 9 ? 2.2 : 3.3, textColor: colors.ink, lineColor: '#dbe4de', lineWidth: 0.15 },
    headStyles: { fillColor: colors.ink, textColor: '#ffffff', fontStyle: 'bold' },
    alternateRowStyles: { fillColor: colors.pale }, theme: 'grid' })
  y = pdf.lastAutoTable.finalY + 8
}
page('Prompts: antes y después')
paragraph('Informe de implementación y verificación - 6 de octubre de 2026', 10)
heading('Qué se aplicó')
paragraph('Queda activo el retiro de un ejemplo de formato JSON que repetía el esquema estricto del extractor: 2.251 caracteres menos cuando se utiliza el bloque semántico completo. La ruta financiera compacta no cambia. Se probó una deduplicación adicional del contexto, pero se dejó INACTIVA porque una respuesta mezcló áreas entre categorías. No se cambiaron modelos ni reglas comerciales.')
table(['Aspecto', 'Antes', 'Ahora'], [
  ['Formato del extractor', 'Esquema estricto y ejemplo JSON escrito dentro de las instrucciones.', 'El mismo esquema estricto y una indicación breve de seguirlo.'],
  ['Estado compartido', 'Contexto reducido y referencias del catálogo ya existentes.', 'Se conserva el comportamiento anterior. Las referencias adicionales probadas NO están activadas.'],
  ['Conflictos y datos ausentes', 'Se mantenían valores diferentes, null, false y cero.', 'Se mantienen. Una referencia nunca significa dato ausente.'],
  ['Validación y memoria', 'Evidencia canónica completa y controles de acciones.', 'Sin recortes: la proyección solo afecta la entrada del modelo.'],
  ['Modelos y revisión', 'Modelos configurados y interruptor global de revisión.', 'Se conservan ambos. No se fuerza activar ni desactivar la revisión.'],
], 9.5)
paragraph('Se conserva byte por byte la prosa semántica posterior al ejemplo retirado y el esquema estricto completo. No se truncaron mensajes ni se eliminó evidencia. El ahorro es moderado: no implica que cada mensaje cueste menos ni que salga siempre más rápido.', 10)

page('Reglas que se conservan')
table(['Caso', 'Comportamiento que permanece'], [
  ['Saludos y presentación', 'Variantes y errores de escritura; apertura, nombre y residencia según el estado del lead.'],
  ['Perfil incompleto', 'No inventar apellido, residencia o confirmación. Las reglas existentes deciden cuándo volver a pedir datos.'],
  ['Cinco dormitorios sin oferta', 'Presentar alternativas verificadas de tres con sus diferencias y pedir aceptación antes de avanzar.'],
  ['Precios de alternativas', 'Resolver “¿qué precios tienen?” sobre las opciones propuestas; preguntar no acepta la alternativa.'],
  ['Nueva intención o negación', 'Permitir cambiar de tema; no convertir rechazo, duda o hipótesis en consentimiento.'],
  ['Selección progresiva', 'Categoría y planta primero; después opciones de esa planta. Una sola opción compatible se presenta con características y tour 360 autorizado.'],
  ['Cantidades y superficies', 'Personas y dormitorios se separan. Rangos, mínimos, extremos y áreas se sustentan en unidades verificadas.'],
  ['Presupuesto', 'Mantener estimaciones tentativas y distinguir precio total, aporte inicial y crédito solicitado.'],
  ['JEP y Banco Pichincha', 'Conservar la entidad elegida, consentimiento y requisitos pendientes. No sustituirlos por una consulta informativa.'],
  ['Datos financieros', 'Nombre legal completo, cédula y perfil laboral se validan sin completar información por suposición.'],
  ['Entrega y políticas', 'Respetar configuración: fecha confirmada, estimación o ausencia de fecha; reglas comerciales y condiciones habilitadas.'],
  ['Respuesta y continuación', 'Contestar la consulta actual, enlazarla con el siguiente paso y conservar una pregunta pertinente.'],
  ['Materiales y ubicación', 'Usar enlaces autorizados y estado de materiales enviados; conservar las condiciones existentes para dirección y mapa.'],
  ['Reservas, citas y asesor', 'Exigir operaciones reales antes de afirmar confirmación, envío o asignación. No derivar por una consulta informativa normal.'],
  ['Consultas compuestas', 'Retener todas las peticiones y su procedencia. Mantener opt-out, controles de revisión y recuperación técnica.'],
  ['Embeddings y alcance', 'Búsqueda exacta y semántica siguen su ruta. Candidatas semánticas no prueban totales, extremos ni ausencia en todo el proyecto.'],
], 9)

page('Resultados de las pruebas')
paragraph('Las pruebas son aisladas: no escriben conversaciones ni envían mensajes a WhatsApp o Kommo. Los valores del conjunto de evaluación son sintéticos y no se publican como condiciones del proyecto.', 10)
table(['Verificación', 'Resultado'], [
  ['Regresión amplia, sin duplicar archivos', `${evidence.tests.files} archivos; ${evidence.tests.total} pruebas: ${evidence.tests.pass} aprobadas, ${evidence.tests.fail} fallidas.`],
  ['Control con el código anterior', `${evidence.baseline.total} pruebas: ${evidence.baseline.pass} aprobadas, ${evidence.baseline.fail} fallidas. ${evidence.baseline.same_failures ? 'El conjunto de fallos coincide con el actual.' : 'Revisar diferencias de fallos.'}`],
  ['Pruebas nuevas de reducción', '40 aprobadas: equivalencia de datos, ciclos, conflictos, esquema, 18 etapas con inventario completo/incompleto y protección del contexto de producción. Otras 5 verifican las fichas y criterios de la evaluación.'],
  ['Comparación real con el modelo', `${evidence.live.total_calls} llamadas en total. Extractor: 32 de 32 aprobadas, sobre 16 escenarios. Candidato de contexto: 20 llamadas válidas al redactor, con 1 fallo de relación categoría-área; se descartó su activación.`],
  ['Reglas y formato', 'La prosa semántica posterior al ejemplo de JSON se conserva byte por byte; el esquema de respuesta antes/después es idéntico.'],
  ['Compilación y lint', evidence.checks.join(' / ')],
], 10)
heading('Lo que las pruebas amplias revelaron')
paragraph(evidence.test_limitations, 10)
heading('Qué cubrió la comparación con IA')
paragraph('Referencias a precios y tamaños de propuestas; aceptar o rechazar alternativas; cambiar de tema; personas frente a dormitorios; mínimo de dormitorios; presupuesto tentativo; elección de JEP o Pichincha; identidad parcial; consultas compuestas; visita negada; asesor explícito; rechazo de mensajes; presentación con errores de escritura. En el redactor: aperturas, precios/planta, orientación familiar y reconocimiento de perfil.', 10)
paragraph('Son escenarios representativos, no todas las conversaciones posibles. Una comparación por escenario no determina una tasa estadística de errores. Las pruebas con referencias verifican conservación de información, pero el modelo aún puede interpretar mal esa información.', 10)

page('Costo, alcance y reversión')
table(['Medida de la muestra real', 'Antes', 'Después', 'Diferencia'], evidence.metrics.map(m => [m.label, String(m.before), String(m.after), m.difference]), 10)
paragraph(`La tabla mide únicamente el recorte aprobado del extractor. Tokens y caché provienen de usage en la API; los dólares se calculan con las tarifas registradas, no son una factura devuelta por la API. Gasto total de todas las evaluaciones: USD ${evidence.live.usd.toFixed(4)}.`, 10)
paragraph('Se alternó el orden antes/después. La caché y la variación de salida afectan el costo observado; la latencia también depende del servicio. La diferencia de tamaño de entrada sí se atribuye a este recorte porque cada par usa el mismo contexto, modelo y esquema.', 10)
heading('Límites y condiciones para volver atrás')
paragraph('Este cambio no busca solucionar todas las causas del costo: los prompts de reglas siguen siendo grandes, y las reescrituras o recuperaciones pueden dominar una ejecución. Tampoco cambia el cron, la agrupación de mensajes ni la selección de embeddings; conserva los ajustes anteriores.', 10)
page('Validación y reproducción')
heading('Recorte descartado por calidad')
paragraph('Una respuesta del candidato mezcló los 120,83 m² del departamento con los 142,09 m² del penthouse. Tres repeticiones por versión pasaron los criterios automáticos; en la lectura manual también apareció “balcones” cuando la ficha solo acreditaba área exterior. Estos resultados no justifican activar el recorte cuando la prioridad es conservar la calidad.', 10)
heading('Control y reversión')
paragraph('Si aparece una regresión nueva, conserve su ejecución y compare el mismo estado completo. La deduplicación ampliada solo funciona con deduplicateSharedState=true: ninguna llamada de producción lo activa. Para volver al formato anterior del extractor, restaure turn-semantics.ts desde la revisión base en una nueva revisión de código, preservando las correcciones comerciales previas.', 10)
paragraph(`Base: ${evidence.baseline_commit}. shared-turn-state-v1 es un candidato experimental INACTIVO. Archivos: turn-semantics.ts y turn-prompt-context.ts. No se sobrescribieron la configuración editable del negocio ni los prompts publicados en la base de datos.`, 9)
heading('Reproducción')
paragraph('npm run test:prompt-compaction; node scripts/test-automation-regressions.cjs; npm run eval:prompt-compaction (captura sin llamadas). Para comparar la IA: --live --max-calls 46 --max-usd 3. --experimental-shared-state evalúa el candidato descartado, sin activarlo en producción. Solo se permite la API de Responses y se limita el gasto.', 9)
paragraph('Referencias oficiales: developers.openai.com/api/docs/guides/prompt-engineering y developers.openai.com/api/docs/guides/structured-outputs. El esquema asegura la forma; conservar calidad exige evaluar el comportamiento.', 9)

for (let index = 1; index <= pdf.getNumberOfPages(); index++) {
  pdf.setPage(index); pdf.setFont(reportFont, 'normal'); pdf.setFontSize(8); pdf.setTextColor(colors.muted)
  pdf.text('Implementación local - 06/10/2026', 18, 286)
  pdf.text(`${index} / ${pdf.getNumberOfPages()}`, 192, 286, { align: 'right' })
}
const out = 'output/pdf/automatizacion-prompts-antes-despues-2026-10-06.pdf'
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.from(pdf.output('arraybuffer')))
console.log(JSON.stringify({ output: out, pages: pdf.getNumberOfPages() }))
