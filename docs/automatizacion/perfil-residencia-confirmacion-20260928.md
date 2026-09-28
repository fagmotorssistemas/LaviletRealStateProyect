# Perfil del lead: lugar declarado y residencia actual

Estado: implementado y comprobado localmente el 28/09/2026. Pendiente de commit, push y despliegue por el usuario. Estas pruebas no acreditan una ejecución del nuevo código en producción.

## Problema corregido

En el caso «claro, Carlos y soy de Cuenca», el extractor devolvía Cuenca con la evidencia «soy de Cuenca». El normalizador eliminaba ese valor como residencia, sin conservarlo como lugar declarado. El flujo volvía a pedir residencia y el control `lead_profile_question_changed` exigía la pregunta literal de respaldo, aunque la revisión propusiera otra continuación.

La corrección separa el dato y su significado. El lugar se conserva con su evidencia; solo pasa a residencia cuando existe una declaración explícita de vivir allí o una confirmación de la pregunta pendiente. Extractor, planificador, redactor y revisor reciben ese mismo estado.

## Comportamiento esperado

| Mensaje del lead | Estado guardado y próximo paso |
| --- | --- |
| «Claro, Carlos y soy de Cuenca» | Nombre Carlos; origen Cuenca; residencia pendiente. Entrega el brochure, reconoce «Mucho gusto, Carlos» y pregunta si Cuenca es su residencia actual. |
| «Sí», respondiendo a esa confirmación | Cuenca pasa a residencia confirmada; conserva la evidencia del sí y el origen. Continúa la conversación sin repetir nombre, brochure ni pregunta de residencia. |
| «No, vivo en Guayaquil» | Confirma Guayaquil como residencia y conserva Cuenca como origen. |
| «Soy de Cuenca, pero vivo en Guayaquil» | Registra ambos significados desde el mismo mensaje; no vuelve a confirmar una residencia ya declarada. |
| «No», respondiendo a la confirmación | Descarta el candidato como residencia, conserva el origen y pide la residencia actual una vez. |
| «Estoy de vacaciones en Quito» | Conserva una ubicación temporal; no la convierte en residencia. |
| «Vivo en España» | Guarda país sin inventar ciudad. |
| «Soy de Loja» después de la presentación inicial | Conserva el lugar y puede retomar la confirmación, aunque la captura inicial haya terminado. |
| Datos del perfil junto con precio o presupuesto | Mantiene la respuesta comercial y reconoce los datos recibidos. La captura no sustituye la consulta. |
| Rechazo a dar datos o cambio de tema | No bloquea el brochure ni insiste indefinidamente. |

La lógica recibe nombres y lugares variables. Cuenca, Guayaquil, Loja y los demás nombres de las pruebas son ejemplos, no una lista de lugares permitidos.

Ejemplo de respuesta base para el caso reportado:

> Mucho gusto, Carlos. Aquí tiene el brochure digital completo del proyecto: [enlace oficial].
>
> Entiendo que es de Cuenca. ¿Es también su lugar de residencia actual?

La IA puede reformular la pregunta conservando el lugar y el propósito, por ejemplo «¿Actualmente vive allí?». Los controles siguen comprobando evidencia, entrega del enlace requerido, reconocimiento del nombre y que un lugar pendiente no se afirme como residencia confirmada.

## Estado compartido y persistencia

`conversations.summary._lead_profile` conserva `full_name`, `declared_location`, `residence_candidate`, `residence_city`, `residence_country`, `residence_status` y `sources`. Las fuentes guardan evidencia, mensaje y fecha. No se infiere país a partir de ciudad, teléfono ni ubicación del proyecto.

`_pending_question` incorpora `lead_profile`, `lead_profile_name`, `lead_profile_residence` y `lead_residence_confirmation`. Esta última incluye el candidato exacto al que se refiere. Un sí a otra pregunta no confirma residencia. La referencia se construye a partir del texto final enviado, incluso si la IA reformula la pregunta.

`_lead_introduction` usa versión 2, conserva la continuación comercial y limita recordatorios. `acknowledged_name` se guarda después de que Kommo acepta el envío y solo si el texto incluye el reconocimiento. Un fallo de Salesbot no marca el saludo ni la pregunta como enviados.

El nombre declarado también actualiza `leads.name`, como antes. No se requiere migración SQL ni se agregan llamadas de IA. La residencia se conserva en la memoria de la conversación; esta entrega no construye todavía mapas de calor ni tablas analíticas independientes.

## Diagnóstico en la interfaz

El paso **Nombre y residencia interpretados** muestra lugar declarado, significado, evidencia, residencia registrada y estado de confirmación. **Presentación y datos del lead** y **Revisión de la respuesta** muestran también el propósito de la pregunta, su candidato y el reconocimiento de nombre preparado, cuando esos datos existen en la traza. Los registros históricos no se reinterpretan para inventar esos campos.

Los motivos nuevos son:

| Control | Significado |
| --- | --- |
| `lead_profile_confirmation_omitted` | Falta confirmar la residencia o se perdió el lugar candidato. |
| `lead_profile_question_purpose_changed` | Cambió el dato solicitado o se omitió el propósito de brochure y guía personalizada. |
| `lead_profile_unconfirmed_residence` | Se afirmó como residencia un lugar todavía pendiente. |
| `lead_profile_name_acknowledgement_missing` | Se omitió «Mucho gusto» con el nombre recibido. |

La interfaz conserva el filtrado existente de campos personales de las trazas; el nombre completo puede aparecer protegido. La pregunta preparada no acredita su entrega: el texto final y la aceptación de Kommo se verifican en el paso de envío.

## Validación

- `npm run test:lead-introduction`: 111 pruebas aprobadas, incluyendo extracción, redacción/revisión y planificación del perfil.
- `npm run test:integrations`: 230 pruebas aprobadas; incluye recorrido completo con modelos simulados, pregunta reformulada, confirmación, corrección de ciudad y fallo de envío.
- `npm run test:message-trace`: 38 pruebas aprobadas.
- `npx tsc --noEmit`: aprobado.
- `npm run test:conversation`: 264/266 aprobadas. Permanecen dos fallos temporales ya identificados en `scripts/visit-date-context.test.cjs`, líneas 232 y 273: un horario fijo de prueba pasó a estado `past`. No corresponden al perfil del lead.

Las pruebas usan respuestas de modelos simuladas y verifican los contratos y controles reales. No garantizan que un modelo genere siempre el mismo texto; permiten detectar que no se pierda el estado y que no se rechace una reformulación válida solo por cambiar palabras.

## Archivos y líneas corregidas

La tabla siguiente compara la copia de trabajo con `HEAD` al terminar esta corrección. Cada fila identifica un bloque de líneas modificado; las referencias pueden desplazarse en cambios posteriores. Incluye código y pruebas.

| Archivo | Líneas anteriores | Líneas actuales |
| --- | --- | --- |
| [docs/automatizacion/05-leads-y-seguimiento.md](../../docs/automatizacion/05-leads-y-seguimiento.md#L3) | Inserción | 3–8 |
| [docs/automatizacion/README.md](../../docs/automatizacion/README.md#L94) | Inserción | 94–95 |
| [scripts/integrations.test.cjs](../../scripts/integrations.test.cjs#L2624) | Inserción | 2624–2730 |
| [scripts/turn-completeness.test.cjs](../../scripts/turn-completeness.test.cjs#L118) | 118 | 118 |
| [scripts/turn-completeness.test.cjs](../../scripts/turn-completeness.test.cjs#L163) | Inserción | 163–193 |
| [scripts/turn-interpretation.test.cjs](../../scripts/turn-interpretation.test.cjs#L8) | Inserción | 8 |
| [scripts/turn-interpretation.test.cjs](../../scripts/turn-interpretation.test.cjs#L185) | 184–185 | 185–187 |
| [scripts/turn-interpretation.test.cjs](../../scripts/turn-interpretation.test.cjs#L195) | Inserción | 195–389 |
| [scripts/turn-semantics.test.cjs](../../scripts/turn-semantics.test.cjs#L79) | Inserción | 79–130 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.test.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.test.ts#L56) | Inserción | 56–127 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L100) | Inserción | 100–103 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L141) | Inserción | 141 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L211) | Inserción | 211–250 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L308) | Inserción | 308 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L373) | Inserción | 373–374 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L423) | Inserción | 423 |
| [src/components/inmobiliaria/automation/workflow/reviewDecision.ts](../../src/components/inmobiliaria/automation/workflow/reviewDecision.ts#L7) | Inserción | 7–12 |
| [src/components/inmobiliaria/automation/workflow/reviewDecision.ts](../../src/components/inmobiliaria/automation/workflow/reviewDecision.ts#L45) | Inserción | 45 |
| [src/components/inmobiliaria/automation/workflow/reviewDecision.ts](../../src/components/inmobiliaria/automation/workflow/reviewDecision.ts#L57) | Inserción | 57 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L21) | 21 | 21 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L26) | 26 | 26–27 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L513) | 512–527 | 513–516 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L542) | 553–554 | 542 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L1162) | Inserción | 1162 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L1255) | Inserción | 1255 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L1260) | 1270 | 1260 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L1320) | Inserción | 1320–1334 |
| [src/lib/integrations/automation/lead-introduction.test.ts](../../src/lib/integrations/automation/lead-introduction.test.ts#L3) | 3 | 3 |
| [src/lib/integrations/automation/lead-introduction.test.ts](../../src/lib/integrations/automation/lead-introduction.test.ts#L23) | Inserción | 23–26 |
| [src/lib/integrations/automation/lead-introduction.test.ts](../../src/lib/integrations/automation/lead-introduction.test.ts#L134) | 130 | 134 |
| [src/lib/integrations/automation/lead-introduction.test.ts](../../src/lib/integrations/automation/lead-introduction.test.ts#L141) | Inserción | 141–209 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L3) | 3 | 3 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L5) | Inserción | 5–6 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L60) | 58 | 60–68 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L74) | 64–65 | 74–102 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L140) | 104–105 | Eliminadas |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L142) | 107–110 | 142–155 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L157) | 112 | 157 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L160) | 115 | 160 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L162) | 117 | 162 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L165) | 120 | 165–168 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L172) | Inserción | 172 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L174) | 125 | 174 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L178) | 129–130 | 178–188 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L190) | 132–134 | 190–194 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L196) | Inserción | 196 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L202) | 141 | 202–204 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L209) | 146 | 209–211 |
| [src/lib/integrations/automation/lead-introduction.ts](../../src/lib/integrations/automation/lead-introduction.ts#L221) | 156 | 221–245 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L110) | Inserción | 110 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L433) | 432 | 433 |
| [src/lib/integrations/automation/turn-interpretation.ts](../../src/lib/integrations/automation/turn-interpretation.ts#L7) | Inserción | 7 |
| [src/lib/integrations/automation/turn-interpretation.ts](../../src/lib/integrations/automation/turn-interpretation.ts#L38) | Inserción | 38–40 |
| [src/lib/integrations/automation/turn-interpretation.ts](../../src/lib/integrations/automation/turn-interpretation.ts#L72) | 69–110 | Eliminadas |
| [src/lib/integrations/automation/turn-interpretation.ts](../../src/lib/integrations/automation/turn-interpretation.ts#L97) | 135 | 97 |
| [src/lib/integrations/automation/turn-interpretation.ts](../../src/lib/integrations/automation/turn-interpretation.ts#L122) | 160 | 122 |
| [src/lib/integrations/automation/turn-semantics.ts](../../src/lib/integrations/automation/turn-semantics.ts#L16) | Inserción | 16–19 |
| [src/lib/integrations/automation/turn-semantics.ts](../../src/lib/integrations/automation/turn-semantics.ts#L38) | 34 | 38–39 |
| [src/lib/integrations/automation/turn-semantics.ts](../../src/lib/integrations/automation/turn-semantics.ts#L115) | Inserción | 115–121 |
| [src/lib/integrations/automation/turn-semantics.ts](../../src/lib/integrations/automation/turn-semantics.ts#L138) | 126 | 138 |
| [src/lib/integrations/automation/turn-semantics.ts](../../src/lib/integrations/automation/turn-semantics.ts#L166) | Inserción | 166 |
| [src/lib/integrations/automation/turn-semantics.ts](../../src/lib/integrations/automation/turn-semantics.ts#L203) | 190 | 203–206 |
| [src/lib/integrations/automation/lead-profile.ts](../../src/lib/integrations/automation/lead-profile.ts#L1) | Archivo nuevo | 1–193 |
