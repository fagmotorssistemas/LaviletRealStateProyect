# Objetivo compartido del turno — 28 de septiembre de 2026

## Problema y comportamiento corregido

Una consulta inicial como «Precio» podía clasificarse como ajena al negocio. Eso dejaba vacío el mensaje autorizado para la extracción y enviaba una respuesta de alcance sin pasar por el redactor comercial ni por la presentación que solicita nombre y residencia. En una continuación como «sobre suites», otras capas podían reconocer la categoría y olvidar que se estaba preguntando su precio.

El cambio incorpora un contrato `turn-intent-v1`, resuelto después de interpretar el turno. La consulta comercial, el redactor, la revisión y la memoria reciben el mismo objetivo, las solicitudes actuales, la referencia inmobiliaria y los datos que deben responderse. No añade otro agente ni otra llamada al modelo para resolver este contrato.

| Situación | Resultado esperado |
| --- | --- |
| Primer «Precio», con precios publicados y autorizados | Ofrecer valores o rango verificados; después aplicar la presentación de nombre y residencia y diferir el brochure según el flujo existente. |
| «Precio» → «sobre suites» | Consultar el precio de las suites, conservando el objetivo previo y el texto real del nuevo mensaje. Las medidas no sustituyen esa respuesta. |
| Aclaración de planta, dormitorios o unidad | Respetar la referencia y los filtros resueltos por el catálogo al cotizar. |
| El lead cambia de tema | Atender la intención nueva. El objetivo anterior no obliga a seguir hablando de precios. |
| El lead da su nombre o residencia | Guardar el perfil y continuar la presentación; esos datos no son una petición nueva de precio ni una selección de inmueble. |
| No hay rango general publicado | Explicar la limitación y pedir la referencia necesaria; no fabricar importes. Las políticas existentes para precios específicos sin autorización siguen aplicándose. |
| Solicitud de otro negocio | Conservar el límite de alcance cuando existe evidencia concreta del asunto ajeno. Una pregunta incompleta o una respuesta equivocada del bot no son esa evidencia. |

## Decisiones compartidas

`conversation.ts` guarda el contrato en `summary._turn_intent` y en la auditoría `resolved_turn_intent`; lo entrega como `contrato_turno` al proveedor de precios y al redactor. El historial identifica referencias, pero nunca acredita precios ni autorizaciones.

El contrato contiene:

- `objective`: intención efectiva del turno.
- `required_facts`: datos que no pueden sustituirse por una invitación comercial; en esta corrección se comprueba explícitamente el precio disponible.
- `subject`: categoría, números de unidad y filtros interpretados.
- `interpretation_source`: solicitud actual o aclaración de una consulta de precio previa.
- `continuation_goal`: objetivo que puede mantenerse al aclarar la referencia o completar el perfil.
- `scope`: alcance, motivo de conciliación y evidencia del asunto ajeno cuando existe.
- `pending_question` y `profile_pending`: contexto de la pregunta realmente pendiente.

La interpretación conserva las solicitudes múltiples: pedir un precio no borra otra consulta. Los permisos de citas, financiamiento, seguimiento y derivación siguen comprobándose aparte; el contrato no concede consentimiento.

## Alcance y precios

El clasificador debe devolver `outside_subject` y `outside_source` para excluir una solicitud. Se contrasta la cita literal con un mensaje del lead y su vigencia. «Precio», «información» o la falta de categoría no demuestran que se esté hablando de otro negocio.

La continuidad de una exclusión usa la evidencia del alcance anterior guardada en el contrato. En conversaciones antiguas sin esa evidencia, el clasificador vuelve a evaluar el contexto; un nombre, residencia o texto previo del bot no crean por sí solos un veto permanente.

La cotización usa el catálogo vigente, unidades disponibles/publicadas y la política de precios autorizados. Un rango general se presenta como rango de **inmuebles**, sin atribuir a departamentos el precio de otra categoría. Si solo algunas opciones tienen precio publicado, se declara esa limitación. La selección explícita de unidad conserva prioridad sobre filtros de una búsqueda anterior.

## Redacción, respaldo e interfaz

El redactor y el revisor reciben el mismo contrato. Se permite una redacción natural y una continuación comercial pertinente, conservando datos verificados y la solicitud de perfil acordada. `turn_price_unanswered` detecta que una propuesta omite un precio disponible que debía responder; no exige números cuando no hay cotización verificada. El respaldo también pasa esta comprobación.

La revisión posterior a transformaciones conserva la cotización del turno, para que modificar el texto no pierda ese control. Se mantienen las validaciones existentes de relaciones unidad/precio, cifras, enlaces, catálogo, acciones y contenido.

La vista **Por mensaje** incorpora **Objetivo compartido del turno**. Permite ver objetivo, categoría/unidades, filtros, datos obligatorios, origen de la interpretación, pregunta pendiente y motivo de conciliación del alcance. El mismo contrato aparece en la revisión de respuesta. Las ejecuciones antiguas sin contrato no reciben una interpretación reconstruida.

## Alcance de la entrega

Cambios de código, pruebas y documentación locales. No se modifica la pertenencia de leads al proyecto ni el agrupamiento temporal de mensajes. No requiere migración SQL. Las respuestas de producción cambian al desplegar esta versión; los registros y mensajes históricos permanecen como evidencia de su ejecución original.

## Validación

Se prueban la consulta inicial de precio, la continuación por categoría y unidad, los filtros de cotización, los cambios de tema, el perfil, las solicitudes ajenas, la ausencia de precios autorizados, la conservación del objetivo por redactor/revisor/respaldo y su explicación en la interfaz.

Comandos de comprobación:

```text
npx.cmd tsc --noEmit
npm.cmd run test:conversation
npm.cmd run test:integrations
npm.cmd run test:lead-introduction
npm.cmd run test:message-trace
```

Resultados locales:

| Comprobación | Resultado |
| --- | --- |
| TypeScript (`tsc --noEmit`) | Correcto. |
| Integraciones | 228/228 aprobadas. |
| Precios y alternativas | 24/24 aprobadas, incluidas en la ejecución conjunta de 252 pruebas con integraciones. |
| Presentación inicial, extracción y revisión | 90/90 aprobadas. |
| Interfaz de explicación | 33/33 aprobadas. |
| Suite de conversación completa | 246/248 aprobadas. |

Los dos fallos de la suite completa están en `scripts/visit-date-context.test.cjs`, pruebas `current enabled places are preserved...` y `semantic extraction survives spelling errors...`: esperan `collecting`/`submitted` para el lunes a las 10:00, pero en la fecha y hora de ejecución ese horario ya pasó y el SQL devuelve `past`. Ese archivo y las migraciones de citas no se modificaron en esta entrega. No se declara aprobada toda la suite ni se cambia la regla de fechas para hacer pasar esas expectativas.

## Archivos y líneas modificadas

El mapa siguiente corresponde al diff local de esta entrega respecto del commit previo. Las líneas nuevas son las ubicaciones al terminar la corrección; pueden desplazarse con ediciones posteriores.

| Archivo | Lineas anteriores | Lineas actuales |
| --- | --- | --- |
| [docs/automatizacion/README.md](../../docs/automatizacion/README.md#L92) | sin lineas | 92-93 |
| [package.json](../../package.json#L29) | 29 | 29 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L30) | sin lineas | 30 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L54) | 53 | 54-55 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L67) | 65 | 67-68 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L77) | 74 | 77-78 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L92) | 88 | 92-93 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L104) | sin lineas | 104 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L156) | 150 | 156 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L169) | 163 | 169 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L185) | 179 | 185 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L201) | 195 | 201 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L206) | 200 | 206 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L216) | 210-211 | 216-217 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L222) | 216-217 | 222-223 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L232) | 226 | 232 |
| [scripts/business-scope.test.cjs](../../scripts/business-scope.test.cjs#L276) | sin lineas | 276-371 |
| [scripts/comparison-price.test.cjs](../../scripts/comparison-price.test.cjs#L149) | sin lineas | 149-252 |
| [scripts/integrations.test.cjs](../../scripts/integrations.test.cjs#L168) | 168 | 168 |
| [scripts/integrations.test.cjs](../../scripts/integrations.test.cjs#L171) | 171 | 171 |
| [scripts/integrations.test.cjs](../../scripts/integrations.test.cjs#L174) | 174 | 174 |
| [scripts/integrations.test.cjs](../../scripts/integrations.test.cjs#L2520) | sin lineas | 2520-2587 |
| [scripts/turn-completeness.test.cjs](../../scripts/turn-completeness.test.cjs#L38) | sin lineas | 38-87 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.test.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.test.ts#L56) | sin lineas | 56-102 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L100) | sin lineas | 100-106 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L136) | sin lineas | 136 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L206) | sin lineas | 206-233 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L262) | sin lineas | 262 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L326) | sin lineas | 326 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L371) | sin lineas | 371 |
| [src/components/inmobiliaria/automation/workflow/messageExplanation.ts](../../src/components/inmobiliaria/automation/workflow/messageExplanation.ts#L373) | 334 | 373-375 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L14) | sin lineas | 14-15 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L26) | 24 | 26-60 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L72) | sin lineas | 72-74 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L116) | 77 | 116 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L123) | 84 | 123-124 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L127) | sin lineas | 127 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L130) | sin lineas | 130-137 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L142) | 93 | 142-143 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L157) | 107 | 157-158 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L161) | 110 | 161 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L163) | sin lineas | 163-164 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L173) | sin lineas | 173-174 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L181) | 126 | 181 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L187) | 132 | 187 |
| [src/lib/integrations/automation/business-scope.ts](../../src/lib/integrations/automation/business-scope.ts#L196) | 141 | 196 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L27) | sin lineas | 27 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L352) | 351 | 352 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L363) | sin lineas | 363-364 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L483) | sin lineas | 483-490 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L508) | sin lineas | 508 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L551) | 539 | 551 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L959) | 947 | 959 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L996) | sin lineas | 996 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L1086) | 1073 | 1086 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L1110) | sin lineas | 1110 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L1140) | 1126 | 1140 |
| [src/lib/integrations/automation/conversation.ts](../../src/lib/integrations/automation/conversation.ts#L1173) | sin lineas | 1173 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L12) | sin lineas | 12-13 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L16) | sin lineas | 16-23 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L29) | 19-26 | 29 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L80) | sin lineas | 80-88 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L100) | 88-90 | 100-102 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L105) | sin lineas | 105 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L107) | 94-97 | 107-125 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L127) | 99 | 127-132 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L135) | 102-103 | 135-138 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L170) | sin lineas | 170-180 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L182) | 136 | 182-183 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L197) | 150 | 197 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L207) | 160 | 207-212 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L220) | 168 | 220-222 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L226) | 172 | 226-228 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L235) | 179 | 235-238 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L351) | sin lineas | 351 |
| [src/lib/integrations/automation/price-reply.ts](../../src/lib/integrations/automation/price-reply.ts#L364) | 304 | 364 |
| [src/lib/integrations/automation/sdr.ts](../../src/lib/integrations/automation/sdr.ts#L17) | sin lineas | 17 |
| [src/lib/integrations/automation/sdr.ts](../../src/lib/integrations/automation/sdr.ts#L99) | 98 | 99 |
| [src/lib/integrations/automation/sdr.ts](../../src/lib/integrations/automation/sdr.ts#L124) | 123 | 124 |
| [src/lib/integrations/automation/sdr.ts](../../src/lib/integrations/automation/sdr.ts#L126) | 125 | 126 |
| [src/lib/integrations/automation/sdr.ts](../../src/lib/integrations/automation/sdr.ts#L145) | 144 | 145 |
| [src/lib/integrations/automation/sdr.ts](../../src/lib/integrations/automation/sdr.ts#L158) | 157 | 158 |
| [src/lib/integrations/automation/sdr.ts](../../src/lib/integrations/automation/sdr.ts#L221) | 220 | 221 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L3) | sin lineas | 3 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L190) | sin lineas | 190 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L279) | sin lineas | 279-280 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L294) | sin lineas | 294 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L341) | sin lineas | 341 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L348) | 342 | 348 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L361) | 355 | 361 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L376) | 370 | 376 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L432) | 426 | 432 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L453) | 447 | 453 |
| [src/lib/integrations/automation/turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts#L523) | 517 | 523 |
| [src/lib/integrations/automation/turn-interpretation.ts](../../src/lib/integrations/automation/turn-interpretation.ts#L139) | sin lineas | 139 |
| [src/lib/integrations/automation/turn-intent.ts](../../src/lib/integrations/automation/turn-intent.ts#L1) | archivo nuevo | 1-58 |
| [scripts/turn-intent.test.cjs](../../scripts/turn-intent.test.cjs#L1) | archivo nuevo | 1-104 |
