# Propuesta pendiente: bitácora comprensible para operación

Fecha: 22 de septiembre de 2026.
Estado: **planificada, sin implementar**. El usuario pidió conservar esta propuesta y posponer los cambios de la bitácora mientras se investigan las respuestas del bot.

## Problema reportado

El usuario encuentra los pasos por ejecución, pero no puede interpretar qué consultó cada nodo ni distinguir rápidamente si un problema procede del prompt, de los datos, de la memoria, de una plantilla o de un control posterior. Los nombres técnicos, cantidades e identificadores actuales no explican una decisión comercial.

Una ejecución puede agrupar varios mensajes consecutivos. Los pasos guardan resúmenes declarados por el código; no son una captura automática de todo lo que recibió el modelo o consultó el sistema. Un paso completado no prueba que su interpretación sea correcta.

## Presentación propuesta

Cada paso debe responder, con lenguaje sencillo y evidencia registrada, a estas preguntas:

1. **Qué información utilizó:** mensaje o fragmento pertinente, referente pendiente, filtros vigentes y fuentes consultadas. Distinguir información observada de información ausente.
2. **Qué encontró:** unidades con su número y categoría, atributos relevantes, datos faltantes y cantidad de resultados. Evitar mostrar solamente IDs internos.
3. **Qué decidió y por qué:** acción concreta y motivo registrado; explicar qué dato o regla produjo la decisión. No generar retrospectivamente un motivo que nunca se guardó.
4. **Qué respuesta salió:** distinguir plantilla base, propuesta de redacción, rechazo por validación, respuesta de respaldo y texto finalmente enviado cuando esas evidencias estén disponibles.
5. **Qué revisar:** indicar si el origen está en datos, memoria/filtros, interpretación, plantilla, redacción, validación, derivación o transporte; enlazar el ajuste editable cuando exista.

Los detalles técnicos deben permanecer disponibles en una sección secundaria. La explicación principal debe servir a un administrador sin conocimiento del código.

## Ejemplo ilustrativo, no ejecución observada

Mensaje: «Sí, prefiero esa opción».

- Pregunta anterior: ofrecía los detalles del departamento 502.
- Interpretación: acepta ver esos detalles.
- Referente: departamento 502.
- Decisión: presentar la unidad, sin pedir nuevamente su número.
- Si hay un desacuerdo: identificar el primer paso donde se perdió o cambió ese referente.

## Evidencia que falta o requiere mejorar

- Identidad de todas las instrucciones realmente ejecutadas, no solo las del extractor. Separar prompt editable de reglas añadidas por código y configuración de estilo.
- Cambios de memoria: filtros anteriores, filtros propuestos y filtros efectivos, incluyendo la aceptación de una alternativa ofrecida.
- Fuente de cada respuesta: plantilla, generación, revisión y recuperación tras un rechazo.
- Motivo específico de derivación: solicitud explícita del cliente frente a dato concreto que el sistema considera ausente; resultado real de la operación.
- Referencias comerciales legibles junto a los IDs del catálogo, con valores históricos de esa ejecución cuando sea necesario.
- Agrupación por conversación y mensajes procesados juntos, conservando versiones y orden temporal.

Estas evidencias deben añadirse de forma acotada y sanitizada. No guardar credenciales, datos financieros personales o documentos completos. No sustituir el historial protegido de conversación ni exponer indiscriminadamente prompts o cuerpos de proveedores.

## Criterios de aceptación futuros

- Un administrador puede distinguir una mala interpretación de un filtro perdido y de una respuesta restaurada por un validador.
- Puede identificar qué ajuste controla la respuesta y cuándo el guion editable no intervino en esa ruta.
- «Completado» se presenta como estado técnico, sin certificar calidad conversacional.
- Los pasos ausentes, las rutas inferidas y los errores de lectura/guardado se explican sin inventar resultados.
- La aceptación de Kommo continúa separada de la entrega y lectura de WhatsApp.
- El historial antiguo no se presenta como si contuviera evidencias que no se registraron.

No se modifican la interfaz, la instrumentación ni el comportamiento del bot al guardar este documento.

## Propuesta visual revisada con la captura del usuario

La captura posterior muestra `catalog_compare`, una consulta residencial de departamentos sin restricción de dormitorios/planta, siete identificadores de resultados, ninguna pregunta pendiente y `coverage_locked=false`. Ese último campo significa que la revisión posterior está permitida; no acredita falta de datos ni explica un traspaso. El nodo capturado no es `advisor_handoff`.

Se preparó una propuesta interactiva en `propuestas/recorrido-por-mensaje.html`, sin integración con la aplicación ni conexión a producción. Usa mensajes del chat, datos visibles en la captura y reproducciones locales, identificando la procedencia en cada paso. Las etapas son una composición de la vista propuesta; no se presentan como una transcripción de pasos observados en producción.

### Organización de la futura pantalla

- Elegir una conversación y un mensaje o lote, conservando el vínculo con la ejecución real.
- Ver un recorrido breve por responsabilidades: mensaje, interpretación, búsqueda, decisión, revisión, acción, envío y memoria; mostrar solo lo observado al consultar una ejecución real.
- Abrir un paso y leer datos utilizados, resultado, motivo y ajuste responsable. Mostrar los nombres comerciales antes que los UUID.
- Permitir recorrer el motivo desde una decisión hasta la evidencia que la activó, sin confundir proximidad temporal con causalidad. Instrumentar referencias explícitas entre decisiones y acciones.
- Mantener IDs, módulos, versiones y campos originales en detalles técnicos desplegables.

### Ficha específica de derivación

1. Quién o qué la originó: petición del cliente, revisión de cobertura u operación fallida, respaldado por la ejecución.
2. Motivo registrado y fragmento concreto de la consulta considerado pendiente.
3. Condición o regla que autorizó la acción, con identificador estable y versión.
4. Datos consultados y resultado de contrastar el supuesto faltante con ellos.
5. Resultado operativo: en cola, asignado, reconocido o fallido; existencia de asesor asignado y estado del bot.

La vista debe enlazar al paso `advisor_handoff` de la misma ejecución, respetando su orden real y contemplando varios traspasos. Si falta el registro, indicar que no hay evidencia suficiente para confirmar la acción. No convertir la frase enviada por el bot en prueba del resultado de la operación.

### Alcance recomendado para implementar

- Corregir los defectos de continuidad y respuesta documentados en el diagnóstico, con pruebas de conversación que comprueben el avance y la ausencia de derivaciones innecesarias.
- Registrar cada decisión relevante con un contrato común: origen, condición evaluada, evidencia, estado anterior/posterior, resultado y referencia a la acción siguiente. No hace falta exponer cada función interna.
- Construir la vista por mensaje sobre esos registros. Enlazar directamente al ajuste del panel cuando exista; identificar las reglas que requieren una modificación de código.
- No usar una IA para inventar retrospectivamente la explicación de una decisión. La explicación debe derivarse de evidencia registrada, con ausencia explícita si falta.

La propuesta sigue pendiente de implementación en la aplicación.
