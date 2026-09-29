# Interpretación, reserva y libertad de redacción

Estado: implementado localmente; requiere desplegar código y aplicar las dos migraciones de esta entrega. No se ha modificado producción ni la pertenencia de los leads a proyectos.

## Interpretación compartida

El contrato `lavilet-dialogue-v3` conserva la interpretación original y el objetivo canónico `turn-intent-v2`. Una interpretación de alta confianza con evidencia del mensaje prevalece sobre las búsquedas por palabras. Las reglas léxicas sirven de respaldo cuando falta una interpretación fiable; sus conflictos quedan registrados. La evidencia no convierte en verdaderos los precios, disponibilidades o unidades: esos datos siguen contrastándose con las fuentes verificadas.

`turn_semantics.reservation` distingue solicitud de iniciar reserva, consulta informativa, negativa y ausencia de intención. `asked_reservation` sigue siendo un evento comercial, pero por sí solo no autoriza una acción. Una negativa a la pregunta anterior puede coexistir con una nueva solicitud de reserva.

La operación de catálogo interpretada también conserva prioridad: una comparación, selección o detalle no se convierte en ranking por encontrar una palabra incidental. Los filtros nuevos requieren evidencia del turno; los filtros recordados conservan su procedencia.

## Solicitud y acción real

Ante una solicitud explícita, `conversation.ts` ejecuta `lv_request_reservation_handoff` antes de preparar el mensaje. La unidad se valida contra el catálogo y las referencias actuales o una selección previa inequívoca. Un número desconocido no se sustituye por la unidad recordada. Si no se puede demostrar la solicitud, se pide aclaración.

La función registra una solicitud idempotente por mensaje, reutiliza un asesor activo del proyecto o asigna por rotación. Si no hay asesor elegible o corresponde dejarla en cola, registra ese resultado. Conserva las pausas del bot y el opt-out. El texto se redacta después de verificar el recibo contra el lead persistido.

Registrar una solicitud no reserva inventario, no confirma un pago y no confirma una cita. La respuesta puede explicar la asignación o la cola, pero no afirmar que el inmueble ya está separado. Preguntar por requisitos no ejecuta el traspaso de reserva.

Los lotes conservan los identificadores de los mensajes que aportan la evidencia. SQL comprueba que son mensajes del cliente, pertenecen a la misma conversación, están ordenados y contienen la evidencia indicada. Un reintento devuelve el recibo sin volver a rotar al asesor.

## Redacción y revisión

| Recomendación editorial | Control que sigue siendo obligatorio |
| --- | --- |
| Brevedad preferida, número de preguntas y cortesía. | Límite técnico de 3000 caracteres. |
| Presentar opciones progresivamente. | No inventar unidades, disponibilidad, medidas o precios. |
| Pregunta y continuación sugeridas por una plantilla. | Responder a la solicitud, conservar la selección y el objetivo operativo. |
| Enlace secundario de la respuesta base. | Usar enlaces autorizados y entregar el material requerido por el turno. |
| Reformular un aviso de traspaso. | Describir únicamente una acción comprobada y su estado real. |

El redactor puede elegir otras palabras y una continuación comercial pertinente. Las recomendaciones editoriales se registran como observaciones, no como motivos de rechazo. La revisión semántica conserva los controles de hechos, cobertura y propósito. Las preguntas necesarias de consentimiento, perfil o coordinación siguen dependiendo del estado real; no se sustituyen por una igualdad literal con la plantilla.

Una URL presente en una plantilla está permitida, pero no se vuelve obligatoria automáticamente. Por ejemplo, solicitar una reserva de una unidad ya conocida no obliga a repetir su tour 360. La petición explícita de un recorrido o la entrega de brochure requerida por el flujo sí conservan su obligación.

El texto aprobado no vuelve a pasar por el recorte editorial de `directReply`. Si una transformación posterior cambia el contenido, se vuelve a revisar antes del envío. La respuesta aprobada y la que Kommo aceptó son estados distintos y se muestran por separado.

## Trazabilidad

La interfaz muestra interpretación del extractor, objetivo aplicado, motivos de conciliación, referencia de unidad, pregunta y propósito, observaciones editoriales, enlaces permitidos/requeridos y resultado operativo. La decisión de puntuación de `lv_evaluate_message_interest_v2` se registra por separado: recomendar un traspaso no demuestra que se ejecutó.

El recibo de reserva indica solicitud registrada y asesor asignado o cola. Nunca se presenta como reserva de inventario. Las ejecuciones históricas conservan sus motivos originales; las correcciones no reescriben los registros anteriores.

## Despliegue y verificación

Aplicar en este orden, antes de activar el código nuevo:

1. `20260929100000_interest_evaluation_handoff_decision.sql`: persiste la decisión comercial y añade el RPC v2 sin romper v1.
2. `20260929101000_reservation_handoff_receipt.sql`: tabla de recibos y acción de reserva con traspaso.

Solo la ausencia conocida de la función de puntuación v2 permite recurrir a v1. Un timeout no provoca una segunda escritura. La acción de reserva exige su función nueva y su recibo; no afirma éxito si falla.

Límite heredado: la idempotencia cubre el RPC, no la recuperación automática de todo el turno. El ejecutor descarta entradas ya registradas; si la acción terminó pero falló la confirmación posterior, el recibo y la asignación pueden existir sin que se haya enviado el mensaje. Esta entrega no añade reenvíos automáticos de resultado incierto.

La regresión incluye suites, departamentos y penthouses; solicitudes con errores ortográficos; negativa anterior junto con nueva reserva; consulta informativa; asesor asignado, reconocido y cola; evidencia repartida en mensajes; referencias inexistentes; reintentos; recibos inconsistentes; conservación de un borrador aprobado hasta el transporte simulado; rechazo de datos o acciones inventados. Las pruebas SQL se ejecutan sobre una base PGlite aislada, sin escrituras productivas.

Verificación local de esta entrega: 309 pruebas conversacionales, 240 de integración, 123 de automatización y 101 específicas de reserva, SQL, interfaz y continuidad: 773 aprobadas. `tsc --noEmit`, ESLint de las fuentes TypeScript modificadas y `git diff --check` sin errores. No se enviaron mensajes reales a leads.
