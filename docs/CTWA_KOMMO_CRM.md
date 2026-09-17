# WhatsApp → Kommo → CRM y `ctwa_clid`

Estado: cambios preparados para revisión. Migración **no** aplicada a Production. Pixel y CAPI intactos.

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

Migración: preparada, **no** aplicada a Production. Unicidad atómica vía `EXCEPTION WHEN unique_violation` + `ORDER BY captured_at, id`.

## Límites actuales de las pruebas

- **SQL**: ejercita `lv_app_preserve_ctwa` en **secuencia** (llamadas una tras otra en PGlite). No cubre carrera concurrente real entre dos writers sobre el mismo contacto/mensaje.
- **Conversación**: el flujo simulado usa lead con **bot pausado** (`bot_enabled: false` → `action: bot_paused`) para verificar que el registro inbound y el soft-fail CTWA no cortan la atención. No ejercita una respuesta comercial completa ni envío a Kommo/WhatsApp.
- Sin migración en Production, sin publicación y sin mensajes reales.

## Plan de despliegue y reversión (PR #4) — **no ejecutado**

Estado de este plan: **preparado para cuando se autorice**. No mergear-como-deploy automático de DB; no aplicar migración ni publicar hasta orden explícita.

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
| Rollback SQL `*_down.sql` | Cambios de env Production (Pixel, etc.) |
| Tests aislados (`npm run test:ctwa-kommo`) | Garantía de que Kommo entrega `ctwa_clid` |

### Orden recomendado (cuando se autorice)

1. **Pre-check (sin tocar Prod)**  
   - PR #4 revisado y mergeable.  
   - `npm run test:ctwa-kommo` en verde.  
   - Confirmar que el rollback `supabase/rollbacks/20260916220000_whatsapp_ctwa_attribution_down.sql` está en el mismo commit.  
   - Recordar la limitación CTWA real no verificado (arriba).

2. **Merge del PR** a la rama de despliegue acordada (p. ej. `main`).  
   - Solo código + archivo de migración en el repo; **aún no** implica DB aplicada.

3. **Desplegar aplicación** (Vercel / pipeline habitual).  
   - Seguro **antes** de la migración: si las RPC no existen, `preserveCtwaForContact` / `getStoredCtwaClid` registran `CTWA_RPC_MISSING` (u otro código) **sin cortar** la atención CRM.  
   - No se envían WhatsApps ni conversiones Meta por este cambio.

4. **Aplicar migración en Production** (paso separado, con ventana y dueño).  
   - Ejecutar solo `supabase/migrations/20260916220000_whatsapp_ctwa_attribution.sql` en el proyecto Supabase de Production (CLI/`db push`/SQL editor según el procedimiento del equipo).  
   - Verificar objetos: tabla `lv_whatsapp_ctwa_attribution`, funciones `lv_app_preserve_ctwa` y `lv_app_get_ctwa`, grants a `service_role`, RLS activo, sin grants a `anon`/`authenticated`.  
   - **No** enviar mensajes reales para “probar” CTWA en este paso.

5. **Verificación post-despliegue (sin tráfico CTWA inventado)**  
   - Tráfico WhatsApp habitual: mensajes **sin** clid siguen el flujo; logs no deben spamear errores fatales del CRM.  
   - Si aparece `scope: ctwa_attribution` en logs: solo `code`/`reason`, **sin** clid ni PII.  
   - Opcional (SQL de lectura): `SELECT count(*) FROM lv_whatsapp_ctwa_attribution` — esperar `0` hasta evidencia real de Kommo.  
   - **No** concluir éxito de atribución CTWA sin captura real de webhook.

### Reversión (si hace falta)

**A. Solo código (migración aún no aplicada)**  
1. Revertir el deploy de la app al commit anterior a PR #4 (o revert del merge).  
2. Sin cambios de DB que deshacer.

**B. Migración ya aplicada**  
1. Revertir/redeploy app al commit previo (el soft-fail ya no llamará RPCs útiles; conviene alinear código y schema).  
2. Ejecutar rollback SQL **en Production** (mismo dueño/ventana):  
   `supabase/rollbacks/20260916220000_whatsapp_ctwa_attribution_down.sql`  
   - Elimina `lv_app_get_ctwa`, `lv_app_preserve_ctwa` y la tabla `lv_whatsapp_ctwa_attribution` (**borra filas CTWA** si las hubiera).  
3. Confirmar que las funciones/tabla ya no existen.  
4. Confirmar que el webhook CRM sigue registrando mensajes (atención intacta).

**C. Qué no revertir**  
- Pixel / CAPI / activación Meta del PR #3 u otros.  
- Datos de leads/mensajes del CRM (este rollback **no** toca `messages` / `leads`).

### Criterios de abortar el despliegue

- Fallo al aplicar la migración (permisos, objetos faltantes `tenants`/`projects`).  
- Tras deploy, el pipeline de conversación deja de registrar inbound (no atribuible solo a CTWA soft-fail: investigar antes de seguir).  
- Decisión de negocio: no operar schema CTWA hasta tener captura real de Kommo → **no aplicar paso 4**; el código puede vivir con RPC ausente.

### Fuera de este plan (siguientes hitos)

- Obtener y documentar captura **anonimizada** del webhook real de Kommo (o confirmar que nunca envía clid).  
- Solo entonces: prueba controlada de first-touch en un entorno acordado (no improvisar WhatsApps de producción en este documento).
