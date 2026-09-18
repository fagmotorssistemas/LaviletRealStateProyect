# Cierre de alcance — Schedule (locales)

**Sin push / merge / despliegue / eventos reales.**

| Pieza | SHA tip (local) | Último publicado (base del patch) |
| --- | --- | --- |
| Frontend `feat/meta-schedule-aceptar-cita` | `c484ca54c60ca471101ed6d2f79325a85615131f` | `ebe6edc9a9245b7e245325aa0cc9ce6a3222a9e9` |
| Nest `fix/supabase-drain-exclude-review-hold` | `ce707c75c032eaf10cbde4e47859b6d122389f69` | `6e787347b48741e8c0edd0f2c143b110c470a8b8` |

## Definición de entrega

| Área | Estado |
| --- | --- |
| **Schedule web** | Preparado para despliegue; **recepción real pendiente** |
| **WhatsApp** | Atención y citas conservadas; envío Schedule→Meta **bloqueado** (compatibilidad BM no confirmada) |
| **Pixel / CAPI** (Lead, ViewContent) | **Conservar** |

## Patches
- `review-local/fe-c484ca5-vs-ebe6edc.patch`
- `review-local/nest-ce707c7-vs-6e78734.patch`

## Lista ejecutable unificada

### 0. Antes de cualquier deploy
Flags Schedule **OFF** en FE y Nest. `META_SCHEDULE_DELIVERY_ENABLED=false` también en worker SQLite (Schedule pending no se envía ni se pierde; Lead/VC siguen). Esta protección permanece en rollback por flags mientras existan Schedule pendientes.

### 1. Migraciones (verificar tras aplicar)
1. `20260917152000_meta_capi_outbox_review_hold.sql`
2. `20260917160000_meta_schedule_recovery.sql`
3. `20260917170000_meta_schedule_recover_pre_intent.sql`
4. `20260917180000_meta_schedule_consent_cancel_review_hold.sql`

### 2. Despliegue código
1. Nest `ce707c75c032eaf10cbde4e47859b6d122389f69`
2. Frontend `c484ca54c60ca471101ed6d2f79325a85615131f` (PR #5, no duplicar)
3. Comprobar Lead/VC + flags OFF

### 3. Activación web (separada)
recover (opc.) → LOCAL_PERSIST → DELIVERY FE+Nest → FLUSH → cita genuina → Events Manager (**recepción real pendiente**)

### 4. Reversión
Flags OFF (delivery OFF conserva Schedule pending sin Graph). Código previo si hace falta. No `17160000_down`.

## Correcciones Nest en este tip
1. Worker SQLite gate Schedule
2. Promote atómico review_hold→pending + carrera
3. Cursor id: 50 omitidas no bloquean la válida
