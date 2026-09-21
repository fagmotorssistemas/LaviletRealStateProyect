# WhatsApp → Kommo → CRM y `ctwa_clid`

## Evidencia producción (2026-09-21, recepción 11:58 EC)

**Hallazgo comprobado: el webhook CRM de Kommo llegó sin campos referral/ctwa_clid.**

| Paso | Evidencia |
| --- | --- |
| Mensaje | `messages.id=78562fd8…`, `external_message_id=eaf654a3-e7e7-4e89-a72e-f67e6e6b0001`, `sent_at=2026-09-21T16:58:58Z`, lead Kommo `4453096`, contact `9431328` |
| Evento | `lv_integration_events.id=180dcd4f…`, `received_at≈16:59:00Z`, `result.action=outside_test_lead`, `message_persisted=true`, `payload.ctwa=null` |
| Sonda pre-normalización | Vercel `kommo_ctwa_field_probe` `2026-09-21T16:59:00.028Z`, `fieldsAbsent=true`, `pathCount=0`, `paths=[]`, `extractedByIndex.0=false` |
| Atribución | `lv_whatsapp_ctwa_attribution`: **0 filas** (tabla vacía en el proyecto) |

Correlación: sonda 16:59:00.028Z ↔ `received_at` 16:59:00.189Z del mismo `externalId` (no solo por minuto).

**Conclusión:** no hubo fallo del extractor ni de `preserveCtwaForContact` en este caso: no había clid que conservar (`CTWA_NOOP`). `ctwa=null` en el evento normalizado **coincide** con la sonda de ausencia de campos; no es la única prueba, pero aquí ambas concuerdan.

**Qué no demuestra este caso:** que Kommo nunca pueda enviar el campo en otro tipo de webhook o integración. La documentación pública de Kommo `message[add]` / Chats **no declara** `referral.ctwa_clid`. Meta Cloud API **sí** lo documenta en el primer mensaje. Kommo documenta **UTMs en la ficha del lead** (Tracking data), no `ctwa_clid` vía webhook CRM.

---

## Cierre de despliegue (2026-09-17)

**Despliegue completado.** Schema CTWA + app en Production: almacenamiento preparado para cuando Kommo entregue el identificador; mensajes **sin** CTWA siguen el flujo habitual.

**Pixel y CAPI: sin cambios** (quedan como estaban).

---

## Conclusión

| Pregunta | Respuesta |
| --- | --- |
| ¿El normalizador CRM exige `ctwa_clid`? | **No.** Un mensaje sin CTWA se guarda y sigue el flujo habitual. |
| ¿Se atribuye solo a ads u orgánico si falta? | **No.** No se inventa atribución. |
| ¿Kommo CRM entrega `ctwa_clid` en el webhook actual? | **En la recepción verificada del 21/09 11:58 EC: no** (sonda `fieldsAbsent=true`). Docs públicas de `message[add]` tampoco lo declaran. |
| ¿Qué hacemos si Kommo algún día lo reenvía? | Se captura, se guarda first-touch con `field_path` (origen), no se borra en mensajes posteriores, reintentos no duplican. El probe + `payload.ctwaProbe` lo harán auditable en DB. |

## Payload de referencia

### Fixture CRM (**sintÃ©tico**)

`KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE` â€” forma `message[add]` alineada con la integraciÃ³n/tests. **No es captura del webhook real de Kommo** y **no demuestra** quÃ© campos entrega Kommo en producciÃ³n. Marcado con `_fixture_kind: synthetic_kommo_crm_shape`.

### Fixture Meta Cloud API (**sintÃ©tico**)

`META_CLOUD_CTWA_REFERRAL_SYNTHETIC_FIXTURE` â€” dÃ³nde Meta documenta `referral.ctwa_clid`. No es webhook Kommo.

LimitaciÃ³n: `KOMMO_CTWA_LIMITATION`.

## Cambios de cÃ³digo (revisiÃ³n)

1. `ctwa-from-kommo.ts` â€” extracciÃ³n opcional + preservaciÃ³n first-touch + fixtures de referencia.
2. `webhook.ts` â€” `Inbound.ctwa` opcional; no rechaza mensajes sin clid.
3. `ctwa-lead-store.ts` â€” RPC `lv_app_preserve_ctwa` / `lv_app_get_ctwa` (si la migraciÃ³n estÃ¡ aplicada); si no, el flujo CRM continÃºa.
4. `conversation.ts` â€” tras `register_inbound_message`, preserva clid si vino en el evento (tambiÃ©n en reintentos duplicados del mensaje).
5. MigraciÃ³n preparada: `supabase/migrations/20260916220000_whatsapp_ctwa_attribution.sql` (+ rollback).

**No** modifica Pixel, CAPI, Nest attribution, ni Production env.

## Pruebas aisladas

```bash
npm run test:ctwa-kommo
```

Cubre: sin CTWA â†’ flujo OK; captura si hay referral; first-touch; reintento idempotente; contraste Meta vs Kommo.

## Evidencia de resiliencia (tests)

`npm run test:ctwa-kommo`:

1. **CÃ³digos**: `CTWA_RPC_MISSING` vs `CTWA_TIMEOUT` vs `CTWA_DB_ERROR` / `CTWA_UNEXPECTED` (sin lanzar al CRM).
2. **Contrato RPC preserve**: exige `ok === true` y acciÃ³n reconocida (`inserted` | `preserved_existing` | `duplicate_retry` | `noop_empty`). VacÃ­o, desconocido o `missing_after_conflict` â†’ fallo controlado + log sin PII.
3. **`getStoredCtwaClid`**: solo ausencia real (PGRST202 / 42883 / 42P01 / does not exist) â†’ `CTWA_RPC_MISSING`; permisos (`42501`, `permission denied`) y otros errores â†’ `CTWA_DB_ERROR`.
4. **Log seguro**: JSON con `code`/`reason`; sin clid, telÃ©fono ni contactId.
5. **`processConversation` simulado**: RPC ausente, error DB, timeout â†’ `bot_paused` tras registrar; duplicado â†’ `action: duplicate`.
6. **SQL (PGlite)**: dos mensajes distintos del mismo contacto â†’ una sola fila, clid de la primera captura; reintento â†’ `duplicate_retry`.
7. **Sin CTWA**: `CTWA_NOOP` sin llamar RPC; `preserveCtwaCapture(existing, null)` conserva first-touch.

MigraciÃ³n: aplicada en Production (solo este archivo). Unicidad atÃ³mica vÃ­a `EXCEPTION WHEN unique_violation` + `ORDER BY captured_at, id`.

## LÃ­mites actuales de las pruebas

- **SQL**: ejercita `lv_app_preserve_ctwa` en **secuencia** (llamadas una tras otra en PGlite). No cubre carrera concurrente real entre dos writers sobre el mismo contacto/mensaje.
- **ConversaciÃ³n**: el flujo simulado usa lead con **bot pausado** (`bot_enabled: false` â†’ `action: bot_paused`) para verificar que el registro inbound y el soft-fail CTWA no cortan la atenciÃ³n. No ejercita una respuesta comercial completa ni envÃ­o a Kommo/WhatsApp.
- **CTWA real pendiente**: no se generaron mensajes ni conversiones; la verificaciÃ³n queda para la prÃ³xima conversaciÃ³n genuina desde anuncio de WhatsApp.

## Plan de despliegue y reversiÃ³n (PR #4) â€” **ejecutado** (2026-09-17)

MigraciÃ³n CTWA sola + verificaciÃ³n RLS/grants OK â†’ merge `main` (`8b63f4d`) â†’ fix typecheck (`7c93f7c`) â†’ Vercel Production Ready. **CTWA real sigue sin verificar.** ReversiÃ³n por defecto: solo app; conservar schema/datos CTWA.

Estado de este plan: **completado en Production para schema+app**. TodavÃ­a **no** implica atribuciÃ³n CTWA operativa.

### LimitaciÃ³n explÃ­cita (bloqueante de expectativas)

**CTWA real no verificado.** Los fixtures son sintÃ©ticos. **No hay captura anonimizada del webhook CRM real de Kommo** que demuestre entrega de `referral.ctwa_clid` (u otro campo equivalente). Tras el despliegue:

- El CRM **seguirÃ¡ aceptando** mensajes sin CTWA (comportamiento esperado).
- La tabla/RPC solo se llenarÃ¡n **si** Kommo reenvÃ­a el clid en algÃºn campo que el normalizador ya conoce.
- **No** se debe interpretar â€œmigraciÃ³n aplicada + app en vivoâ€ como â€œatribuciÃ³n CTWA operativa en producciÃ³nâ€.
- Validar entrega real requiere captura anonimizada del webhook Kommo (o evidencia equivalente), **fuera** de este plan y **sin** inventar ads/orgÃ¡nico.

### Alcance del PR

| Incluye | No incluye |
| --- | --- |
| CÃ³digo CRM: captura opcional, soft-fail, first-touch | Pixel / CAPI / Nest attribution |
| MigraciÃ³n `20260916220000_whatsapp_ctwa_attribution.sql` | Mensajes WhatsApp reales de prueba |
| Archivo `*_down.sql` (manual, no automÃ¡tico) | Cambios de env Production (Pixel, etc.) |
| Tests aislados (`npm run test:ctwa-kommo`) | GarantÃ­a de que Kommo entrega `ctwa_clid` |

### Orden obligatorio (cuando se autorice)

1. **Pre-check (sin tocar Prod)**  
   - PR #4 revisado.  
   - `npm run test:ctwa-kommo` en verde.  
   - Listar migraciones pendientes en Production y confirmar cuÃ¡les existen ademÃ¡s de CTWA.  
   - Recordar la limitaciÃ³n **CTWA real no verificado** (arriba).

2. **Aplicar Ãºnicamente la migraciÃ³n CTWA** (ventana y dueÃ±o explÃ­citos).  
   - Ejecutar **solo** el SQL de  
     `supabase/migrations/20260916220000_whatsapp_ctwa_attribution.sql`.  
   - **Prohibido** en este paso: `supabase db push`, `supabase migration up` masivo, o cualquier comando que aplique **otras** migraciones pendientes del repo.  
   - Si el flujo habitual del equipo es â€œpush de todasâ€, **no usarlo**: copiar/pegar o ejecutar ese archivo concreto (SQL editor / `psql` / `supabase db query` con el contenido de ese archivo Ãºnicamente).  
   - Tras aplicar, **verificar permisos y objetos** (lectura/catÃ¡logo, sin datos de prueba reales):  
     - Existe `public.lv_whatsapp_ctwa_attribution` con RLS habilitado.  
     - Existen `lv_app_preserve_ctwa` y `lv_app_get_ctwa`.  
     - `service_role` tiene EXECUTE en ambas y SELECT/INSERT/UPDATE en la tabla.  
     - `anon` / `authenticated` / `PUBLIC` **no** tienen privilegios Ãºtiles sobre tabla ni funciones.  
   - Abortar aquÃ­ si falla la migraciÃ³n o los grants; **no** continuar al merge/deploy.

3. **Merge + deploy de la app**  
   - Merge del PR #4 y despliegue (Vercel / pipeline habitual).  
   - La app ya encuentra las RPC; el soft-fail sigue cubriendo errores no fatales sin cortar la atenciÃ³n.  
   - No se envÃ­an WhatsApps ni conversiones Meta por este cambio.

4. **RevisiÃ³n de logs y trÃ¡fico habitual**  
   - Observar trÃ¡fico WhatsApp **habitual** (sin inventar mensajes CTWA).  
   - Mensajes sin clid siguen el flujo CRM.  
   - Logs `scope: ctwa_attribution`: solo `code`/`reason`, **sin** clid ni PII.  
   - Opcional (SQL de lectura): `SELECT count(*) FROM lv_whatsapp_ctwa_attribution` â€” puede ser `0` mientras Kommo no entregue clid.  
   - **No** concluir Ã©xito de atribuciÃ³n CTWA sin captura real de webhook.

### CÃ³mo asegurar â€œsolo esta migraciÃ³nâ€

| Hacer | No hacer |
| --- | --- |
| Abrir y ejecutar el archivo `20260916220000_whatsapp_ctwa_attribution.sql` | `supabase db push` / migrate-all contra Production |
| Comprobar el historial de migraciones aplicadas **antes** y que no se cuelen otras | Asumir que el CLI filtrarÃ¡ â€œsolo CTWAâ€ |
| Anotar en el runbook el hash/commit y la hora de la aplicaciÃ³n manual | Aplicar carpetas enteras de `supabase/migrations/` |

### ReversiÃ³n (si hace falta) â€” **no destructiva por defecto**

1. **Volver a la versiÃ³n anterior de la app** (redeploy / revert del merge de PR #4).  
   - El CRM vuelve al cÃ³digo previo; la atenciÃ³n no depende de CTWA.  
2. **Conservar** tabla `lv_whatsapp_ctwa_attribution`, funciones `lv_app_*` y **cualquier dato** ya capturado.  
3. **No ejecutar automÃ¡ticamente**  
   `supabase/rollbacks/20260916220000_whatsapp_ctwa_attribution_down.sql`.  
   - Ese SQL es destructivo (DROP de funciones y tabla). Solo si mÃ¡s adelante hay decisiÃ³n **explÃ­cita y separada** de borrar el schema CTWA.  
4. Confirmar que el webhook CRM sigue registrando mensajes con la app revertida.

**QuÃ© no tocar en una reversiÃ³n normal**

- Pixel / CAPI / activaciÃ³n Meta (PR #3 u otros).  
- `messages` / `leads` / resto del CRM.  
- Schema CTWA ni filas de atribuciÃ³n.

### Criterios de abortar

- MigraciÃ³n CTWA falla (permisos, FKs a `tenants`/`projects`, etc.).  
- VerificaciÃ³n de grants/RLS no cumple lo esperado.  
- Aparecen otras migraciones â€œcoladasâ€ â†’ detener, no desplegar app hasta aclarar.  
- Tras deploy, inbound CRM deja de registrar (investigar; no borrar schema CTWA como primer reflejo).

### Fuera de este plan / siguiente hito

- En la **prÃ³xima conversaciÃ³n genuina** procedente de un anuncio de WhatsApp: revisar payload del webhook CRM y persistencia en `lv_whatsapp_ctwa_attribution` **sin** exponer clid, telÃ©fono ni otros datos personales (solo presencia/ausencia del campo, `field_path` genÃ©rico, `action` RPC).
- Un mensaje orgÃ¡nico/directo **no** sustituye esa comprobaciÃ³n.
- **No** generar WhatsApps ni conversiones Meta adicionales para forzar la prueba.
- Borrado opcional del schema CTWA: solo con autorizaciÃ³n explÃ­cita y el `*_down.sql` manual.
