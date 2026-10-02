# Correcciones de presupuesto y financiamiento

Estado: implementadas en el código local el 2 de octubre de 2026, después de la autorización del usuario. Pendientes de commit y despliegue. No se modificó la base de datos de producción ni se enviaron mensajes de prueba a clientes.

## Fallos observados

En la conversación analizada, el lead envió «quiero saber como funciona el financiaeminto» a las 12:44:55 y «y cuanto deberia ajustar» a las 12:45:17, hora de Colombia. El presupuesto confirmado previamente era de 100000 dólares, después de corregir «100» mediante «perdon 100000».

La extracción del primer mensaje agotó 45 segundos: un intento de aproximadamente 30 segundos y otro de 14 segundos. No llegó al redactor. El evento terminó como `superseded_or_paused`; durante su procesamiento había llegado el segundo mensaje. Esa etiqueta por sí sola no distingue todas las condiciones que pueden detener la respuesta.

En el segundo mensaje, el primer redactor usó correctamente el presupuesto anterior y calculó diferencias de 45000 dólares frente al local de 145000 y de 110000 frente a la suite de 210000. La IA revisora aprobó ese borrador. Después, el control numérico del sistema rechazó 45000, 100000 y 110000 porque no estaban entre sus valores admitidos: no recibía el presupuesto recordado ni las diferencias como hechos calculados autorizados.

El segundo borrador eliminó esas cifras. La segunda revisión lo rechazó porque afirmó que el presupuesto no alcanzaba, pero el contexto de esa revisión no incluía el presupuesto confirmado. El turno terminó en recuperación con asesor. La oferta de un contacto no figura como motivo de rechazo.

## Cambios implementados

1. **Plazos y recuperación del extractor.** Dos intentos de hasta 30 segundos, 65 segundos totales y un mínimo de 30 segundos disponibles para iniciar el reintento, respetando el plazo global. Antes de cada petición o reintento se comprueba si llegó un mensaje más reciente; en ese caso se detiene esa inferencia y se conservan los mensajes registrados para el próximo turno. La comprobación sucede entre peticiones, no interrumpe inmediatamente una petición ya en curso. Se mantiene la proyección compacta existente del extractor y la lectura de consultas pendientes solo trae los recibos necesarios, no todos los diagnósticos anteriores. El timeout observado no demuestra una interpretación semántica incorrecta ni identifica la causa de la lentitud del proveedor.
2. **Conservar las consultas sin respuesta.** Una consulta de financiamiento pendiente debe acompañar al mensaje posterior sobre cuánto ajustar. Si el primer extractor no produjo salida, conservar también el mensaje original para que la siguiente interpretación pueda identificar su solicitud. Gestionar resolución, sustitución y cancelación de solicitudes; cerrar una solicitud atendida después de que su respuesta sea aceptada por el canal de envío, sin repetirla indefinidamente. Aumentar únicamente los cinco segundos de agrupación no resuelve este problema.
3. **Compartir el presupuesto efectivo.** Combinar el estado confirmado con las novedades del turno y entregar el mismo resultado al redactor, al revisor y al control numérico. `not_discussed` no debe borrar un presupuesto conocido. Una corrección válida debe sustituirlo. Diferenciar presupuesto total, entrada y cuota mensual; conservar procedencia y estado de confirmación. No obligar al extractor a inventar evidencia actual para un importe declarado antes.
4. **Sustituir el rastreo de cifras en la prosa por comprobaciones de datos extraídos por el revisor.** Eliminar `unverifiedHardNumbers` y auditar que ningún control equivalente reintroduzca esa decisión en el recorrido afectado. El redactor seguirá redactando libremente y podrá hacer sus cálculos. El revisor entregará las afirmaciones verificables identificando su significado, unidad o grupo, moneda o magnitud y relación cuando corresponda. El código comparará precios, características y presupuestos con sus fuentes; comprobará operaciones compatibles después de redactar, usando operandos autorizados. Una diferencia no se buscará entre los precios. No basta con que una cifra coincida con cualquier valor del contexto. El revisor seguirá revisando riesgos comerciales y obligaciones; no volverá a una ficha por cada oración ni a referencias cruzadas complejas.
5. **Reparar la capa que falló y conservar el borrador válido.** Distinguir contradicción comercial, interpretación incorrecta del revisor, metadatos incompletos y operación sin comprobación matemática. Reparar las omisiones o clasificaciones detectadas en la revisión sobre el mismo borrador, con intentos acotados. Pedir nueva redacción solo ante un problema concreto del mensaje. Una operación no soportada por el verificador no demuestra una contradicción: puede continuar con aprobación semántica y sin contradicciones comprobadas, dejando explícita la ausencia de comprobación matemática. El sistema no puede garantizar detectar toda omisión del revisor sin interpretar la prosa. No llamar «montos de entrada» a precios completos durante una reparación.
6. **Ofrecer únicamente ayudas disponibles y registrar la pregunta real.** Entregar al redactor y al revisor las capacidades verificadas: información financiera, revisión consentida o derivación al equipo interno, según corresponda. No deducir un contacto bancario disponible de la mera existencia de una entidad autorizada. Corregir la incoherencia del borrador observado: contenía una pregunta pero declaraba `question.role = none`. Registrar la acción propuesta y distinguir explicar, iniciar revisión y pedir ayuda humana. Una oferta no acredita una acción realizada ni consentimiento; un «sí» a dos alternativas puede requerir aclaración.

No se añadieron marcadores obligatorios en el mensaje ni una nueva herramienta de cálculo previa al redactor. La comprobación posterior no depende de haber guardado previamente el resultado de una operación. Se mantienen separados la generación de la respuesta y el control de sus afirmaciones.

El contrato de revisión es `business-risk-v2`. Sus campos `facts` y `question` se obtienen en la misma llamada de revisión; una reparación de ficha puede añadir una llamada acotada sobre el mismo borrador. Se reservó espacio de salida acorde a esa ficha para reducir truncamientos, sin cambiar los modelos. El verificador soporta atributos directos, rangos, comparaciones y diferencias respecto al presupuesto total. Otras operaciones quedan explícitamente sin comprobación matemática y conservan la evaluación semántica. No se eliminan los controles de permisos, envío, enlaces autorizados ni riesgos comerciales.

Las consultas pendientes se reconstruyen desde los últimos 80 mensajes registrados de la conversación. Los nuevos recibos de envío incluyen `answered_message_ids`; un aviso de recuperación no cierra esas consultas. Las respuestas humanas o respuestas sustantivas antiguas sin ese recibo delimitan los mensajes previos. El extractor puede recuperar consultas informativas pendientes, pero sus campos de acciones y consentimiento siguen exigiendo evidencia del mensaje actual.

## Registro de los datos y de las comprobaciones

Se usa el registro existente de ejecuciones en `lv_automation_execution_steps`, asociado al mensaje, paso e intento. La salida original del revisor se conserva en `output_summary.output_snapshot.data`. En el diagnóstico `semantic_review`, `extracted_facts` conserva las afirmaciones y `fact_checks` las fuentes, resultados y estados: `verified`, `contradiction` o `unverified`. `offered_action` registra la ayuda ofrecida. Se mantienen separadas la aprobación de la IA y la verificación determinista.

Estos datos sirven para decidir sobre el borrador y explicar la decisión en el flujo visual. No actualizan el catálogo, no sustituyen el presupuesto confirmado y no se convierten automáticamente en hechos para conversaciones futuras. Una reparación debe conservar el rastro del resultado original y vincular el nuevo resultado al mismo borrador.

## Oferta de contacto que requiere aclaración

El primer borrador preguntó: «¿Desea que le explique cómo funcionan estos créditos o le oriento con un contacto especializado en opciones bancarias?».

El contexto de financiamiento recibido por ese redactor solo contenía las entidades Banco Pichincha y Cooperativa JEP, con el estado del trámite vacío. No identificaba a una persona, teléfono ni ejecutivo bancario seleccionado. La frase fue una oferta genérica del redactor; no una derivación bancaria preparada.

El código permite derivar solicitudes al equipo asesor interno mediante `handoff_lead`. También tiene un flujo de revisión de financiamiento con consentimiento, selección de entidad y recopilación progresiva de datos. Eso no acredita una conexión automática con un ejecutivo del banco. Como el borrador no se envió, no existe una ejecución posterior que permita afirmar qué habría decidido el extractor ante «sí, ayúdeme».

Esta aclaración queda incluida en la corrección 6. Si se ofrece una derivación interna, una formulación posible es «un asesor de nuestro equipo», sin exigir una frase literal. El contexto compartido publica `bank_contact=false` y las capacidades reales de ayuda; la IA revisora evalúa la oferta. Las ofertas ambiguas, informativas o sin metadatos fiables no acreditan consentimiento mediante un simple «sí».

## Comprobaciones de la implementación

- Reproducir la secuencia de consulta de financiamiento seguida de pregunta sobre ajuste, incluyendo la primera extracción fallida.
- Verificar plazos, reintentos útiles y conservación del primer mensaje cuando llega otro durante una extracción pendiente.
- Conservar el presupuesto confirmado de 100000 aunque el siguiente mensaje no lo repita; aceptar las diferencias verificadas de 45000 y 110000 con ese catálogo y contexto.
- Aplicar una nueva corrección de presupuesto y recalcular; no arrastrar importes anulados ni mezclar roles de las cifras.
- Responder las dos solicitudes pendientes sin repetir indefinidamente las ya atendidas.
- Rechazar un precio o cálculo realmente incorrecto, sin bloquear los datos correctos por faltar en una lista de precios.
- Conservar el primer borrador al reparar un error de clasificación o una omisión detectada en la revisión; registrar por separado una operación no comprobada por código y una contradicción real.
- No exigir que el redactor mencione todos los datos del contexto y no reutilizar resultados de revisión de un borrador para aprobar otro diferente.
- Distinguir ayuda informativa, revisión consentida y derivación interna; no prometer contactos bancarios concretos o créditos aprobados sin respaldo.
- Verificar que los campos de pregunta y acción propuesta reflejen la oferta del borrador y no conviertan una aceptación ambigua en consentimiento financiero.

## Código relacionado

- `src/lib/integrations/automation/business-risk-review.ts`: contexto de revisión y comprobación numérica.
- `src/lib/integrations/automation/business-facts.ts`: contrato de datos extraídos, comprobaciones por significado y capacidades de ayuda.
- `src/lib/integrations/automation/pending-inbound.ts`: consultas pendientes y recibos de atención.
- `src/lib/integrations/automation/turn-budget.ts`: evaluación de presupuesto del turno.
- `src/lib/integrations/automation/turn-completeness.ts`: integración de revisión y evaluación de presupuesto.
- `src/lib/integrations/automation/ai-request-policy.ts`: plazos y reintentos.
- `src/lib/integrations/automation/financing.ts`: entidades disponibles, consentimiento y respuestas del flujo financiero.
- `src/lib/integrations/automation/conversation.ts`: coordinación del turno y derivación al equipo interno.

La regresión principal puede ejecutarse con `npm run test:budget-financing-recovery`. Las pruebas usan respuestas simuladas y comprueban los contratos JSON; no ejecutan llamadas reales al modelo ni envíos comerciales. También se comprueban los contratos generales de revisión, recuperación, TypeScript y ESLint.

Quedan fuera de este cambio el estudio general de costos y caché, la migración arquitectónica del documento y desactivar el revisor.
