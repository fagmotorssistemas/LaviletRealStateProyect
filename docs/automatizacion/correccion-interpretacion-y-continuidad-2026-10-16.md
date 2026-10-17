# Interpretación por IA y continuidad de la conversación

Fecha: 16 de octubre de 2026. Estado: cambios locales en validación; sin despliegue ni cambios de datos en producción.

## Problema y alcance

La incidencia de la cita y el saludo mostró un problema compartido: después de que la IA interpretaba una intervención, varias funciones intentaban interpretar otra vez las palabras mediante expresiones regulares. Además, algunas rutas recuperaban decisiones leyendo mensajes anteriores del bot. Un cambio de vocabulario podía alterar una decisión aunque la interpretación original fuera correcta.

Esta intervención cambia el contrato de conversación y sus consumidores. No consiste en agregar más variantes de «o sea», «hola amigo» o «a las tres de la tarde» a una lista. La IA interpreta esas expresiones; el código recibe datos estructurados y comprueba su procedencia, los permisos y las condiciones operativas.

El alcance corresponde a las correcciones de interpretación, citas, saludo y continuidad solicitadas en este turno. No acredita que todos los hallazgos de auditorías anteriores estén cerrados ni que el comportamiento de producción ya haya cambiado.

## Separación de responsabilidades

| Responsable | Qué hace | Qué no acredita por sí solo |
| --- | --- | --- |
| IA intérprete | Identifica consultas, saludos, decisiones, referencias a unidades, permisos, fechas y horas. Cita su fuente. | Una solicitud registrada, una cita confirmada, una reserva efectiva ni un crédito aprobado. |
| Código de aplicación | Valida el esquema, las citas literales y sus fuentes; conserva estado; consulta el catálogo; calcula valores; ejecuta las operaciones autorizadas. | El significado de una frase nueva mediante palabras clave o la corrección factual del texto del redactor. |
| SQL | Resuelve calendario con valores estructurados, comprueba lugares y horarios y guarda solicitudes con sus fuentes. | Una preferencia inferida desde un texto antiguo sin interpretación vigente. |
| IA redactora | Escribe el mensaje completo a partir de la consulta, el estado real y los hechos autorizados. Declara qué pregunta efectivamente escribió. | Una operación que no figura en el resultado guardado. |
| IA revisora | Cuando está habilitada, comprueba contenido contra los hechos autorizados conforme a su contrato. | Reparar una memoria comercial perdida o ejecutar la siguiente acción. Su configuración actual no se activa con estos cambios. |

La revisión continúa desactivada conforme a la instrucción del usuario. El código conserva controles de transporte y de operaciones. La comprobación de una cita literal sigue siendo una comparación de procedencia; no interpreta negaciones, intenciones ni expresiones de cortesía.

## Cambios respecto del funcionamiento anterior

| Familia | Antes | Cambio local | Resultado esperado |
| --- | --- | --- | --- |
| Saludo y cortesía | Atajos literales reconocían algunas formas. Un saludo no reconocido podía terminar en una pregunta obligatoria de vivienda o local. | `communication` interpreta el turno completo en la extracción común. Los saludos y las ambigüedades tienen objetivos de atención abierta. | «Eh, hola amigo» recibe bienvenida y ofrecimiento de ayuda, sin atribuir una necesidad comercial. |
| Consulta con saludo | Detectar una fórmula social podía competir con la consulta adicional. | La presencia de saludo se separa de la función del turno. Saludo más consulta sigue siendo una consulta sustantiva. | «Hola, ¿qué precio tiene el 605?» conserva la consulta de precio. |
| Apertura y perfil | La preparación aún buscaba palabras de precio, categoría, brochure o rechazo y recuperaba preguntas recortando la base. | Se utilizan consultas, categorías, rechazo de perfil y decisión de material ya interpretados. El objetivo de continuación procede del estado estructurado. | Una variante al pedir información o rechazar datos recibe el mismo tratamiento; se mantiene la solicitud inicial de nombre y residencia con sus excepciones vigentes. |
| Permisos | Había booleanos paralelos y comprobaciones de negación o condición por vocabulario. | `action_authority` reúne decisión, autor, destino, alcance, evidencia y confianza por gestión. Los booleanos internos se derivan de ese contrato. | Una hipótesis, una frase de otra persona o la aceptación de detalles no inicia una reserva, cita ni revisión financiera. |
| Respuestas breves | Un «sí» podía depender de reconstruir la pregunta anterior leyendo su redacción. | La respuesta se vincula al identificador de la pregunta realmente entregada y a sus referencias verificadas. | Aceptar una unidad o un brochure no presta consentimiento a otro trámite. |
| Fechas y horas | TypeScript y SQL interpretaban palabras y formatos españoles, además de la interpretación de IA. | `visit-preference-v2` utiliza componentes de fecha, hora, lugar, ambigüedad y fuente. Se retiran los analizadores SQL antiguos. | Las paráfrasis dejan de depender de un repertorio de expresiones admitidas por el código. |
| Mensajes agrupados | Una fecha y una hora de mensajes distintos podían perder una de sus fuentes. | Cada componente conserva el identificador y el momento del mensaje que lo aporta. | Dar primero la hora y después el día completa la misma coordinación. |
| Lugar alternativo | Conservar una única preferencia podía perder parte del horario al aceptar después la oficina. | Se conserva una lista de componentes con fuentes; SQL comprueba cada componente contra el estado guardado. | Aceptar la oficina conserva el día y la hora anteriores sin atribuirlos al nuevo «sí». |
| Avance de cita | La respuesta podía limitarse a repetir la preferencia aunque el estado siguiera recopilando datos. | El plan del redactor utiliza el resultado operativo: dato pendiente, solicitud registrada o cita confirmada. Se comprueba el registro antes de anunciarlo. | Se pide únicamente lo que falta y se comunica el avance efectivamente realizado. |
| Selección y reserva | Algunas recuperaciones reconstruían ofertas desde mensajes del bot o reactivaban filtros anteriores. | Las referencias proceden de identificadores y metadatos entregados. Se conserva la lógica estructural de consultas, comparación y selección. | Una aclaración después de la reserva mantiene el 605 y las alternativas ya aceptadas. |
| Referencias relativas | Al retirar los analizadores textuales, hacía falta entregar a la IA los atributos de las opciones mostradas. | El contexto de interpretación incorpora baños, superficies, planta y espacios de los identificadores guardados. | La IA dispone de evidencia para entender «el que tiene más baños» sin que el código lea esa frase. |
| Presupuesto y financiamiento | Distintas rutas interpretaban palabras de importes, consentimiento o entidad elegida. | Los consumidores utilizan finalidad monetaria, decisiones y entidad tipificada; se mantienen las operaciones aritméticas y la validación de identificadores. | Una cifra conserva su finalidad; elegir entidad no inicia la recopilación de identidad legal. |
| Redacción y continuidad | Quedaban utilidades capaces de reconocer preguntas, modificar frases o vetar expresiones. | Se retiran esas facultades de los consumidores modificados; los metadatos del redactor describen su pregunta. Se elimina la segunda ruta comercial antigua de `sdr.ts` y se conserva un redactor final común. Los ajustes automáticos de cortesías pasan a conservar el texto recibido. | Mayor libertad de redacción sin que una paráfrasis cambie por sí sola el estado comercial. |
| Tono | Bases e instrucciones de citas favorecían advertencias rutinarias y respuestas administrativas. | Se orienta al redactor a explicar la acción y el siguiente paso en positivo, con cercanía y sin cortesías obligatorias. | Menos respuestas como «esto no confirma…», conservando el estado real de la gestión. |
| Búsqueda y materiales | Las rutas auxiliares podían volver a tomar decisiones desde palabras. | Se pasan los criterios interpretados a precios, ubicación y material visual. La búsqueda configurada por embeddings sigue disponible y no decide operaciones. | Se conservan consultas y enlaces pertinentes; no se incorpora el envío de renders adjuntos aplazado por el usuario. |

Estas **15 familias describen esta intervención**. No son 15 líneas, 15 incidentes productivos independientes ni un recuento nuevo de todas las reglas históricas.

Si la IA devuelve metadatos estructuralmente contradictorios —por ejemplo, «solo saludo» junto con una selección o una baja explícitas— se solicita una reparación limitada a la IA con el contexto real. Una hora con componentes incompatibles también se intenta recuperar en el bloque de visita. El código no busca palabras para adivinar cuál de los campos está bien. Las operaciones requieren un resultado utilizable; un contrato que siga siendo inválido queda registrado como incidencia y puede necesitar al equipo.

Al ampliar las pruebas se corrigió también una regresión de diagnóstico: el bloque nuevo de comunicación incluía su evidencia literal, que podía contener nombre o residencia. Ese bloque de diagnóstico conserva ahora únicamente clasificación, confianza y presencia de saludo. La evidencia necesaria para la conversación sigue en su contexto correspondiente, sin duplicarse en ese diagnóstico.

## Ejemplos de comportamiento esperado

Los siguientes mensajes ilustran el objetivo; no son plantillas obligatorias ni respuestas producidas por un modelo real durante las pruebas.

### 1. Saludo aislado

Cliente: «Eh… hola amigo».

Antes podía terminar en «¿Le interesan viviendas o locales comerciales?» porque el plan no identificaba un saludo y exigía descubrir categoría.

Ahora el objetivo es una bienvenida abierta, por ejemplo: «Buenas tardes, bienvenido a La Vilet. ¿En qué podemos ayudarle?».

Si ya hubo atención, un saludo no elimina una reserva ni obliga a repetir la presentación. Si el mismo turno contiene una consulta, esa consulta se atiende.

### 2. Hora antes del día

Cliente: «A las tres de la tarde». Después: «O sea, el miércoles 21 de octubre».

La IA entrega hora 15:00 y fecha 21 de octubre con el día semanal declarado. El calendario verifica su compatibilidad. Si están completos los datos y las condiciones operativas permiten registrar la solicitud, el sistema la registra y obtiene su identificador. El redactor comunica ese resultado y la revisión de agenda que sigue.

La expresión «o sea» no tiene ninguna regla especial en el calendario ni activa una elección entre alternativas.

### 3. Qué termina el agendamiento

| Estado real | Acción correspondiente |
| --- | --- |
| Falta día, hora o lugar necesario | Preguntar únicamente el dato pendiente. |
| Preferencia completa y solicitud guardada | Comunicar el registro de la solicitud y la revisión de agenda del equipo. |
| El asesor propone opciones | Presentar esas opciones para que el cliente elija. |
| Están las aceptaciones requeridas y consta la cita guardada | Comunicar fecha, hora y lugar confirmados. |

Registrar una solicitud y confirmar una cita son resultados distintos. La redacción debe expresar el resultado útil en positivo. Las citas ya confirmadas conservan las horas efectivamente guardadas; no necesitan volver a interpretar sus mensajes originales.

### 4. Aclaración después de solicitar la reserva del 605

Estado previo: penthouse 605 elegido; alternativas de tres dormitorios aceptadas; reserva solicitada.

Cliente: «Lo anterior fue un error; todavía nadie me ha llamado».

La aclaración conserva la selección y la consulta aceptada. La respuesta debe atender el estado de atención. No corresponde recuperar la necesidad antigua de cinco dormitorios ni volver a preguntar si acepta opciones de tres.

### 5. Aceptación de otro objeto

Pregunta entregada: «¿Le gustaría conocer la distribución del 605?». Cliente: «Sí, por favor».

La respuesta queda vinculada a los detalles de esa unidad. No autoriza una cita ni una revisión financiera. Para esas operaciones se requiere su propia interpretación actual de permiso y sus condiciones vigentes.

### 6. Autoría y alcance

«Mi hermano dijo que quiere reservar» y «Querría reservar si me aprueban el crédito» conservan su sentido de declaración ajena o condición pendiente. No se ejecutan como una solicitud propia de reserva inmediata.

Rechazar novedades sobre créditos tampoco equivale a solicitar la baja de todos los mensajes. El alcance se interpreta en el contrato; no se decide por encontrar la palabra «no».

## Archivos principales

- `src/lib/integrations/automation/turn-interpretation.ts`: extracción común, versión v4 y recuperación limitada del contrato.
- `action-authority.ts`, `turn-communication.ts` y `turn-routing-contract.ts`: significado y permisos estructurados.
- `visit-preference-contract.ts` y `visit-calendar.ts`: preferencia tipificada y calendario sin entrada de lenguaje natural.
- `conversation.ts`: uso del contrato compartido, pruebas de registro y ejecución de operaciones.
- `property-context.ts`, `turn-semantics.ts` y `catalog-reference.ts`: consultas y memoria mediante datos tipificados.
- `financing.ts`, `reservation-action.ts` y sus recibos: permisos independientes y referencias verificadas.
- `response-plan.ts`, `visit-intake-plan.ts`, `conversation-style.ts` y reglas de escritura: objetivo del mensaje y resultado operativo.
- `sdr.ts`: ruta v4 de hechos y recuperación de catálogo, con redacción final común.
- `lead-introduction.ts`, `response-openings.ts` y `response-plan.ts`: política de presentación desde metadatos y retiro de ajustes de cortesías e inferencias textuales de materiales.

## Migración pendiente

La migración de esta intervención es [20261017000000_typed_visit_preferences.sql](../../supabase/migrations/20261017000000_typed_visit_preferences.sql).

Reemplaza funciones de preferencias, acumulación y fuentes de citas; conserva las firmas antiguas de los analizadores de texto devolviendo que necesitan interpretación tipificada. Mantiene las fuentes originales visibles. Una transacción agrupa los cambios y la versión de compatibilidad. No crea solicitudes a partir de borradores existentes ni envía mensajes al ejecutarse.

El borrador local anterior `20261016233000_visit_intake_semantic_recovery.sql` se retiró de esta entrega: ampliaba un analizador de texto y quedó sustituido por el contrato v2. No se necesita aplicar ese borrador para aplicar esta migración. Las estructuras de citas que ya utiliza el proyecto deben existir; esta indicación no afirma que haya migraciones históricas pendientes en producción.

La aplicación del SQL, el despliegue y la comprobación con contactos autorizados son pasos separados. No se ejecutaron en esta intervención. La cita de la captura no se presenta como agendada retrospectivamente.

## Validación y límites

La verificación reproducible del contrato actual se ejecuta con `npm run test:conversation-contract`. Incluye normalización, permisos, consulta y memoria de inmuebles, redactor, esquemas, SQL aislado y casos seleccionados del controlador real. Los proveedores se simulan, la red se bloquea y se retiran credenciales del entorno de prueba. Sus resultados se guardan en `tmp/conversation-contract-validation/`.

El último pase del contrato actual aprobó **338 de 338 comprobaciones**: 322 en contratos, preparación, perfil, persistencia y SQL aislado, y 16 regresiones seleccionadas del controlador real. Las 16 regresiones no representan la totalidad de la integración. Incluyen saludos coloquiales, selección y precio simultáneos, reserva propia frente a condición o declaración ajena, aclaración tras la reserva del 605, elección relativa por baños y superficies, incompatibilidad SQL con derivación real, continuidad de fecha y hora y el recorrido de alternativas de vivienda con revisión activada y desactivada. Se adaptaron 39 pruebas históricas del intérprete al contrato actual, conservando comprobaciones de identidad, residencia, procedencia y permisos.

TypeScript (`tsc --noEmit`) terminó sin errores. ESLint sobre los 89 archivos TypeScript y CJS modificados o nuevos terminó con **0 errores y 0 advertencias**. `git diff --check` no detectó errores de formato. Estos controles no acreditan la calidad de una conversación con un modelo real.

La batería histórica completa sigue disponible con `npm run test:audit-corrections` y guarda su resultado en `tmp/audit-corrections/`. No se deben sumar ambas baterías como escenarios independientes porque comparten pruebas. Tampoco se deben presentar sus aserciones fallidas como una cantidad de defectos productivos.

El último pase general ejecutó **2.637 pruebas: 2.165 aprobadas y 472 fallidas**, sobre 213 archivos. El pase aislado del commit de referencia `cb37290bef5c8f961434e7994df1e9e06b25efc8` ejecutó 2.546: 2.545 aprobadas y una fallida, sobre 205 archivos. Los conjuntos no son idénticos porque se agregaron pruebas. La diferencia de resultados es material y no puede atribuirse por completo a un problema anterior al cambio.

Algunos fallos comprobados corresponden a contratos retirados: pruebas que esperaban reconocer saludos sin llamar al intérprete; permisos financieros en booleanos antiguos; lectura de frases de preguntas anteriores; fechas en `date_text/time_text`; inferencia de unidades desde números sin interpretación; y extracción de datos desde el texto del redactor. Otros casos necesitan revisar sus entradas, expectativas y comportamiento actual. **No se clasificaron individualmente los 472 fallos y no se afirma que todos sean obsoletos.** Los fallos de la batería general impiden declarar esta entrega lista para producción, aunque la aceptación específica esté aprobada.

El [registro de validación](validacion-interpretacion-y-continuidad-2026-10-16.json) conserva los cortes, comandos y cantidades. La salida completa del pase general queda en `tmp/audit-corrections/results.tap`; el resultado y los nombres de archivos, en `tmp/audit-corrections/result.json`.

### Trabajo que sigue pendiente

1. Adaptar los casos históricos al contrato v4 con decisiones de IA explícitas; conservar sus comprobaciones de catálogo, permisos y persistencia. No restaurar analizadores textuales para conseguir que pasen.
2. Revisar las diferencias restantes en integración general, selección y comparación, apertura, financiamiento, cobertura y materiales. Cuando una diferencia sea una regresión real, corregirla y repetir los recorridos afectados.
3. Cerrar la batería general y completar una prueba controlada con los modelos configurados; los resultados de proveedores simulados no acreditan interpretación ni redacción reales.
4. Preparar conjuntamente la migración de visitas y el despliegue compatible. La aplicación de SQL y el despliegue siguen pendientes; no se modificó ninguna solicitud histórica ni se agendó la cita de la captura.

La configuración de revisión permanece desactivada. El envío de renders adjuntos y las demás funcionalidades aplazadas no forman parte de este cierre local.

No se ejecutaron modelos reales ni se enviaron mensajes. Las pruebas no garantizan que la IA nunca interprete o redacte mal. La mejora esperada es retirar la segunda interpretación por vocabulario y conservar datos y permisos coherentes entre rutas. Con la IA revisora desactivada, estos cambios no agregan una comprobación semántica independiente del mensaje final.
