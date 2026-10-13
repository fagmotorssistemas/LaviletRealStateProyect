# Recuperación comprobada y política de cuotas

## Activación

1. Aplicar `supabase/migrations/20261014100000_confirmed_delivery_retry.sql`.
2. Desplegar el código del servidor y la interfaz juntos.
3. Actualizar el listado de incidencias. Comprobar en Kommo el destinatario, el contenido y la hora de la respuesta.
4. Si no se envió, elegir «No se envió», describir la comprobación (3–300 caracteres), mantener «Programar un reintento» y confirmar la revisión. Una comprobación cubre los eventos del mismo borrador.
5. Verificar el procesamiento del reintento y la recepción en WhatsApp. «Aceptado por Kommo» no acredita la entrega en WhatsApp.

La migración no envía nada por sí sola ni reencola incidentes históricos automáticamente. El trabajo de reintento es duradero e idempotente. Si no existe un borrador recuperable, se puede desmarcar el reintento para guardar solo la comprobación y atender la conversación. Una incidencia diferente del mismo contacto conserva su comprobación propia.

Los reintentos se limitan a los pasos repetibles: lectura y asignación de los mismos campos, o un lanzamiento explícitamente rechazado con HTTP 429. Un POST de resultado desconocido no se repite por ausencia de respuesta. Después de una comprobación de no envío puede reenviarse el borrador conservado, como máximo dos veces en su cadena. Una conversación que cambió de estado, un bot pausado, una intervención humana o una ventana vencida impiden reenviar una respuesta obsoleta.

## Cuotas mensuales

Regla compartida: `monthly-payment-policy.ts`, proyectada al contexto financiero del redactor y al conjunto de fuentes del revisor.

- La Vilet no financia directamente. El banco/cooperativa define aprobación, tasa, plazo, cargos y cuota definitiva.
- Solo puede comunicarse una estimación numérica calculada por el servidor con unidad/precio autorizado, monto financiado, tasa y tipo de tasa y plazo verificables y aplicables.
- No se inventan tasa, plazo, seguros ni cargos. La cuota básica y una tasa pública «desde» se presentan con sus límites; no son una cuota final aprobada.
- Se conservan unidad, entrada y entidad conocidas. Se explica lo pendiente de la entidad sin exigir que el lead conozca sus condiciones.
- Preguntar por cuotas no inicia una solicitud ni autoriza pedir cédula, empleo o ingresos.

No se configuraron condiciones hipotéticas nuevas. Con los datos actualmente incompletos, el bot debe explicar que aún no puede dar una cifra fiable. Ejemplo de redacción:

> Con mucho gusto podemos orientarle. La cuota mensual depende del monto que financiaría, el plazo y la tasa aplicable. Podemos preparar una estimación referencial cuando confirmemos esos datos; la entidad financiera que elija determinará las condiciones y la cuota definitiva.

La pregunta final, si hace falta, debe corresponder solo al siguiente dato pendiente. Este ejemplo no obliga a repetir unidad, entrada o entidad que el lead ya indicó.
