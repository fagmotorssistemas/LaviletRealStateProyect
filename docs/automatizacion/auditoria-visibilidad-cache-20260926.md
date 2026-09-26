# Visibilidad de respuestas, casos pendientes y caché

Revisión: 26/09/2026. Base: `22ad84f`, que ya contiene las correcciones de evidencia compartida. Esta ampliación cambia la auditoría y su visualización; no modifica la selección comercial del lead ni elimina los controles previos al envío.

## Caso «me gusta más la opción de 3 baños»

Ejecución `16eb0e8d-93ad-408a-a409-6c841ef20032`, 25/09/2026 a las 17:28, hora de Ecuador.

El extractor entregó `operation=select`, `unit_numbers=["605"]`, `reference_kind=explicit` y el ID correcto del penthouse 605. El cliente había nombrado un atributo, no el número 605. La comprobación de referencia explícita exige que ese número aparezca en el mensaje del cliente, por lo que la resolución terminó con `needs_clarification=true`, motivo `ambiguous`, cero candidatos.

La siguiente ruta `catalog_select` trató ese resultado como una búsqueda sin coincidencias. Así preparó la frase contradictoria «no contamos con penthouses de 3 dormitorios» seguida de alternativas de tres dormitorios. No era una prueba de falta de disponibilidad: había fallado la identificación de la opción elegida.

El redactor sí identificó el 605, pero se descartó por cuatro `invalid_unit_fact`, todos `unit_id_not_in_catalog`: dormitorios, baños y superficies interior/exterior. El catálogo usado entonces para validar no incluía la alternativa correcta.

Se reprodujo el texto histórico contra el código actual sin llamar al modelo ni enviar mensajes. La evidencia común ya incluye 602 y 605. Sin embargo, `validateCatalogReply` todavía devuelve `alternative_unit_list_premature`: la ruta incorrecta mantiene el contrato de presentación general de alternativas y rechaza nombrar una unidad.

**Conclusión:** las correcciones de evidencia solucionan la causa del rechazo interno, pero no bastan para resolver este recorrido completo. No se debe prometer que ahora contestará bien. La siguiente corrección funcional debe resolver selecciones por atributos sobre las opciones ofrecidas, distinguir ambigüedad de falta de disponibilidad y generar el contrato correspondiente a la selección. No basta con quitar la regla del listado: esa regla protege otros turnos donde todavía no se ha elegido una opción.

## Caso «presupuesto aproximado de 70 mil dólares»

Ejecución `51cb3671-8b41-43a9-9590-17992bb8a50b`, 25/09/2026 a las 17:40. La ruta fue `catalog_details`, con ambos penthouses. El borrador se descartó por seis citas no literales del revisor; se intentó reparar y se repitieron las mismas seis incidencias.

Las referencias de oraciones y reparación acotada del paquete anterior atacan ese problema de ficha. No garantizan que la ruta de detalles atienda correctamente el presupuesto. El texto completo de aquella propuesta aparece almacenado como `[contenido personal protegido]`; no se reconstruye ni se sustituye por una respuesta inventada.

## Cambio de visibilidad

Se elimina la regla que sustituía una respuesta completa por `[contenido personal protegido]` al encontrar palabras como presupuesto, capital o ahorros junto con cifras. También dejan de ocultarse por su nombre los campos estructurados `budget`, `presupuesto` y `initial_capital` en las capturas.

Las vistas previas de base, propuesta y respuesta final conservan hasta 1.500 caracteres, el máximo comercial admitido actualmente, en lugar de 1.000. Las capturas de entrada/salida siguen teniendo límites técnicos de tamaño; la interfaz informa cuando se alcanzan.

La ruta de lectura mantiene autenticación, rol administrador y aislamiento por tenant. Las credenciales, parámetros de enlaces y los identificadores personales continúan filtrados. Este cambio permite leer el texto comercial y su presupuesto; no expone claves de acceso.

Los registros antiguos que ya contienen el marcador no recuperan el original mediante esta modificación. La interfaz lo explica expresamente. Las capturas nuevas se benefician después del despliegue.

## Prompt caching: comprobación real

En las siete ejecuciones de Carlos recuperadas entre las 17:20 y las 18:00 del 25/09/2026 se observaron 34 llamadas con uso registrado:

| Dato | Resultado |
| --- | ---: |
| Tokens de entrada | 470.993 |
| Tokens de entrada reutilizados | 76.288 |
| Porcentaje reutilizado | 16,2 % |
| Llamadas sin dato de caché | 0 |

El registro procede de `usage.input_tokens_details.cached_tokens`, guardado como `token_usage.cached_input_tokens` por `ai-execution-trace.ts`. Es una muestra de esa conversación, no una tasa global ni un porcentaje de ahorro monetario.

`ai.ts` usa Responses API, instrucciones antes de los datos variables y no configura explícitamente `prompt_cache_key` ni retención extendida. Sí existe reutilización automática real. Según la [documentación oficial de OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching), la caché reutiliza prefijos idénticos y puede reducir coste y latencia; los tokens siguen formando parte de la entrada y de los límites de uso. No es una respuesta anterior almacenada que se devuelve al cliente.

La interfaz ahora muestra entrada, entrada reutilizada y salida en cada nodo de IA que conserva esos valores. No se cambia el modelo, la retención ni la composición del prompt para optimizar la caché en esta ampliación. Una optimización posterior puede estabilizar bloques compartidos y medir la diferencia antes/después.

## Archivos y ubicaciones

| Archivo | Ubicación | Cambio |
| --- | --- | --- |
| `src/lib/integrations/automation/trace-summary.ts` | `traceText`, líneas 9–22 | Ya no descarta el mensaje entero por su contenido financiero. |
| Mismo archivo | `sanitizeTraceSummary`, líneas 27–40 | Preserva presupuestos estructurados y textos de hasta 1.500 caracteres. |
| Mismo archivo | `sanitizePromptSnapshot`, líneas 50–56 | Preserva contexto presupuestario en entrada y salida de la IA. |
| `src/lib/integrations/automation/turn-completeness.ts` | llamadas `traceText` de base/propuesta/final/reparaciones | Aumenta las vistas previas de 1.000 a 1.500 caracteres. |
| `src/lib/integrations/automation/conversation.ts` | líneas 998, 1019, 1063 | Conserva las vistas previas completas de respuestas comerciales admitidas. |
| `src/components/inmobiliaria/automation/workflow/MessageTraceView.tsx` | líneas 166, 171–173 | Explica registros antiguos y muestra uso real de caché. |
| `src/lib/integrations/automation/execution-trace.test.ts` | pruebas de auditoría y nueva regresión de presupuesto | Comprueba persistencia, lectura, longitud y protección de credenciales. |

## Comprobaciones

- Auditoría: 12 pruebas aprobadas, incluida la conservación de una respuesta presupuestaria de más de 1.000 caracteres.
- Interfaz y API del flujo: 24 pruebas aprobadas.
- Conversación: 196 pruebas aprobadas.
- Compilación de producción local: aprobada.
- No se modificaron datos de producción ni se enviaron mensajes de prueba al lead durante esta auditoría.
