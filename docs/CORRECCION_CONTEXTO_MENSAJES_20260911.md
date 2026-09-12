# Continuidad de mensajes · 11 de septiembre de 2026

El historial real confirmó tres fallos: una precalificación existente activaba respuestas financieras en cualquier turno; las confirmaciones de la cola de visitas no se incluían en el contexto; y el agradecimiento «estaré puntual» podía extraerse como una nueva solicitud de cita.

## Cambios

- El financiamiento se procesa solo cuando el turno corresponde a ese tema o responde a un dato solicitado. Se conserva el avance al cambiar de tema, sin volver a presentar el formulario.
- Una elección de JEP se reconoce con su nombre. Si aún falta aceptar la revisión, se pregunta por esa revisión concreta; un sí posterior avanza. Elegir entidad no concede autorización para compartir datos.
- Las consultas sobre otras entidades reciben respuesta directa; no repiten automáticamente la invitación a iniciar.
- Los agradecimientos con compromiso de puntualidad cierran brevemente. Las preguntas sobre una cita existente consultan su estado, no generan una solicitud.
- «No» después de cancelar y ofrecer otro día cierra ese seguimiento. No reactiva financiamiento ni se interpreta como baja de todos los mensajes.
- Los reclamos y signos de interrogación durante una conversación recuperan la elección o cita conocida; no vuelven a saludar.
- El extractor recibe propuestas y reglas del turno actual. Hay comprobaciones adicionales antes de crear solicitudes y procesar el formulario.
- Los mensajes enviados por la cola de visitas aparecen en el historial, en orden cronológico y únicamente después de haber sido aceptados por el proveedor.

## Base de datos

Migración: `20260911160000_conversation_sent_visit_history.sql`.
Reemplaza únicamente la función de lectura `lv_app_conversation_context`. Incluye mensajes de `lv_outbox` aceptados/entregados y fecha de la cita. No modifica tablas, mensajes, citas, formularios ni permisos existentes.
Respaldo previo local: `tmp/conversation-context-before-20260911.sql`.

## Validación

- 51 pruebas de integración, incluidas secuencias con extractor deliberadamente equivocado.
- Seis casos sintéticos con el modelo configurado: puntualidad, consulta de cita, cancelación, rechazo de reagendar, selección JEP y solicitud de asesor.
- Compilación de producción y TypeScript.
- Reconstrucción del turno real de puntualidad: la confirmación ahora es visible, sin mensajes futuros y sin acceso anónimo a la función.
- No se enviaron mensajes de prueba ni se reinició el lead. Sigue pausado tras su solicitud de atención humana.

El acortamiento de Google Maps a `kommo.cc` corresponde al seguimiento de enlaces de Kommo; no se cambió esa configuración con esta corrección.
