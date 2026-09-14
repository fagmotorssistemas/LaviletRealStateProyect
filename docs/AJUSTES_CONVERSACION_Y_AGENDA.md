# Audios, conversación y propuestas de visita

Actualización del 14 de septiembre de 2026.

## Qué fallaba

- El audio silencioso se había convertido en «¡Gracias por ver el vídeo!». El sistema aceptaba cualquier transcripción no vacía como si fuera una declaración real. Ahora exige metadatos de habla y confianza. Si no supera la comprobación, pide reenviar el audio o escribir, sin iniciar acciones comerciales.
- La expresión de AM/PM del lector SQL consumía «a m» dentro de «para mañana». Esto eliminaba la fecha. También heredaba un horario rechazado al recibir «prefiero otra». La migración corrige ambos problemas y conserva fecha y hora entre mensajes.
- Las aperturas se suprimían por haber aparecido dentro de las últimas seis respuestas. Ahora se permiten de manera contextual y se limita la repetición inmediata.
- Había una regla que prohibía mencionar al asesor antes de confirmar una cita. Contradecía el proceso real de revisión de horarios y fue reemplazada.
- Las citas se enviaban mediante campos de Kommo de 256 caracteres. El envío ahora usa el campo amplio RESPUESTA IA y conserva dirección y mapa completos.

## Comportamiento resultante

La IA redacta citas y financiamiento a partir de un resultado verificado y otra revisión comprueba que conserve hechos, condiciones, pregunta y estado. La generación no agenda, confirma ni aprueba créditos. Si la redacción no supera la revisión, se conserva una respuesta segura con los datos reales. La autorización financiera se reconoce por el paso pendiente guardado, incluso cuando cambia la redacción de la pregunta.

Después de consultas de precio o interés concreto puede ofrecer una visita; cuando el cliente pide material, entrega el enlace correspondiente. Tras dos preguntas de descubrimiento sin un avance concreto, comparte el brochure si aún no se ha enviado. No repite invitaciones en cada turno ni interpreta una muestra de interés como autorización para agendar.

En lanzamiento, las visitas son a la oficina o al terreno según la configuración. No se ofrecen departamentos construidos. La dirección completa y el enlace del mapa se añaden al mensaje. Una preferencia fuera del horario habitual pasa a revisión del asesor; no se modifica ni confirma por cuenta del bot.

## Flujo del asesor

En **Citas pendientes → abrir solicitud → Proponer horarios**, o en el detalle de la cita en **Agenda**, el asesor puede:

1. Revisar hasta tres espacios sugeridos de su agenda.
2. Cambiar fecha y hora, quitar opciones o añadir otras.
3. Pulsar **Comprobar horarios y redactar mensaje**.
4. Leer la vista previa y, si desea otra redacción, generar una variante.
5. Pulsar **Enviar propuesta al cliente**.

Se comprueban citas y solicitudes pendientes al preparar, enviar y aceptar. La revisión caduca a los diez minutos o si cambia la solicitud. La propuesta enviada conserva exactamente el texto aprobado y todas las opciones. Un «sí» genérico no elige la primera: se solicita la opción concreta. Si el cliente rechaza las opciones, se prepara otra coordinación sin reciclar la propuesta rechazada.

## Activación en Supabase

Ejecutar completo `operations/activar_agenda_contextual.sql` en el SQL Editor del proyecto. Incluye ambas migraciones dentro de una transacción y no envía mensajes ni confirma citas.

Mientras falte esta actualización, la interfaz conserva la propuesta individual y muestra que falta habilitar las opciones múltiples. Las nuevas solicitudes detectadas por el bot pasan a la bandeja del asesor para evitar que el lector anterior repita preguntas. Se puede comprobar la corrección sin modificar datos:

```sql
SELECT public.lv_visit_preference_parts(
  'Para mañana a las 8',
  '2026-09-14T18:23:06Z'::timestamptz,
  'America/Guayaquil'
);
```

`requested_date` debe ser `2026-09-15`. Actualice el panel después de aplicar la migración. Un lead que ya fue transferido permanece bajo atención del asesor; no se reactiva el bot a espaldas de esa atención.

Las respuestas libres de citas solo se envían dentro de la ventana de 24 horas verificada. Este cambio no convierte esos textos variables en nuevas plantillas aprobadas por Meta ni habilita envíos libres fuera de la ventana.
