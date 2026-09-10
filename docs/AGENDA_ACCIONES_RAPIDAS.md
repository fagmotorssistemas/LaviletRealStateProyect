# Agenda: revisión rápida de solicitudes

Implementado el 10 de septiembre de 2026. Punto anterior del código: `d64f2663961b588177153e208c566503fbd8c923`.

## Comportamiento

- La notificación **Cita pendiente** abre el mismo modal que Agenda.
- El resumen muestra cliente, fecha y hora solicitadas, propiedad de interés y las acciones **Aceptar cita**, **Proponer otro horario** y **Solicitar reasignación**.
- Muestra los dos últimos cambios. **Ver detalles** abre el resumen del lead, mensaje de origen, observaciones e historial ampliado.
- Los estados se presentan en español. `superseded` se muestra como **Reemplazada por otra propuesta**, que no significa cancelada.
- **Ver chat en Kommo** abre la ficha del lead con su conversación. Está presente en todos los paneles del detalle y en creación cuando se selecciona un lead vinculado a Kommo.
- La propiedad se obtiene de las unidades de la cita; si faltan, de las unidades de interés o categoría del lead.

## Aceptar el horario del cliente

El servidor resuelve la fecha usando el mensaje original y su fecha de recepción en Ecuador. «Mañana a las 10 am» se calcula respecto al día del mensaje, incluso si el asesor abre la notificación después.

**Aceptar cita** se habilita cuando hay fecha y hora inequívocas, un mensaje entrante verificable del mismo lead, asesor habilitado y disponibilidad. Si falta información o el texto es ambiguo, el asesor puede proponer un horario explícito.

Ejemplo: «Bueno mejor quiero reagendar para hoy» muestra el día y **hora por definir**. No hereda las 10 am de una solicitud anterior.

Al aceptar, se vuelve a validar el mensaje, vigencia, usuario, jornada y conflictos. La cita queda confirmada y se registra una sola confirmación en la cola existente. Un doble clic no genera dos mensajes.

## Proponer una alternativa

1. El servidor consulta jornada del proyecto, citas del asesor, reservas temporales y ausencias.
2. Recomienda hasta tres intervalos de 60 minutos, con inicios cada 30 minutos. Busca desde la fecha solicitada o desde hoy, durante 14 días, con al menos 15 minutos de anticipación.
3. **Aceptar recomendación** solo rellena fecha y hora en el formulario. También hay accesos **Hoy**, **Mañana** y selección manual.
4. Al cambiar el día se consultan sus espacios disponibles (hasta 24 resultados; búsqueda manual hasta 90 días).
5. Solo **Enviar propuesta** crea la propuesta, reserva temporalmente el intervalo y registra el mensaje en la cola.
6. La cita definitiva se confirma cuando el cliente acepta la propuesta. La automatización en la nube procesa los mensajes como antes.

La recomendación es una consulta; el espacio puede ocuparse mientras el modal está abierto. El servidor lo comprueba nuevamente al guardar.

## Base de datos

Migraciones aplicadas a Supabase:

- `20260910160000_agenda_quick_actions.sql`: cuatro funciones nuevas.
- `20260910163000_visit_preference_ambiguity.sql`: endurece la detección de alternativas y negaciones del texto.

No se crearon tablas, eliminaron columnas ni modificaron citas o conversaciones existentes al instalar las migraciones.

Funciones nuevas:

- `lv_parse_visit_preference`: interpretación conservadora de fechas y horas.
- `lv_requested_visit_slot`: obtención del horario y su mensaje de origen.
- `lv_visit_scheduling_options`: disponibilidad y recomendaciones; consulta autorizada.
- `lv_accept_client_visit_time`: aceptación transaccional del horario del cliente.

Las dos primeras son internas. Las RPC públicas requieren autenticación y comprueban que el usuario sea el asesor asignado o coordinación.

Cuando un asesor **acepta** una cita, se actualizan `appointment_reschedule_requests` y `appointments`; se registra el evento en `appointment_change_log`, se libera la reserva correspondiente de `appointment_time_holds` y se añade la confirmación a `lv_outbox`, mediante las funciones existentes.

Cuando **envía una propuesta**, se reutiliza `lv_advisor_propose_request`: sustituye la solicitud anterior, crea la propuesta, su reserva y su mensaje en cola. Seleccionar una recomendación no escribe en ninguna tabla.

## Verificación y despliegue

- Compilación de producción y comprobación TypeScript.
- Pruebas de automatización, incluida validación de fechas incompletas o inválidas.
- `supabase/tests/agenda_quick_actions.sql` comprueba permisos, horario ambiguo, conflictos, ausencias, confirmación, doble clic y propuesta con reserva. Se ejecuta completo dentro de una transacción que termina en **ROLLBACK**. Los datos y mensajes temporales nunca se publican.
- Consulta de lectura mediante el servicio real de detalle de la cita.
- Revisión visual de componentes con datos de ejemplo.

Las funciones SQL ya están instaladas. La interfaz se publica al desplegar estos cambios en Vercel; no requiere nuevas variables de entorno.

Para probar después del despliegue: abrir una notificación, comprobar el resumen, entrar en **Proponer otro horario**, aceptar una recomendación y verificar que se rellenan los campos antes de enviar. **Enviar propuesta** y **Aceptar cita** sí generan mensajes reales.

## Volver al estado anterior

Restaurar únicamente los archivos de esta entrega desde el punto anterior, preservando otros cambios del proyecto, y desplegar esa revisión. Las funciones nuevas pueden permanecer sin uso; el flujo anterior sigue disponible.

Si además se desea retirar las funciones, ejecutar en este orden:

```sql
DROP FUNCTION public.lv_accept_client_visit_time(uuid,timestamptz,timestamptz,text);
DROP FUNCTION public.lv_visit_scheduling_options(uuid,date);
DROP FUNCTION public.lv_requested_visit_slot(public.appointment_reschedule_requests);
DROP FUNCTION public.lv_parse_visit_preference(text,timestamptz,text);
NOTIFY pgrst,'reload schema';
```

Esto no revierte citas que los asesores ya hayan confirmado ni mensajes ya enviados.

