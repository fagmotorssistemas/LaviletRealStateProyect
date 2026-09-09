# Automatizaciones de La Vilet: integración de servidor

Estado al 2026-09-09: implementación local terminada y probada; migraciones preparadas, NO aplicadas a Supabase. No se desplegó ni se activó el envío. La interfaz y la nutrición siguen para la siguiente etapa.

## Qué se integró

- Webhook de mensajes entrantes de WhatsApp desde Kommo: valida cuenta, dirección, IDs y hora; persiste el evento antes de responder.
- Agrupación de mensajes tras 30 segundos sin nuevas entradas del mismo lead/contacto.
- Registro de conversación con las RPC existentes, deduplicación y hora original del mensaje.
- Texto, imágenes y audio; archivos no permitidos o que no puedan interpretarse reciben una petición de aclaración por texto.
- IA con el modelo configurado, prompts activos, historial, catálogo publicado, amenidades y lugares cercanos. Extracción de eventos, consentimiento, financiamiento y traspaso al asesor.
- Interpretación de respuestas a propuestas: la base determina el resultado; la IA no confirma una cita por sí sola.
- Cola de visitas existente: propuesta, confirmación, reprogramación y recordatorio de dos horas.
- Mantenimiento cada minuto y decaimiento diario, con controles separados para las RPC globales.
- Simulación de visitas sin escrituras y diagnóstico de conexiones para administradores.

No se copian nodos heredados de automóviles ni se activan rutas de nutrición incompletas. Los envíos de visitas usan hechos determinísticos; se omitió la apertura decorativa opcional de IA para no alterar fecha, asesor o ubicación.

## Punto de retorno

Respaldo local: `tmp/integration-checkpoint-2026-09-09T17-41-46-937Z/`.

Incluye repository-head.zip, working-tree.patch, working-files y manifest.json con hashes. Conserva los cuatro archivos que ya estaban modificados: globals.css, AppointmentDetailModal.tsx, AppointmentInboxBanner.tsx y useVisitInbox.ts. La integración no los modifica.

Incluye instantáneas de lv_routes, lv_auto_config, project_automation_config, agent_prompts, nutrition_steps, lv_content y el esquema expuesto por la API. **No es un backup completo de PostgreSQL**: no contiene clientes, cuerpos de funciones, triggers, RLS ni secretos .env.

Para recuperar código: extraer el ZIP en una carpeta nueva y copiar encima working-files respetando sus rutas. Alternativa: aplicar working-tree.patch al ZIP, no ambos métodos. Conservar las credenciales locales y reinstalar dependencias. Comparar antes de reemplazar trabajo posterior. Guardar una copia externa del respaldo, ya que tmp está excluido de Git.

Antes de aplicar las migraciones, obtener y verificar un respaldo nativo de Supabase. Las credenciales actuales de servicio permiten la API; no se configuró DATABASE_URL, SUPABASE_DB_URL ni SUPABASE_ACCESS_TOKEN para administrar SQL desde este entorno.

## Cambios exactos de base de datos

Todos están preparados en archivos; **ninguno se ejecutó en la base real**.

1. `20260909180000_kommo_app_runtime.sql`
   - Crea solamente la tabla técnica `lv_integration_events`.
   - Guarda eventos entrantes, tareas, estado y un bloqueo del worker; no reemplaza lv_outbox.
   - RLS habilitada; sin permisos para anon/authenticated. Solo service_role.
   - Crea cuatro RPC nuevas: lv_app_receive, lv_app_worker_lock, lv_app_claim y lv_app_finish.
2. `20260909181000_kommo_app_context.sql`
   - Crea tres RPC nuevas de solo lectura: lv_app_visit_context, lv_app_visit_candidates y lv_app_conversation_context.
   - Traslada los SELECT revisados de los JSON, limitados al tenant/proyecto de La Vilet.
3. `20260909182000_kommo_visit_routes.sql`
   - Modifica únicamente bot_id y detail_field_id de cuatro filas de lv_routes.
   - Propuesta: 18724/519824. Confirmación y reprogramación: 18730/519824. Recordatorio: 18350/513120.
   - Conserva textos, flags y rutas de nutrición; aborta si los valores previos cambiaron.

No se alteran columnas, triggers, permisos o funciones de negocio ya existentes. Cada archivo tiene transacción y reversión en supabase/rollbacks.

Durante la ejecución futura se reutilizan:

| Tabla o grupo | Escrituras del runtime |
| --- | --- |
| lv_outbox | Encolar, reservar, cancelar eventos obsoletos y registrar accepted/failed/uncertain mediante controles existentes. |
| lv_visit_state | Guardar revisión y resultado observado de las citas. |
| leads, conversations, messages | RPC de registro, eventos, declaraciones, consentimiento y traspaso. Hora/media originales del mensaje; pausa del bot al traspasar. |
| Citas, solicitudes, reservas y eventos de asignación | RPC existentes de coordinación, liberación y escalamiento. |
| Financiamiento y scoring | RPC existentes process_financing_message_v2, apply_lead_events y apply_temperature_decay. |
| Nutrición | Sin activación ni escritura específica en esta etapa. |

Las RPC originales de mantenimiento son globales: pueden afectar otros proyectos si existen. Se ejecutan solo con AUTOMATION_GLOBAL_MAINTENANCE=true, sin lead de prueba y con test_only=false.

## Módulos y endpoints

- src/lib/integrations/lavilet.ts: mapeo de cuenta/proyecto.
- src/lib/integrations/automation/: configuración, proveedores, reglas, visitas, conversación y worker.
- GET /api/integrations/status: diagnóstico, sesión de administrador.
- GET /api/integrations/automation/preview: decisiones de visitas, sin cambios; sesión de administrador.
- POST /api/integrations/kommo/webhook: secreto del webhook, sin sesión de navegador.
- GET o POST /api/integrations/automation/run: Bearer del cron, sin sesión de navegador.
- scripts/automation-cron.mjs: ejecutor portátil para un servidor Node persistente.

El endpoint del cron declara maxDuration=300. El proveedor debe admitir ese tiempo; no iniciar tareas largas dentro del webhook ni con procesos en memoria que desaparezcan al responder.

## Configuración local preparada

Se añadieron al .env, sin alterar las claves existentes:

- AUTOMATION_MODE=off
- AUTOMATION_N8N_DISABLED=false
- AUTOMATION_GLOBAL_MAINTENANCE=false
- AUTOMATION_CRON_SECRET: secreto aleatorio nuevo.
- KOMMO_WEBHOOK_SECRET: secreto aleatorio independiente.

No copiar estos secretos al código, navegador o repositorio. En el alojamiento deben configurarse como variables de servidor.

Variables adicionales al activar:

- AUTOMATION_ACTIVATED_AT: instante real del cambio a la aplicación, en ISO UTC.
- AUTOMATION_TEST_LEAD_ID: UUID del lead de prueba, opcional.
- AUTOMATION_APP_URL: origen público de la aplicación para el ejecutor; local por defecto http://localhost:3000.
- KOMMO_MEDIA_HOSTS: hosts exactos permitidos para adjuntos, por defecto amojo.kommo.com.
- OPENAI_TRANSCRIPTION_MODEL: por defecto whisper-1; el modelo de texto sigue OPENAI_MODEL.
- CRON_SECRET se acepta como alternativa cuando el proveedor lo utiliza.

El modo live requiere simultáneamente AUTOMATION_MODE=live, AUTOMATION_N8N_DISABLED=true y una fecha de activación válida. También respeta enabled, dry_run y test_only de lv_auto_config.

## Puesta en marcha pendiente

1. Dominio confirmado: https://www.lavilett.com, alojado en Vercel. El receptor público devuelve 404: falta publicar la integración. El usuario confirmó que desactivó n8n; se registró AUTOMATION_N8N_DISABLED=true en el .env local, manteniendo AUTOMATION_MODE=off.
2. Obtener respaldo nativo y aplicar las tres migraciones en el orden indicado usando Supabase SQL Editor o una conexión SQL administrativa. Comparar los contratos de las RPC instaladas con los archivos; las pruebas locales usan dobles de las funciones de negocio, no sus cuerpos de producción.
3. Configurar variables del servidor y usar preview para revisar visitas. Preview no ejecuta IA ni modifica datos.
4. Probar un lead delimitado en un entorno de prueba. En test_only no se ejecutan las tareas globales.
5. En el cambio definitivo, detener en n8n los cuatro flujos reemplazados y dejar un único webhook receptor. No marcar AUTOMATION_N8N_DISABLED=true hasta hacerlo.
6. Registrar en Kommo el evento de mensaje entrante con URL:
   `https://www.lavilett.com/api/integrations/kommo/webhook?key=SECRETO`.
   Es un webhook CRM general; su secreto no es la firma de un canal de Chats API. Evitar registrar la URL completa en logs. Si un intermediario permite cabeceras, usar x-kommo-webhook-secret.
7. Configurar el cron cada minuto hacia /api/integrations/automation/run con Authorization: Bearer SECRETO_CRON. Alternativamente ejecutar `npm run automation:watch` bajo el gestor de procesos del servidor. `npm run automation:tick` ejecuta una sola ronda. No se lanzó ningún proceso persistente aquí.
8. Registrar la hora del cambio en AUTOMATION_ACTIVATED_AT y habilitar live. Los eventos anteriores a esa hora se ignoran para evitar responder al historial.

Mientras la aplicación está apagada, el webhook devuelve 503 y no acepta eventos. Kommo puede deshabilitar un webhook que falla repetidamente; conectarlo al activar, no durante la preparación.

### Cron y activación en Vercel

- Con Vercel Pro: copiar docs/vercel-cron.example.json a vercel.json en la raíz (o incorporar su propiedad crons si el archivo ya existe) y desplegar. Hobby no admite cron cada minuto; usar un programador externo o el ejecutor Node en un servidor persistente si se conserva Hobby.
- En Settings > Environment Variables, entorno Production, configurar CRON_SECRET con el mismo valor local de AUTOMATION_CRON_SECRET. Si se configuran ambos, deben coincidir: el endpoint prioriza AUTOMATION_CRON_SECRET y Vercel envía CRON_SECRET.
- Configurar también las credenciales de Supabase, Kommo y OpenAI y KOMMO_WEBHOOK_SECRET desde el .env local como variables del servidor. El .env local no configura Vercel automáticamente.
- Primero desplegar con AUTOMATION_MODE=off. Aplicar las tres migraciones en orden y comprobar el diagnóstico con una sesión administradora.
- Para el cambio definitivo, configurar AUTOMATION_N8N_DISABLED=true, AUTOMATION_ACTIVATED_AT con el instante real del cambio en ISO UTC y AUTOMATION_MODE=live. Volver a desplegar para aplicar las variables. AUTOMATION_GLOBAL_MAINTENANCE sigue separado; activar solo tras verificar el alcance global de las RPC.
- Registrar el webhook con su secreto únicamente cuando el receptor esté operativo. Comprobar la recepción y la ejecución del cron con un lead de prueba.
- Falta acceso SQL administrativo: añadir SUPABASE_DB_URL al .env con la cadena obtenida en Supabase > Connect, incluyendo la contraseña de base de datos, o ejecutar los archivos desde SQL Editor. No compartir la contraseña en el chat.

Referencia: https://vercel.com/docs/cron-jobs/usage-and-pricing y https://vercel.com/docs/cron-jobs/manage-cron-jobs.

## Recuperación y resultados inciertos

Kommo puede aceptar un Salesbot y perderse la respuesta HTTP. Por eso accepted significa solicitud aceptada, **no entrega confirmada**. No se marca delivered sin evidencia; no se implementó un webhook de confirmación de entrega de proveedor.

Una conversación interrumpida queda uncertain y bloquea nuevas respuestas automáticas para ese contacto hasta revisión. Un mensaje de visita incierto bloquea otros envíos al mismo lead. No se reintenta automáticamente un POST de envío. Consultar Kommo, reconciliar efectos de las RPC y revisar el evento antes de habilitar un reintento.

El bloqueo de worker evita concurrencia entre instancias de esta aplicación. No controla n8n: la exclusividad del ejecutor debe establecerse al hacer el cambio.

Para revertir la integración: apagar el modo, retirar el webhook y detener el cron; reconciliar pendientes; exportar lv_integration_events; aplicar los down en orden inverso. El down de runtime se niega a borrar eventos pending/processing/uncertain o un worker activo. Nunca restaura datos comerciales históricos ni deshace mensajes enviados.

## Validación

- npm run test:integrations: 13 pruebas de reglas, autenticación, agrupación, duplicados, baja y fallos de envío.
- PostgreSQL aislado con PGlite: instalación de las tres migraciones, permisos, deduplicación, bloqueo, eventos inciertos, cambios concurrentes de rutas y rollback. Esquema sintético; no acceso a la base real.
- Para repetir SQL: instalar @electric-sql/pglite bajo tmp/integration-sql-tests y ejecutar `node --test scripts/integrations-sql.test.cjs`.
- TypeScript con --noEmit --allowImportingTsExtensions y ESLint de los módulos nuevos.
- Compilación de producción de Next.js.
- Prueba HTTP con el servidor compilado: diagnóstico/vista previa/cron sin credenciales devuelven 401; cron autenticado devuelve off y cero procesados; webhook autenticado sigue inactivo (503). Se detuvo el servidor de prueba.
- Lectura real del prompt activo y generación estructurada con un saludo sintético mediante OpenAI. No se envió ningún mensaje a Kommo.
- Pendiente: ensayo completo en una base de prueba con las RPC reales y activación en el alojamiento.

Fuentes de contratos: [Salesbot](https://developers.kommo.com/reference/launch-salesbots), [webhooks CRM](https://developers.kommo.com/docs/webhooks-general), [salidas JSON de OpenAI](https://developers.openai.com/api/docs/guides/structured-outputs).

Vigencia del token de Kommo hasta 2027-09-09 según lo informado por el usuario.


## Comprobaci?n posterior a las migraciones ? 2026-09-09

Las tres llamadas apply_migration devolvieron success=true. Las siete funciones nuevas permiten ejecuci?n a service_role y la niegan a anon/authenticated. Las consultas de contexto funcionaron y el planificador de solo lectura encontr? dos candidatos. No se ejecut? el worker. El webhook y automation/run p?blicos siguen devolviendo 404. Sigue pendiente publicar c?digo, configurar variables, cron y activar el receptor antes de registrarlo en Kommo. La captura del usuario muestra un respaldo de Supabase de 16 horas antes; no se cre? ni verific? una restauraci?n de respaldo nativo durante esta instalaci?n.
