# Propuesta pendiente y comparación con investigación — 23/09/2026

Estado: documento de análisis; no implementa cambios en automatización. Fuente del usuario: adjunto 1018ff16-705a-4c61-93a4-b68132ff9cca/Pasted text.txt.

Actualización: se implementó una primera etapa posterior a esta comparación. Alcance, respaldo y límites en [recuperacion-y-validacion-semantica.md](recuperacion-y-validacion-semantica.md). La unificación de llamadas, NLI local y marcadores generales siguen aplazados.

## Propuesta conservada

1. Decidir la apertura con la regla antirrepetición antes de redactar; comunicar la decisión al redactor y conservarla al finalizar.
2. Separar preferencia recordada, restricciones obligatorias y alcance de la consulta actual. No borrar filtros indiscriminadamente. Caso Carlos: después de no encontrar cinco dormitorios, «cuál es la vivienda más espaciosa» debe poder consultar el máximo disponible sin reaplicar automáticamente cinco dormitorios.
3. Reutilizar el revisor de IA existente para identificar afirmaciones, entidad, atributo, polaridad y evidencia. Comprobar tanto respaldo como pertinencia. No aceptar neutralidad como prueba de veracidad.
4. Mantener consultas, controles numéricos, asociaciones unidad-atributo, enlaces y acciones en código. Retirar gradualmente controles lingüísticos frágiles solo tras evaluar sustitutos.
5. Mantener reparación acotada y respuesta base de respaldo, sin presumir que esa base siempre es correcta.
6. Evaluar marcadores por unidad y atributo para precios y enlaces; comprobar asociación y significado, no solo presencia. NLI local queda como experimento posterior, no requisito inicial ni garantía.

## Comparación con el código actual

| Elemento | Estado actual |
| --- | --- |
| Extracción estructurada | Existe: ai.ts usa JSON Schema estricto cuando se proporciona esquema; interpretación semántica del turno. |
| Fusión con memoria | Existe: property-context.ts conserva filtros anteriores; hay fallos de alcance observados. |
| Consulta determinista | Existe: catálogo y rutas de precios consultados/procesados por código. No equivale a un agente que siempre elija herramientas mediante function calling. |
| Respuesta base | Existe: catalog-dialogue.ts, commercial-experience.ts y otras rutas. Puede heredar una consulta incorrecta. |
| Redactor | Existe: response-plan.ts y turn-completeness.ts; devuelve reply, requests y question. |
| Revisor IA | Existe, condicional: turn-completeness.ts usa REVIEW_RULES y reviewSchema. Devuelve veredictos generales y faltantes, no un inventario completo de afirmaciones con evidencia. Usa el modelo configurado compartido, no diversidad de modelos garantizada. |
| Controles deterministas | Existen: superficies, dormitorios, unidades, precios, enlaces, pregunta protegida; algunos analizan prosa mediante regex. |
| Marcadores SLOT e inyección final general | No implementados como arquitectura general; actualmente se pasa prosa con cifras reales y material protegido. |
| Clasificador NLI local | No identificado en el flujo auditado. |
| Recuperación | Existe base de respaldo y reintento limitado para metadatos; algunas rutas de precios también reparan controles de contenido. No reintenta todos los rechazos de catálogo. |
| Evaluaciones | Existen pruebas de conversación e integración y bitácora; no se ha implementado el monitoreo continuo de producción previamente aplazado. |
| Costos por ejecución | aiJson no conserva response.usage en el registro revisado; la traza muestra duración/modelo, insuficientes para calcular dólares por turno. |

## Correcciones a la investigación

- La validación determinista no exige eliminar prosa libre: puede validar campos y resultados de una respuesta natural.
- JSON válido no garantiza hechos válidos; no depende únicamente de temperatura.
- Preservar SLOT_PRECIO_1 no impide asociarlo a otra unidad o cambiar «no disponible» a «disponible». Slots reducen errores, no garantizan cero alucinaciones.
- NLI neutral significa que no se deduce la hipótesis de la premisa; no debe aprobarse automáticamente para afirmaciones comerciales. Entailment va de la premisa a la hipótesis. Es una clasificación aprendida, no demostración matemática.
- Un 10% de contradicción no es un umbral universal ni necesariamente una probabilidad calibrada. Se evalúa con español y casos del proyecto.
- DeBERTa-v3-small base no es directamente un clasificador NLI especializado en español. Se requiere modelo adecuado y pruebas.
- Las latencias y multiplicadores de costo aportados no están demostrados para este sistema; dependen de hardware, tamaño de entrada, proveedor y carga.
- FACTS Grounding es un benchmark con jueces de modelos, no prueba de que empresas citadas usen exactamente slots + NLI en producción.
- Un fallback puede ser fiel a una consulta equivocada: Carlos mostró que una base repetitiva no se corrige por verificar fidelidad a ella.

## Costo y ejecución gradual

Aperturas y fusión de filtros pueden cambiarse sin añadir llamadas. Ampliar el revisor existente puede mantener el número de llamadas en turnos que ya se revisan, pero aumenta tokens de instrucciones/evidencias/resultados. Activarlo en rutas antes omitidas sí añade una llamada. Una reparación añade costo solo cuando ocurre. No prometer un porcentaje sin medición.

Medir entrada, salida y caché por tarea, número de reparaciones, rechazo correcto/falso y latencia. Costo incremental promedio = incremento del revisor + frecuencia de reparación por costo de reparación + nuevas llamadas habilitadas; sumar infraestructura si se experimenta con NLI local. No se necesita VPS para reutilizar el revisor actual. Un NLI alojado añade operación y cómputo, aunque no cobre tokens de la API actual.

Antes de sustituir controles: evaluar negaciones equivalentes, afirmaciones falsas, unidades/precios intercambiados, omisiones y cambios de alcance en conversaciones completas. Comparar en pruebas o modo observación antes de afectar envíos. No cambiar todos los controles simultáneamente.

## Fuentes primarias contrastadas

- https://deepmind.google/blog/facts-grounding-a-new-benchmark-for-evaluating-the-factuality-of-large-language-models/
- https://huggingface.co/microsoft/deberta-v3-small
- https://deepmind.google/research/publications/85420/ (SAFE: descomposición y evaluación de hechos; no prueba de la arquitectura inmobiliaria descrita).

No se verificaron como hechos las atribuciones genéricas a NVIDIA/Guardrails del adjunto: no incluye referencias concretas que respalden la implementación exacta descrita.
