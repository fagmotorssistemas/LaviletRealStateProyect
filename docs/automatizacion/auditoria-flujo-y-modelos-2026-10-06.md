**Auditoría de la automatización y del costo del redactor**

> Corte histórico del 6 de octubre de 2026. Varias brechas de esta auditoría se corrigieron después. Consulte el [cambio del extractor y la validación del 7 de octubre](cambio-extractor-mini-2026-10-07.md) para el estado del código preparado y las limitaciones de publicación.

Fecha: 6 de octubre de 2026. La automatización todavía tiene brechas verificables de validación, memoria y transporte. El redactor ya utiliza GPT-4.1 mini en las últimas ejecuciones registradas. Cambiarlo por otro modelo más barato sólo afecta una parte del costo restante; la mayor parte corresponde al extractor y las revisiones.

La auditoría combina el código local actual, reproducciones controladas sin inferencia pagada y una lectura de la bitácora y configuración de producción. La lectura remota no ejecutó operaciones de CRM, RPC de negocio ni escrituras. El código local tiene cambios sin publicar. La última ejecución consultada usa fc57d24 y termina el 6 de octubre a las 18:01, hora de Bogotá; esa observación no acredita un despliegue posterior sin tráfico.

Una comprobación reproducible de helpers demuestra una brecha del código; no demuestra que un lead concreto la haya sufrido. Los resultados que dependen de SQL corresponden a las migraciones del repositorio y deben contrastarse con las definiciones desplegadas. Los replays con redactor y revisor simulados comprueban qué acepta el servidor cuando esos agentes se equivocan.

Los últimos cambios implementaron el orden comercial en el plan y las instrucciones. Sin embargo, la obligación de presentar unidades todavía no se verifica de forma independiente. Por eso aprobar las pruebas positivas no basta para concluir que todas esas reglas quedaron impuestas en la entrega.

**Estado registrado y costo**

| Función | Modelo registrado | Costo en 14 turnos con llamadas de IA medidas | Parte del costo |
| --- | --- | ---: | ---: |
| Clasificador | gpt-4o-mini | USD 0,00348960 | 0,54 % |
| Extractor | gpt-4.1 | USD 0,40910400 | 63,51 % |
| Redactor | gpt-4.1-mini | USD 0,11061040 | 17,17 % |
| Revisor | gpt-5-mini | USD 0,12096355 | 18,78 % |
| Total | 65 llamadas registradas | USD 0,64416755 | 100 % |

Esta muestra agrupa 14 turnos con redactor mini y uso disponible para sus llamadas; no acredita todo el recorrido hasta WhatsApp. No es el gasto de toda la cuenta ni desde la última recarga. Se deduplicaron los pasos de lotes agrupados y se excluyeron los turnos con redactor GPT-4.1. La muestra de mini contiene cuatro versiones de código; no es un benchmark exclusivo de fc57d24. Los dólares se calculan con las tarifas guardadas sobre tokens informados por la API; no son una factura. La transcripción de audio, servicios externos y creación inicial del índice no están en este total.

La configuración leída tiene revisión y embeddings activados. La automatización está habilitada y limitada a contactos de pruebas. Esto limita quién recibe automatización; no significa que las políticas comerciales deban ser exclusivas de pruebas.

El modelo se decide por función y variables del servidor, no por el texto editable del prompt. La configuración local tampoco contiene un reemplazo del modelo del redactor. Referencias: [ai-model-routing.ts](../../src/lib/integrations/automation/ai-model-routing.ts), [ai.ts](../../src/lib/integrations/automation/ai.ts), [executionCost.ts](../../src/components/inmobiliaria/automation/workflow/executionCost.ts).

La última ejecución costó USD 0,03631425. El redactor consumió USD 0,0062 y tardó 2,531 segundos; el extractor tardó 7,869 segundos. Dos llamadas al revisor tardaron 15,299 y 15,788 segundos, sumando 31,087 segundos. La bitácora confirma que la segunda reparó cinco problemas de metadatos de la propia revisión. No fue otra redacción ni un reintento HTTP. El recorrido de IA duró 44,609 segundos, sin contar agrupación y envío.

En la lectura más amplia también aparece un fallo del extractor el 6 de octubre a las 17:16, hora de Bogotá: OPENAI_HTTP_429_CREDIT_BALANCE_EXHAUSTED. Es evidencia de falta de saldo disponible para esa llamada en ese momento; no acredita el saldo actual ni explica automáticamente otros fallos. Las 115 llamadas deduplicadas consultadas registran un intento de transporte por llamada; las revisiones adicionales son llamadas distintas, no reintentos HTTP ocultos.

**Brechas de conversación y memoria**

| Prioridad | Condición reproducida | Efecto | Corrección general |
| --- | --- | --- | --- |
| Alta | Revisión desactivada | La rama que acepta el borrador sólo valida texto no vacío y longitud; los otros controles operativos del servidor siguen presentes. Puede entregar datos falsos, enlaces no autorizados, ausencia de brochure o de siguiente pregunta. Las pruebas actuales aceptan expresamente ese comportamiento. | Separar la revisión con modelo de los controles obligatorios del servidor. Mantener verificaciones gratuitas de hechos, enlaces, consentimiento y continuidad aunque no se consulte al revisor. |
| Alta | Tipo y planta definidos; redactor pregunta presupuesto sin mostrar unidades; revisor simulado aprueba | La respuesta queda checked con final_validation.passed=true, aunque requires_unit_presentation=true y no aparece ninguna unidad. | Exigir una presentación verificable de las unidades y sus características antes de admitir la pregunta de presupuesto. El aprobado del modelo no debe eliminar esta obligación. |
| Alta | JEP se desactiva, pero un expediente conserva selected_partner_name=JEP | La recopilación puede continuar pidiendo cédula para una entidad deshabilitada. La preferencia recordada sí se invalida; el expediente no recibe la misma comprobación. | Revalidar la entidad vigente antes de recopilar o derivar. Conservar el expediente y obtener una nueva elección cuando corresponda. Comprobar también en SQL antes de operar. |
| Media | Visita guardada como confirmed; el contexto operativo ya no devuelve propuestas activas | La memoria conserva confirmed y la consulta inmobiliaria queda en visit_suspended_for_current_query sin pregunta siguiente. | Conciliar la memoria con la cita vigente, su fecha y estado. Caducar la coordinación terminada conservando el historial. |
| Media | Cinco dormitorios y planta 10; ningún cambio individual produce una alternativa | Se pregunta si acepta ajustar ese requisito sin una proposed_query concreta. Un sí conserva los filtros y vuelve a producir la misma pregunta. | Identificar las restricciones incompatibles y preguntar cuál puede cambiar. Pedir aceptación sólo cuando exista una propuesta verificable. |
| Media | Respuesta enumera los departamentos 202 y 205 | El reconocimiento de unidades presentadas sólo registra 205. Puede repetir la ficha de 202 y perder la coherencia del siguiente paso. | Interpretar listas completas, validar cada código contra su categoría y mantener separados presentación, candidatos y selección. |

Referencias de implementación: [response-review-policy.ts](../../src/lib/integrations/automation/response-review-policy.ts), [response-review-policy.test.ts](../../src/lib/integrations/automation/response-review-policy.test.ts), [turn-completeness.ts](../../src/lib/integrations/automation/turn-completeness.ts), [commercial-journey.ts](../../src/lib/integrations/automation/commercial-journey.ts), [financing-intake.ts](../../src/lib/integrations/automation/financing-intake.ts), [financing-stage.ts](../../src/lib/integrations/automation/financing-stage.ts), [visit-dialogue.ts](../../src/lib/integrations/automation/visit-dialogue.ts), [property-context.ts](../../src/lib/integrations/automation/property-context.ts), [SQL de identidad financiera](../../supabase/migrations/20261004190000_financing_identity_intake.sql).

La reproducción local de las cinco últimas filas está en [automation-audit-conversation-repro.cjs](../../tmp/automation-audit-conversation-repro.cjs). Se ejecuta con node y utiliza un generador simulado. La prueba de revisión desactivada se ejecuta con el cargador TypeScript y response-review-policy.test.ts: ocho pruebas aprobadas que confirman el comportamiento descrito.

**Brechas de transporte y programación**

| Prioridad y evidencia | Condición | Efecto y solución |
| --- | --- | --- |
| Alta, reproducida localmente | Dos contactos del mismo lead obtienen bloqueos diferentes | El campo RESPUESTA IA y el lanzamiento de Salesbot se comparten por lead. Dos pipelines PATCH y POST pueden lanzar ambos con la segunda respuesta. El destinatario efectivo no se verificó contra Kommo. Coordinar los recursos compartidos y vincular contenido y envío al turno y destinatario; la exclusión por contacto no basta. |
| Alta, reproducida localmente | Entrega uncertain por timeout o interrupción; luego llega respuesta manual | El contacto sigue bloqueado. La interfaz revisa cancelled y sólo ciertas incertidumbres de cuenta se liberan. Falta una reconciliación asistida para confirmar en Kommo si se envió y resolver el bloqueo con evidencia, manteniendo la protección contra duplicados. |
| Alta bajo carga continua, exclusión comprobada | Siempre hay algún worker por contacto activo al llegar el cron | El worker global no puede adquirir bloqueo. Sólo éste procesa mantenimiento, visitas, nutrición y outbox abandonados. Separar tareas independientes y garantizar progreso con retraso máximo; HTTP 200 con processed=0 no demuestra trabajo completado. |
| Media, reproducida localmente | Mensaje manual sin entity_id | El normalizador usa kommoId=0; SQL resuelve el lead real, pero el wakeup conserva 0:contacto y no encuentra el evento real. Usar la identidad resuelta al persistir y programar. |
| Media o alta según mensaje, reproducida localmente | Dos mensajes contradictorios dentro del mismo segundo | Se pierde la precisión de sec_created_at cuando existe created_at. El desempate por ID externo puede invertir No y Sí y cambiar el mensaje efectivo. Conservar precisión temporal y un orden de recepción verificable. |
| Media, reproducida localmente | Lote de 101 mensajes | El normalizador permite hasta 200; la recepción SQL permite 100. El lote válido se rechaza completo y repetirlo no lo resuelve. Unificar límites o dividir la persistencia de forma idempotente. |
| Riesgo condicionado, coordinación ausente comprobada | Workers distribuidos llaman a Kommo simultáneamente | El limitador sólo coordina un proceso. No se demostró un exceso real de cuota. Añadir coordinación global y probar 429 con varios procesos sin repetir escrituras inciertas. |

Referencias: [SQL de workers](../../supabase/migrations/20261005200000_conversation_workers.sql), [worker.ts](../../src/lib/integrations/automation/worker.ts), [kommo.ts](../../src/lib/integrations/automation/kommo.ts), [conversation.ts](../../src/lib/integrations/automation/conversation.ts), [delivery-state.ts](../../src/lib/integrations/automation/delivery-state.ts), [webhook.ts](../../src/lib/integrations/automation/webhook.ts), [ruta webhook](../../src/app/api/integrations/kommo/webhook/route.ts), [SQL de atención manual](../../supabase/migrations/20260920120000_advisor_manual_takeover_notifications.sql), [SQL de reanudación](../../supabase/migrations/20261005183000_explicit_bot_resume.sql).

Las reproducciones usaron PGlite y fetch simulado. Veinte pruebas focales existentes de workers, entrega, programación y atención manual pasan, pero no cubren estas combinaciones. Las pruebas deben verificar identidad compartida, progreso bajo carga, salida segura de incertidumbre, orden temporal y coherencia de límites entre webhook y SQL.

**Qué sigue encareciendo los prompts**

En las 16 llamadas reales del redactor mini, el promedio fue 33.639 caracteres de instrucciones y 39.964 de contexto; el total medio fue 76.478 y el máximo 98.484. El costo medio registrado por llamada fue USD 0,006913 y la duración media 3,34 segundos. Una respuesta puede usar más de una llamada: dos de los 14 turnos necesitaron dos redactores y tres revisiones. Otros tres usaron un redactor y dos revisiones.

La captura local actual, sin API ni DB, muestra un extractor con aproximadamente 44.773 caracteres de instrucciones y 13.810 de esquema incluso cuando el contexto sólo ocupa 457 caracteres. El redactor conserva entre aproximadamente 58.000 y 63.000 caracteres en los fixtures medidos. Estos tamaños locales utilizan el prompt del archivo y el tono predeterminado; no reemplazan las mediciones reales de la bitácora.

La reducción histórica activa eliminó un ejemplo JSON redundante del extractor y redujo la entrada aproximadamente 4,8 % en esa evaluación. La deduplicación adicional shared-turn-state-v1 sigue apagada porque una prueba real confundió superficies entre categorías. No es correcto considerar aplicada esa reducción experimental. Fuentes: [validación histórica](../automation/prompt-compaction-validation-2026-10-06.json), [turn-prompt-context.ts](../../src/lib/integrations/automation/turn-prompt-context.ts).

Hay dos acoplamientos del ahorro al interruptor de embeddings. En sdr.ts, desactivar embeddings con revisión activada puede volver a generar un borrador provisional antes del redactor final. En financing-prompt.ts, el extractor financiero compacto depende también del mismo interruptor. La tarea, el consentimiento y el estado del turno deben decidir estas optimizaciones. Desactivar vectores no debería añadir redacciones ni restaurar instrucciones innecesarias. Referencias: [sdr.ts](../../src/lib/integrations/automation/sdr.ts), [financing-prompt.ts](../../src/lib/integrations/automation/financing-prompt.ts).

El recorte más prometedor conserva una representación única de la necesidad actual, la pregunta realmente entregada, preferencias conocidas, obligaciones, fuentes comerciales pertinentes, unidades con sus atributos, enlaces autorizados y recibos operativos. Debe eliminar copias redundantes de esos datos y separar instrucciones por tarea. El extractor interpreta; no necesita todas las instrucciones de presentación del redactor. El redactor redacta; no debe recibir todo el historial operativo si éste no afecta su respuesta. Los casos compuestos y las relaciones categoría, unidad, superficie y precio deben sobrevivir al recorte.

La caché puede abaratar instrucciones repetidas, pero no garantiza idéntica respuesta ni compensa contexto innecesario. Las instrucciones y esquemas estables deben preceder al estado dinámico. La tasa de caché debe medirse por agente y tarea. [Documentación oficial de prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

**Embeddings y búsquedas exactas**

En 44 pasos únicos de recuperación del conjunto consultado hubo 29 rutas de catálogo completo, 14 consultas exactas optimizadas y una búsqueda con embeddings. La consulta con embeddings del 5 de octubre consumió 17 tokens y tardó 433 milisegundos. Hay uso real; es poco frecuente en esta muestra.

Actualmente los vectores ordenan coincidencias ya verificadas cuando el mensaje contiene preferencias semánticas. Categorías, precios, plantas y dormitorios pueden resolverse sin vectores. Las 14 consultas exactas sí optimizaron el catálogo. Entre los retornos completos hubo interpretación incierta, consulta estructurada ausente y referente no resuelto. Corregir la construcción y resolución de la consulta puede reducir contexto aunque no se hagan embeddings. Forzarlos en todos los mensajes añade una consulta sin garantizar ahorro. Referencias: [catalog-embeddings.ts](../../src/lib/integrations/automation/catalog-embeddings.ts), [resolved-catalog-query.ts](../../src/lib/integrations/automation/resolved-catalog-query.ts).

**Evaluación de otro modelo para el redactor**

| Modelo | Entrada USD por millón | Entrada en caché | Salida | Evaluación para esta aplicación |
| --- | ---: | ---: | ---: | --- |
| GPT-4.1 | 2,00 | 0,50 | 8,00 | Modelo anterior; no es el redactor de las últimas ejecuciones. |
| GPT-4.1 mini | 0,40 | 0,10 | 1,60 | Redactor actual; mantener como referencia de comparación. |
| GPT-4o mini | 0,15 | 0,075 | 0,60 | Candidato para prueba de menor costo; calidad de este flujo aún no evaluada. |
| GPT-5.4 nano | 0,20 | 0,02 | 1,25 | Candidato adicional; requiere prueba de calidad y registro de tarifa en el panel. |
| GPT-5.4 mini | 0,75 | 0,075 | 4,50 | Entrada sin caché y salida más caras; caché más barata. No abarata la mezcla de uso de esta muestra. |

Tarifas estándar consultadas el 6 de octubre en las páginas oficiales: [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [GPT-4o mini](https://developers.openai.com/api/docs/models/gpt-4o-mini), [GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano), [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini). La compatibilidad de Responses y Structured Outputs permite plantear la prueba; no acredita el acceso particular de la cuenta ni la calidad comercial. El panel actual sólo conoce las tarifas de sus modelos existentes y mostraría una estimación incompleta para un modelo nuevo sin tarifa.

Con los mismos tokens, caché y número de intentos de los 14 turnos, GPT-4o mini produciría un costo matemático de USD 0,57630325 frente a USD 0,64416755: una reducción total de 10,54 %. GPT-5.4 nano produciría USD 0,58962204: 8,47 %. Son escenarios recalculados, no evaluaciones reales de esos modelos. Más errores, redacciones repetidas o revisiones pueden absorber el ahorro.

La prueba histórica de GPT-4.1 mini sólo contiene tres casos sintéticos. El revisor aprobó una respuesta que afirmaba ser ideal para familias numerosas, mientras la evaluación manual detectó una afirmación no respaldada. La comparación con GPT-4.1 terminó inconclusa por truncamiento del revisor. Sus totales no permiten demostrar ahorro agregado ni igualdad de calidad. Fuente: [writer-mini-trial-2026-10-06.json](../automation/writer-mini-trial-2026-10-06.json).

El revisor registrado usa GPT-5 mini, que la página oficial consultada marca como deprecated. Su sustitución requiere una evaluación propia y no debe mezclarse con el ensayo del redactor. [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini).

**Orden recomendado de trabajo**

1. Cerrar las brechas de entrega y recursos compartidos: controles obligatorios con revisión desactivada, presentación de unidades, envío por lead/contacto e incertidumbre reconciliable.
2. Corregir memoria y estado vigente: banco habilitado, visita terminada, listas de unidades y ajustes con propuesta concreta.
3. Asegurar coherencia de webhook y workers: identidad resuelta, orden temporal, límites de lote y progreso de tareas bajo carga.
4. Separar el ahorro del interruptor de embeddings, eliminar borradores redundantes y medir las reparaciones del revisor.
5. Preparar instrucciones por tarea y contexto sin duplicación; comparar antes y después manteniendo todas las reglas y evidencia.
6. Comparar GPT-4.1 mini con candidatos en un entorno aislado, con los mismos estados iniciales y catálogo. Mantener extractor y revisión iguales para atribuir diferencias.
7. Publicar sólo el cambio que cumpla calidad y ahorro medidos; comprobar el modelo y versión realmente registrados después del despliegue.

La evaluación propuesta debe incluir 100 a 150 escenarios representativos, conversaciones completas y variantes repetidas. Debe cubrir nombre parcial y rechazo, origen frente a residencia, brochure pedido y diferido, cinco dormitorios indispensables o flexibles, aceptación ambigua, elección tipo y planta, unidades, precios referidos, presupuesto aproximado y conocido, financiamiento JEP/Pichincha y desactivación, reservas y descuentos vigentes, oficina en el lugar del proyecto, citas terminadas, múltiples mensajes, audio ilegible, cambio de tema, opt-out y recuperación tras errores.

Deben evaluarse redactor equivocado y revisor que aprueba por error, además de propuestas correctas. No se exige redacción literal; se comprueban respuesta, hechos, enlaces, siguiente decisión y consentimiento. Los errores críticos no se aceptan en la muestra. Se comparan omisiones, preguntas innecesarias, cambios no autorizados, satisfacción comercial, reescrituras, revisiones adicionales, costo por respuesta correcta y latencia mediana y percentil 95. Este umbral es una propuesta para el proyecto, no una garantía estadística universal.

Las pruebas locales actuales no consumen créditos del bot. Una evaluación con candidatos reales sí consume tokens y debe tener un presupuesto explícito; este análisis no ejecutó esa evaluación. La práctica de comparar datos representativos y contrastar las evaluaciones automáticas con valoración humana sigue la [documentación oficial de evaluaciones](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

Evidencia conservada junto al informe: [cálculos por modelo y captura local sin datos de leads](auditoria-flujo-y-modelos-2026-10-06-evidencia.json). En este workspace también están la [lectura remota resumida](../../tmp/complete-runtime-audit-readonly.json) y las [reproducciones conversacionales](../../tmp/automation-audit-conversation-repro.cjs); esos dos archivos temporales no se incluyen en Git. Este informe propone correcciones; no cambia modelos, SQL ni comportamiento de producción.
