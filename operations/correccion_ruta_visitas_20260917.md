# Coordinación de visitas desde conversación

La frase «Mejor coordinamos una visita» no coincidía con el detector explícito. La invitación «¿Prefiere ... coordinar una visita?» tampoco coincidía con el detector de invitaciones. Esto eliminaba el evento requested_visit aunque lo propusiera el extractor y dejaba la respuesta al generador comercial.

Cambios para todos los perfiles:
- `turn-routing.ts`: reconoce aceptaciones con coordinamos/agendamos/programamos sin confundir negaciones o referencias históricas. Reconoce consultas de plazo de confirmación con contexto de visita.
- `sales-policy.ts`: reconoce invitaciones con «prefiere» y respuestas de horario a una pregunta de coordinación, incluso si todavía no existe intake. Admite «puede ser» sin tomarlo como disponibilidad confirmada.
- `conversation.ts`: después del RPC de registro, comprueba request_id en appointment_reschedule_requests con filtros de proyecto, tenant y lead. Audita el recibo, la verificación y el asesor asignado. No afirma que un asesor recibió una solicitud inexistente. Si no se verifica el resultado, crea una derivación real para comprobarlo sin repetir una escritura de resultado desconocido. La asignación continúa a cargo del procedimiento SQL existente; una solicitud sin asesor permanece en la coordinación existente, no se adjudica a alguien inventado.
- `visit-copy.ts`, `operational-copy.ts`, `turn-completeness.ts`: reglas de redacción natural, sin explicar validaciones internas del horario ni prometer plazos de respuesta. Comprobación final también en rutas comerciales: no ofrecer recorrido de departamentos en lanzamiento, no afirmar registro sin respaldo ni prometer confirmación hoy/pronto/antes del sábado. Se conserva la pregunta útil y las demás frases.

La bandeja de agenda consume appointment_reschedule_requests y assigned_advisor_id. No se añade un canal de notificación externo ni se cambia la configuración de reparto. No requiere migración SQL.

Validación: 261 pruebas aprobadas, incluyendo aceptación con extractor vacío, horario posterior sin intake previo, comprobación de recibo/asignación, recibo inexistente, consulta de plazo, negaciones, visitas ajenas, entrega y funciones SQL de coordinación. Pruebas con datos simulados/locales: no se envían mensajes reales ni se recrean solicitudes históricas.
