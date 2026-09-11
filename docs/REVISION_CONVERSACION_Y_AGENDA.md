# Revisión de conversación y agenda · 10 de septiembre de 2026

Estado actualizado: guiones activos y ambas migraciones aplicados en Supabase. Se recuperó la conexión SQL, se validaron las funciones reales con transacciones revertidas y se confirmó el ejecutor de la nube. Esta entrega publica el código de conversación y agenda sobre la última revisión de GitHub.

## Comportamiento preparado

- `Hola` o `.`: bienvenida breve y ofrecer ayuda, sin atribuir interés comercial ni presentar el catálogo.
- Se utiliza el primer nombre de forma ocasional, `instalaciones` y la hora de Ecuador. Se evita repetir nombre del proyecto, agradecimientos y resúmenes.
- Un presupuesto incierto abre la posibilidad de ayudar a estimar entrada y cuota o explicar financiamiento.
- El extractor recibe el historial y la última pregunta real. `Sí, claro` después de ofrecer una revisión se interpreta en ese contexto. Una entidad no disponible recibe una explicación y las opciones habilitadas para ese lead.
- Los atributos de un departamento no se generalizan a todos. Un dato ausente requiere verificación; no significa que una unidad carezca del atributo. No se promete autorización ni rentabilidad para Airbnb.
- La fecha de una visita se conserva entre mensajes. Si falta la hora, se pregunta solo la hora. Si el cliente pide sugerencias o expresa incertidumbre, se coordina con el asesor desde esa primera petición.
- No se crea una solicitud para el asesor hasta tener fecha y hora válidas o una petición de ayuda. Los domingos y los horarios fuera de atención se resuelven con el cliente antes de abrirla.
- Las recomendaciones respetan la fecha solicitada, la preferencia de mañana/tarde y la agenda del asesor. Aplicar una recomendación rellena el formulario; enviar la propuesta sigue siendo una acción separada.
- Una contrapropuesta incompleta queda en coordinación. Se suspenden los recordatorios anteriores y se impide confirmar un horario obsoleto mientras se completa la nueva preferencia.
- La agenda incluye **Canceladas**. Una asistencia registrada se **edita**, con motivo obligatorio, usuario, fecha, estado anterior y nuevo. Los envíos repetidos idénticos no crean otro registro y una edición sobre una versión antigua se rechaza.

Los textos de conversación se editan en **Automatización → Guion → Cómo responde**. Las reglas de fechas, disponibilidad, confirmación y auditoría se ejecutan en el código y las funciones SQL; cambiar únicamente un prompt no sustituye estas validaciones. Los mensajes de coordinación usan textos breves dependientes del resultado real, para evitar afirmar acciones que todavía no ocurrieron.

No hacen falta más plantillas de Kommo para corregir los bucles mostrados dentro del flujo actual de conversación. Se conservan las rutas de envío, la cola y las comprobaciones de la ventana de mensajería existentes.

## Cambios de base de datos

| Elemento | Cambio |
| --- | --- |
| `agent_prompts` | Ya se actualizaron saludo, respuesta comercial, revisor y extractor; se incrementaron sus versiones y se respaldaron sus contenidos anteriores. |
| `lv_visit_intakes` | Tabla nueva para coordinar una fecha antes de crear una solicitud. Acceso directo reservado al servicio; los asesores reciben la información necesaria mediante funciones con autorización. |
| `appointment_reschedule_requests` | Columna `intake_source_ids` para conservar los mensajes que aportan fecha y hora entre turnos. |
| Funciones de coordinación | Recopilar preferencias, resolver horarios, recomendar disponibilidad y pausar recordatorios durante un cambio incompleto. |
| `appointments`, `appointment_units` | La nueva función de asistencia actualiza resultado y unidades visitadas con control de versión. |
| `appointment_change_log` | Guarda asistencia inicial y posteriores ediciones, con motivo, autor y valores anteriores. |

El disparador de `updated_at` de las citas mantiene versiones distintas incluso para escrituras dentro de una misma transacción. La asistencia conserva el bloqueo por proyecto usado por las demás operaciones de agenda.

Las migraciones no reinician leads ni reescriben las citas existentes al instalarlas. El reinicio de prueba previamente implementado elimina también los borradores al borrar la conversación, mediante la relación `ON DELETE CASCADE`.

## Financiamiento verificado

La configuración actual del proyecto ofrece **Banco Pichincha y Cooperativa JEP**, pero está marcada como prueba y restringida al teléfono de prueba configurado. El nuevo código respeta esa restricción y no ofrece convenios del catálogo global ni habilita estas opciones para otros leads. Jardín Azuayo no figura entre las opciones de este proyecto.

## Demora del mensaje investigado

Texto: «Hola, me informaron sobre el proyecto quisiera más información». Evidencia recuperada del respaldo anterior al reinicio; horas del 10 de septiembre en Ecuador:

| Paso | Hora |
| --- | --- |
| Mensaje de origen | 16:42:37 |
| Webhook recibido | 16:42:41.507 |
| Disponible después de agrupar mensajes | 16:43:11.507 |
| Ejecutor lo toma | 16:44:00.569 |
| Respuesta aceptada por Kommo | 16:44:09.674 |

Total hasta aceptación: **92.674 segundos**. Aproximadamente 4.5 s de recepción, 30 s de agrupación, 49.1 s esperando el ejecutor y 9.1 s de procesamiento/envío. No hay marca de entrega de WhatsApp para comprobar los cuatro minutos percibidos en el teléfono. Se verificó por SQL que `lavilet-automation-minute` está activo con frecuencia `* * * * *`. Las últimas ejecuciones completas devolvieron HTTP 200 y modo `live`, sin resultados inciertos. No consulta si hay un usuario conectado ni utiliza el PC. Los nuevos registros de salida incluyen `processing_ms`.

## Validación y puesta en producción

Validado: `npm run build`, 43 pruebas de `test:integrations`, 27 de `test:automation` y seis casos sintéticos con la IA mediante `node scripts/evaluate-conversation-review.cjs`. Las pruebas no enviaron mensajes a Kommo.

`node scripts/validate-conversation-sql.cjs` compila y prueba ambas migraciones en PostgreSQL local mediante PGlite. Verifica recopilación entre turnos, fechas, incertidumbre, recomendaciones por la tarde, domingos, horarios fuera de atención y ediciones de asistencia. Utiliza dobles para autorización y asignación.

También pasaron en Supabase real `supabase/tests/visit_intake_and_attendance.sql` y `supabase/tests/visit_conversation_cycle.sql`: asignación real, permisos, recopilación entre turnos, contrapropuestas, confirmación, cancelación, nueva visita, recomendaciones y edición auditada de asistencia. Ambas pruebas terminan en `ROLLBACK`; no quedan leads, mensajes ni colas temporales y no se ejecutaron Salesbots.

Para reproducir esta validación aislada, instalar primero la dependencia de pruebas fuera del paquete de la aplicación:

```powershell
npm.cmd install --prefix tmp/sql-validation --no-save --ignore-scripts @electric-sql/pglite
node scripts/validate-conversation-sql.cjs
```

Migraciones aplicadas antes de publicar el código:

1. `supabase/migrations/20260910233000_visit_intake_collection.sql`, registrada en Supabase como `20260911035439 / visit_intake_collection`.
2. `supabase/migrations/20260910234000_attendance_edit_audit.sql`, registrada como `20260911035447 / attendance_edit_audit`.

No hay que repetir estas migraciones. La segunda sustituye la operación anterior de asistencia; la nueva interfaz utiliza la función con control de edición. Respaldo previo de definiciones y estructura: `tmp/agenda-migration-checkpoint-20260911.json`. Revisión remota anterior a la publicación: `9d23a256ad81a35d980bd1d11651b4947ae773af`.

Para recuperar SQL desde Codex, indicando explícitamente los permisos que acepta Supabase:

```powershell
codex mcp login supabase --scopes "projects:read,database:read,database:write"
```

El intento sin `--scopes` devolvió `HTTP 400` y `scope.*: Invalid option` durante el registro dinámico. La URL guardada sí apunta al proyecto correcto. Con esos permisos explícitos el usuario completó la autorización y la consulta SQL confirmó acceso como `postgres` al proyecto.

Completar la autorización de la cuenta que tiene acceso al proyecto. El navegador debe mostrar `Authentication complete. You may close this window.` y PowerShell debe confirmar el inicio de sesión. La prueba definitiva desde esta conversación será ejecutar `select current_user, now();`. Si el navegador termina pero Codex sigue usando una sesión caducada, volver a abrir la sesión de Codex para recargar la conexión. Si PowerShell bloquea `codex.ps1`, usar `codex.cmd` en lugar de `codex` en el mismo comando.

Comprobación posterior: desde el teléfono de prueba enviar un saludo, pedir visita, indicar solo el día y verificar que aún no hay aviso al asesor; indicar la hora o pedir ayuda y comprobar que aparece una única solicitud. Probar una contrapropuesta, una cancelación y una edición de asistencia con motivo. Conservar las respuestas y sus horas para contrastarlas con el registro de eventos.

Respaldo de guiones de esta revisión: `tmp/conversation-prompts-2026-09-11T03-17-28-475Z/before.json` (archivo local ignorado por Git). El comando `node scripts/update-conversation-prompts.cjs` muestra cambios; `--apply` guarda y crea un respaldo antes de modificar los cuatro guiones.
