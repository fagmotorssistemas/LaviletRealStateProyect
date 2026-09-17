# WhatsApp → Kommo → CRM y `ctwa_clid`

## Cierre de despliegue (2026-09-17)

**Despliegue completado.** Schema CTWA + app en Production: almacenamiento preparado para cuando Kommo entregue el identificador; mensajes **sin** CTWA siguen el flujo habitual.

**CTWA real: pendiente de verificar.** Un mensaje directo sin anuncio **no** demuestra transmisión del clid. La única comprobación funcional que falta es inspeccionar el webhook de una conversación **genuina** iniciada desde un anuncio de WhatsApp (payload + persistencia, **sin** exponer datos personales). No generar mensajes ni conversiones adicionales para esa prueba.

**Pixel y CAPI: sin cambios** (quedan como estaban).

---

Estado operativo: migración `whatsapp_ctwa_attribution` aplicada; app en `main` desplegada. Fixtures siguen siendo sintéticos hasta la revisión de un webhook real de anuncio.

## Conclusión

| Pregunta | Respuesta |
| --- | --- |
| ¿El normalizador CRM exige `ctwa_clid`? | **No.** Un mensaje sin CTWA se guarda y sigue el flujo habitual. |
| ¿Se atribuye solo a ads u orgánico si falta? | **No.** No se inventa atribución. |
| ¿Kommo CRM entrega `ctwa_clid`? | **No en la forma documentada / de referencia** del webhook `message[add]` usado por La Vilet. Meta Cloud API sí lo envía en `messages[].referral` del **primer** mensaje. |
| ¿Qué hacemos si Kommo algún día lo reenvía? | Se captura, se guarda first-touch con `field_path` (origen), no se borra en mensajes posteriores, reintentos no duplican. |

## Payload de referencia

### Fixture CRM (**sintético**)

`KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE` — forma `message[add]` alineada con la integración/tests. **No es captura del webhook real de Kommo** y **no demuestra** qué campos entrega Kommo en producción. Marcado con `_fixture_kind: synthetic_kommo_crm_shape`.

### Fixture Meta Cloud API (**sintético**)

`META_CLOUD_CTWA_REFERRAL_SYNTHETIC_FIXTURE` — dónde Meta documenta `referral.ctwa_clid`. No es webhook Kommo.

Limitación: `KOMMO_CTWA_LIMITATION`.

## Cambios de código (revisión)

1. `ctwa-from-kommo.ts` — extracción opcional + preservación first-touch + fixtures de referencia.
2. `webhook.ts` — `Inbound.ctwa` opcional; no rechaza mensajes sin clid.
3. `ctwa-lead-store.ts` — RPC `lv_app_preserve_ctwa` / `lv_app_get_ctwa` (si la migración está aplicada); si no, el flujo CRM continúa.
4. `conversation.ts` — tras `register_inbound_message`, preserva clid si vino en el evento (también en reintentos duplicados del mensaje).
5. Migración preparada: `supabase/migrations/20260916220000_whatsapp_ctwa_attribution.sql` (+ rollback).

**No** modifica Pixel, CAPI, Nest attribution, ni Production env.

## Pruebas aisladas

```bash
npm run test:ctwa-kommo
```

Cubre: sin CTWA → flujo OK; captura si hay referral; first-touch; reintento idempotente; contraste Meta vs Kommo.

## Evidencia de resiliencia (tests)

`npm run test:ctwa-kommo`:

1. **Códigos**: `CTWA_RPC_MISSING` vs `CTWA_TIMEOUT` vs `CTWA_DB_ERROR` / `CTWA_UNEXPECTED` (sin lanzar al CRM).
2. **Contrato RPC preserve**: exige `ok === true` y acción reconocida (`inserted` | `preserved_existing` | `duplicate_retry` | `noop_empty`). Vacío, desconocido o `missing_after_conflict` → fallo controlado + log sin PII.
3. **`getStoredCtwaClid`**: solo ausencia real (PGRST202 / 42883 / 42P01 / does not exist) → `CTWA_RPC_MISSING`; permisos (`42501`, `permission denied`) y otros errores → `CTWA_DB_ERROR`.
4. **Log seguro**: JSON con `code`/`reason`; sin clid, teléfono ni contactId.
5. **`processConversation` simulado**: RPC ausente, error DB, timeout → `bot_paused` tras registrar; duplicado → `action: duplicate`.
6. **SQL (PGlite)**: dos mensajes distintos del mismo contacto → una sola fila, clid de la primera captura; reintento → `duplicate_retry`.
7. **Sin CTWA**: `CTWA_NOOP` sin llamar RPC; `preserveCtwaCapture(existing, null)` conserva first-touch.

Migración: aplicada en Production (solo este archivo). Unicidad atómica vía `EXCEPTION WHEN unique_violation` + `ORDER BY captured_at, id`.

## Límites actuales de las pruebas

- **SQL**: ejercita `lv_app_preserve_ctwa` en **secuencia** (llamadas una tras otra en PGlite). No cubre carrera concurrente real entre dos writers sobre el mismo contacto/mensaje.
- **Conversación**: el flujo simulado usa lead con **bot pausado** (`bot_enabled: false` → `action: bot_paused`) para verificar que el registro inbound y el soft-fail CTWA no cortan la atención. No ejercita una respuesta comercial completa ni envío a Kommo/WhatsApp.
- **CTWA real pendiente**: no se generaron mensajes ni conversiones; la verificación queda para la próxima conversación genuina desde anuncio de WhatsApp.

## Plan de despliegue y reversión (PR #4) — **ejecutado** (2026-09-17)

Migración CTWA sola + verificación RLS/grants OK → merge `main` (`8b63f4d`) → fix typecheck (`7c93f7c`) → Vercel Production Ready. **CTWA real sigue sin verificar.** Reversión por defecto: solo app; conservar schema/datos CTWA.

Estado de este plan: **completado en Production para schema+app**. Todavía **no** implica atribución CTWA operativa.

### Limitación explícita (bloqueante de expectativas)

**CTWA real no verificado.** Los fixtures son sintéticos. **No hay captura anonimizada del webhook CRM real de Kommo** que demuestre entrega de `referral.ctwa_clid` (u otro campo equivalente). Tras el despliegue:

- El CRM **seguirá aceptando** mensajes sin CTWA (comportamiento esperado).
- La tabla/RPC solo se llenarán **si** Kommo reenvía el clid en algún campo que el normalizador ya conoce.
- **No** se debe interpretar “migración aplicada + app en vivo” como “atribución CTWA operativa en producción”.
- Validar entrega real requiere captura anonimizada del webhook Kommo (o evidencia equivalente), **fuera** de este plan y **sin** inventar ads/orgánico.

### Alcance del PR

| Incluye | No incluye |
| --- | --- |
| Código CRM: captura opcional, soft-fail, first-touch | Pixel / CAPI / Nest attribution |
| Migración `20260916220000_whatsapp_ctwa_attribution.sql` | Mensajes WhatsApp reales de prueba |
| Archivo `*_down.sql` (manual, no automático) | Cambios de env Production (Pixel, etc.) |
| Tests aislados (`npm run test:ctwa-kommo`) | Garantía de que Kommo entrega `ctwa_clid` |

### Orden obligatorio (cuando se autorice)

1. **Pre-check (sin tocar Prod)**  
   - PR #4 revisado.  
   - `npm run test:ctwa-kommo` en verde.  
   - Listar migraciones pendientes en Production y confirmar cuáles existen además de CTWA.  
   - Recordar la limitación **CTWA real no verificado** (arriba).

2. **Aplicar únicamente la migración CTWA** (ventana y dueño explícitos).  
   - Ejecutar **solo** el SQL de  
     `supabase/migrations/20260916220000_whatsapp_ctwa_attribution.sql`.  
   - **Prohibido** en este paso: `supabase db push`, `supabase migration up` masivo, o cualquier comando que aplique **otras** migraciones pendientes del repo.  
   - Si el flujo habitual del equipo es “push de todas”, **no usarlo**: copiar/pegar o ejecutar ese archivo concreto (SQL editor / `psql` / `supabase db query` con el contenido de ese archivo únicamente).  
   - Tras aplicar, **verificar permisos y objetos** (lectura/catálogo, sin datos de prueba reales):  
     - Existe `public.lv_whatsapp_ctwa_attribution` con RLS habilitado.  
     - Existen `lv_app_preserve_ctwa` y `lv_app_get_ctwa`.  
     - `service_role` tiene EXECUTE en ambas y SELECT/INSERT/UPDATE en la tabla.  
     - `anon` / `authenticated` / `PUBLIC` **no** tienen privilegios útiles sobre tabla ni funciones.  
   - Abortar aquí si falla la migración o los grants; **no** continuar al merge/deploy.

3. **Merge + deploy de la app**  
   - Merge del PR #4 y despliegue (Vercel / pipeline habitual).  
   - La app ya encuentra las RPC; el soft-fail sigue cubriendo errores no fatales sin cortar la atención.  
   - No se envían WhatsApps ni conversiones Meta por este cambio.

4. **Revisión de logs y tráfico habitual**  
   - Observar tráfico WhatsApp **habitual** (sin inventar mensajes CTWA).  
   - Mensajes sin clid siguen el flujo CRM.  
   - Logs `scope: ctwa_attribution`: solo `code`/`reason`, **sin** clid ni PII.  
   - Opcional (SQL de lectura): `SELECT count(*) FROM lv_whatsapp_ctwa_attribution` — puede ser `0` mientras Kommo no entregue clid.  
   - **No** concluir éxito de atribución CTWA sin captura real de webhook.

### Cómo asegurar “solo esta migración”

| Hacer | No hacer |
| --- | --- |
| Abrir y ejecutar el archivo `20260916220000_whatsapp_ctwa_attribution.sql` | `supabase db push` / migrate-all contra Production |
| Comprobar el historial de migraciones aplicadas **antes** y que no se cuelen otras | Asumir que el CLI filtrará “solo CTWA” |
| Anotar en el runbook el hash/commit y la hora de la aplicación manual | Aplicar carpetas enteras de `supabase/migrations/` |

### Reversión (si hace falta) — **no destructiva por defecto**

1. **Volver a la versión anterior de la app** (redeploy / revert del merge de PR #4).  
   - El CRM vuelve al código previo; la atención no depende de CTWA.  
2. **Conservar** tabla `lv_whatsapp_ctwa_attribution`, funciones `lv_app_*` y **cualquier dato** ya capturado.  
3. **No ejecutar automáticamente**  
   `supabase/rollbacks/20260916220000_whatsapp_ctwa_attribution_down.sql`.  
   - Ese SQL es destructivo (DROP de funciones y tabla). Solo si más adelante hay decisión **explícita y separada** de borrar el schema CTWA.  
4. Confirmar que el webhook CRM sigue registrando mensajes con la app revertida.

**Qué no tocar en una reversión normal**

- Pixel / CAPI / activación Meta (PR #3 u otros).  
- `messages` / `leads` / resto del CRM.  
- Schema CTWA ni filas de atribución.

### Criterios de abortar

- Migración CTWA falla (permisos, FKs a `tenants`/`projects`, etc.).  
- Verificación de grants/RLS no cumple lo esperado.  
- Aparecen otras migraciones “coladas” → detener, no desplegar app hasta aclarar.  
- Tras deploy, inbound CRM deja de registrar (investigar; no borrar schema CTWA como primer reflejo).

### Fuera de este plan / siguiente hito

- En la **próxima conversación genuina** procedente de un anuncio de WhatsApp: revisar payload del webhook CRM y persistencia en `lv_whatsapp_ctwa_attribution` **sin** exponer clid, teléfono ni otros datos personales (solo presencia/ausencia del campo, `field_path` genérico, `action` RPC).
- Un mensaje orgánico/directo **no** sustituye esa comprobación.
- **No** generar WhatsApps ni conversiones Meta adicionales para forzar la prueba.
- Borrado opcional del schema CTWA: solo con autorización explícita y el `*_down.sql` manual.
