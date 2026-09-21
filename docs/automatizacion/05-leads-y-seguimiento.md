# Leads, temperatura y seguimiento

## Etapa comercial del lead

Los valores internos actuales tienen nombres heredados:

| Valor interno | Lectura de negocio recomendada | Disparador actual |
| --- | --- | --- |
| `lanzamiento` | Contacto inicial | Lead nuevo o consulta general. |
| `precalificacion` | Calificado | Declara tipo de unidad o propósito de compra. |
| `preventa` | Oportunidad | Pregunta precio o financiamiento, solicita visita o alcanza temperatura caliente. |
| `reserva_venta` | Reserva/cierre | Pregunta cómo reservar. |
| `nutricion` | Valor legado | No debe entenderse como una etapa comercial nueva. |

La función actual `apply_lead_events` sí mueve a `preventa` cuando la temperatura llega a caliente. El documento objetivo anterior proponía separar esa condición. Por tanto, hoy hay una diferencia entre el comportamiento versionado y el modelo deseado; cualquier cambio debe decidirse expresamente antes de modificar la función SQL.

## Eventos que reconoce el extractor

- `declared_unit_type`
- `declared_purchase_purpose`
- `asked_location_features`
- `asked_delivery_date`
- `asked_price`
- `asked_financing`
- `requested_visit`
- `asked_reservation`
- `nutrition_response`

El puntaje de cada evento, si es repetible y si está activo se administra en `lead_scoring_rules`. Los umbrales predeterminados son:

- Tibio: 25 puntos.
- Caliente: 60 puntos.

Ambos umbrales son editables por proyecto. La documentación no fija los puntos de los demás eventos porque la base de datos es la fuente operativa y la interfaz permite cambiarlos.

## Cita confirmada

Una cita confirmada por el lead es una señal especial:

- crea o actualiza el evento no repetible `appointment_confirmed`;
- aporta al menos 20 puntos;
- si hacen falta más puntos, aporta solo los necesarios para alcanzar el umbral caliente;
- asigna al lead el mismo asesor responsable de la cita;
- no sustituye estados finales como vendido, cerrado o perdido.

## Traspaso

`apply_lead_events` solicita traspaso por:

- visita solicitada;
- pregunta de reserva;
- llegada a temperatura caliente.

`handoff_lead` asigna según el equipo y SLA configurados, salvo procesos que ya tienen un asesor específico, como una cita confirmada o su reagendamiento.

El traspaso y la conversación son conceptos separados. El bot no queda apagado simplemente porque exista un asesor asignado; se detiene cuando el asesor responde, cuando se activa `DETENER IA` o cuando hay opt-out.

Una respuesta manual se reconoce mediante `add_outgoing_message` de Kommo. El autor debe ser interno; cuando existe `profiles.kommo_user_id` se usa esa relación y, si Kommo publica el usuario compartido de La Vilet, se conserva al asesor que ya tiene asignado el lead. En ese momento la pausa se guarda primero en la base de datos y después se sincroniza a `DETENER IA`; una entrega automática de Salesbot no cumple esta regla.

## Bandeja operativa del asesor

La pantalla `Automatización > Monitoreo` reúne los traspasos activos en dos vistas:

| Vista | Estado utilizado | Acción esperada |
| --- | --- | --- |
| Requieren atención | `queued` o asignado a otra persona | Un asesor disponible toma los que todavía no tienen responsable. |
| Asignados a mí | `assigned` o un `acknowledged` anterior del usuario actual | Abrir Kommo y atender al lead. |

La bandeja prioriza citas, reagendamientos, reservas, separaciones y SLA vencidos. Se actualiza cada 30 segundos mientras la página está visible y también al recuperar el foco del navegador.

La bandeja no permite que el asesor marque manualmente un lead como `Esperando al lead` ni como `Resuelto`. `Tomar` se conserva como respaldo para un traspaso que haya quedado en cola sin responsable y no cambia `DETENER IA`. Las solicitudes de cita pendientes se terminan desde la bandeja especializada de citas para conservar su estado y su confirmación.

Cada nueva asignación inserta una notificación `Lead asignado` dirigida al `assigned_to` del lead. La tabla aplica RLS por `recipient_id=auth.uid()`: otro asesor no puede consultar ni marcar esa notificación. Al seleccionar la campana superior se muestran las últimas asignaciones del usuario actual y se puede abrir el lead en Kommo.

## Nutrición activa

Después de que una respuesta normal del bot fue aceptada por Kommo, se intentan programar seguimientos para el mismo mensaje ancla:

| Momento | Implementación | Estado productivo |
| --- | --- | --- |
| 24 horas | `nutrition_24h` | Preparado, pendiente de aprobación WABA y vínculo al Salesbot 20968. |
| Día 7 | `nutrition_week_one` | Activo para el alcance autorizado. |
| Día 14 | `nutrition_week_two` | Activo para el alcance autorizado. |
| Día 21 | `nutrition_week_three` | Activo para el alcance autorizado. |

El horario se ajusta a la jornada configurada. La creación de una tarea no garantiza su envío: la elegibilidad se vuelve a comprobar al ejecutarla.

## Requisitos de elegibilidad

El lead debe:

- tener `bot_enabled=true`;
- usar canal WhatsApp;
- tener consentimiento de seguimiento;
- no tener opt-out;
- no tener un traspaso humano activo;
- no estar vendido, reservado, no interesado, agendado, cerrado o perdido;
- seguir dentro del proyecto y del alcance operativo permitido.

La tarea se cancela si aparece cualquiera de estas condiciones:

- nuevo mensaje del lead;
- entrada pendiente o no contestada;
- actividad posterior de un asesor;
- cita o coordinación activa;
- precalificación financiera activa;
- entrega pendiente o incierta;
- plantilla no aprobada o modificada;
- `DETENER IA` en Kommo;
- contenido ya enviado, repetido o sin valor nuevo;
- rechazo como “no gracias” o “no me interesa”.

El seguimiento usa plantillas aprobadas. GPT puede elegir un tema seguro entre opciones permitidas, pero no sustituye el cuerpo aprobado con texto arbitrario.

## Fuente operativa y alcance actual

El ejecutor usa exclusivamente `projects.policies_json` para saber qué pasos están activos y `lv_integration_events` para programar y registrar cada trabajo. Las tablas `nutrition_steps`, `lead_nutrition` y `nutrition_delivery_history` se conservan por compatibilidad histórica, pero ya no determinan lo que muestra la pantalla principal ni lo que envía el worker.

La configuración está preparada para producción, con una compuerta restringida al lead de Carlos (`0987110032`). Los demás leads permanecen con `bot_enabled=false` y `DETENER IA=true`. Los nombres internos `test_only` y `test_lead_id` son heredados; en este despliegue almacenan la restricción operativa y no convierten las plantillas ni el ejecutor en una simulación.

La plantilla WABA de 24 horas fue creada en Kommo con ID `14906`, pero todavía no tiene una revisión aprobada ni está vinculada al Salesbot `20968`. Por esa razón el paso permanece apagado y la interfaz debe mostrar la secuencia como parcial hasta completar ambos requisitos. Los días 7, 14 y 21 sí tienen plantillas aprobadas y verificadas.

## Recuperación

Los intentos de recuperación de día 30 y día 60 siguen **planificados**. No existe todavía un flujo completo que:

- cambie un estado de seguimiento visible a recuperación;
- envíe los dos intentos;
- cree una tarea titulada “Recuperar lead” para oportunidades;
- finalice automáticamente después del día 60.

No se debe presentar la recuperación como activa hasta implementar y verificar esos puntos.

## Decaimiento de temperatura

El mantenimiento puede ejecutar `apply_temperature_decay` cuando:

- `AUTOMATION_GLOBAL_MAINTENANCE=true`;
- no existe una restricción a un solo lead de prueba;
- `test_only=false` en la configuración de base de datos.

El decaimiento baja prioridad por inactividad. No envía mensajes y no equivale a nutrición ni recuperación.
