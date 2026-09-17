# Propuesta ejecutable — Schedule web (candidatos congelados)

**Estado:** candidatos de entrega listos. **No** merge, **no** despliegue, **no** migraciones Production, **no** activación de flags, **no** eventos Meta reales en este documento.

WhatsApp Schedule permanece **bloqueado**. Pixel / CAPI Lead·ViewContent **intactos** (sin cambio de contrato).

---

## 0. SHA congelados (candidatos)

| Pieza | Repo | Rama | SHA completo |
| --- | --- | --- | --- |
| Frontend | `fagmotorssistemas/LaviletRealStateProyect` | `feat/meta-schedule-aceptar-cita` | `c8c2ad5abe6b6631842880f50f8f153c8d496052` |
| Nest | `fagmotorssistemas/backend-La-Vilet` | `fix/supabase-drain-exclude-review-hold` | `6e787347b48741e8c0edd0f2c143b110c470a8b8` |

Builds locales verificados sobre esos SHA (2026-09-17):

| SHA | Comando | Resultado |
| --- | --- | --- |
| `c8c2ad5…` | `npm run build` | OK |
| `6e78734…` | `npm run build` + jest drain/BM/Schedule payload | OK (3 suites / 9 tests) |

Cualquier commit posterior **no** es candidato hasta re-congelar.

---

## 1. Pull requests (crear; no mergear)

`gh` no autenticado en el entorno de preparación. Crear con:

### Frontend → `main`

Compare: https://github.com/fagmotorssistemas/LaviletRealStateProyect/compare/main...feat/meta-schedule-aceptar-cita?expand=1

```bash
cd frontend
git checkout feat/meta-schedule-aceptar-cita
git rev-parse HEAD   # debe ser c8c2ad5abe6b6631842880f50f8f153c8d496052

gh pr create --base main --head feat/meta-schedule-aceptar-cita \
  --title "feat: Schedule Meta tras Aceptar cita (web gated, WA bloqueado)" \
  --body "$(cat <<'EOF'
## Summary
- Persistencia durable Schedule (intent + outbox `review_hold`) tras `confirmed_by_client`, gated por flags OFF por defecto.
- Recover cierra hueco confirm→intent (`17170000`, firma única Nest `{p_limit}`).
- WhatsApp Schedule bloqueado (`needs_review`); Pixel/CAPI Lead·VC sin cambio de contrato.

## Candidate SHA
`c8c2ad5abe6b6631842880f50f8f153c8d496052`

## Test plan
- [ ] `npm run test:meta-schedule` + `npm run build` en el SHA
- [ ] `powershell -File scripts/meta-schedule-recover-isolated/run.ps1`
- [ ] Migraciones 152000→160000→170000 solo en entorno de revisión (no Production en este PR)
- [ ] Flags Schedule todos `false` en Preview/Production hasta runbook
- [ ] No merge hasta aprobación explícita de despliegue

EOF
)"
```

### Nest → `main`

Compare: https://github.com/fagmotorssistemas/backend-La-Vilet/compare/main...fix/supabase-drain-exclude-review-hold?expand=1

```bash
cd lavilet-meta-capi
git checkout fix/supabase-drain-exclude-review-hold
git rev-parse HEAD   # debe ser 6e787347b48741e8c0edd0f2c143b110c470a8b8

gh pr create --base main --head fix/supabase-drain-exclude-review-hold \
  --title "fix: drain Schedule gated; BM reject; recover p_limit" \
  --body "$(cat <<'EOF'
## Summary
- Drain Supabase: solo `pending`; Schedule requiere `META_SCHEDULE_DELIVERY_ENABLED`.
- BM sin remap a dataset web; Schedule+BM rechazado.
- Recover Schedule: body Nest solo `{p_limit:50}` contra firma PG única.

## Candidate SHA
`6e787347b48741e8c0edd0f2c143b110c470a8b8`

## Test plan
- [ ] `npx jest src/drain/supabase-drain.service.spec.ts src/meta/schedule-graph.payload.spec.ts src/events/events.bm-gates.spec.ts --runInBand`
- [ ] `npm run build`
- [ ] Flags Schedule `false` hasta runbook; Pixel/Lead/VC intactos
- [ ] No merge hasta aprobación explícita

EOF
)"
```

Orden de merge (cuando se autorice): **Nest PR → Frontend PR** (Nest debe existir antes del flush FE). Migraciones Supabase **antes** de activar recover/persist.

---

## 2. Migraciones exactas (Supabase — entorno de revisión primero)

Aplicar **en este orden**, archivos del SHA frontend `c8c2ad5…`:

1. `supabase/migrations/20260917152000_meta_capi_outbox_review_hold.sql`
2. `supabase/migrations/20260917160000_meta_schedule_recovery.sql`
3. `supabase/migrations/20260917170000_meta_schedule_recover_pre_intent.sql`

Post-check (solo lectura):

```sql
SELECT pg_get_function_identity_arguments(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'lv_recover_missing_meta_schedule_outbox';
-- Esperado: una fila → p_limit integer, p_lookback_days integer
```

**No** aplicar a Production hasta autorización separada. **No** ejecutar `supabase/rollbacks/*_down.sql` como rollback operativo.

---

## 3. Variables por entorno

Valores booleanos Schedule: solo `true` / omitido-o-otro (= off). Intactos: `META_CAPI_*`, Pixel, dataset web, drain Lead/VC.

### 3.1 Preview / staging (post-deploy código + migraciones revisión)

| Variable | Dónde | Valor inicial |
| --- | --- | --- |
| `META_SCHEDULE_LOCAL_PERSIST` | FE (Vercel server) | `false` / unset |
| `META_SCHEDULE_FLUSH` | FE | `false` / unset |
| `META_SCHEDULE_DELIVERY_ENABLED` | FE **y** Nest | `false` / unset |
| `META_SCHEDULE_RECOVER_ENABLED` | Nest (drain) | `false` / unset |
| `META_CAPI_BACKEND_URL` | FE | (existente — no tocar) |
| `META_CAPI_INTERNAL_SECRET` | FE + Nest | (existente — no tocar) |
| `META_CAPI_DELIVERY_LANE` | FE / Nest | (existente; Schedule no envía hasta delivery) |
| `META_MODE` / `META_DATASET_ID` / Pixel | Nest / FE público | **sin cambio** |
| `SUPABASE_DRAIN_ENABLED` | Nest | (existente; Lead/VC siguen) |

### 3.2 Production (cuando se autorice el mismo paquete)

Mismos defaults **OFF** para las cuatro `META_SCHEDULE_*`. No activar en el mismo paso que el deploy de código.

---

## 4. Orden de activación — Schedule **web** únicamente

Ejecutar solo tras: PRs mergeados (si aplica), migraciones aplicadas en el entorno objetivo, builds del SHA desplegados, las cuatro flags en `false`.

| Paso | Acción | Criterio de salida |
| --- | --- | --- |
| A | Deploy Nest `6e78734…` + FE `c8c2ad5…` con Schedule OFF | Health OK; Lead/VC drain sin cambio observable |
| B | Migraciones 1→2→3 en ese entorno | Firma RPC única; `needs_review`+`review_hold` en CHECK |
| C | (Opcional test) `META_SCHEDULE_RECOVER_ENABLED=true` solo Nest | Recover no inventa `pending` ni `website` para WA |
| D | `META_SCHEDULE_LOCAL_PERSIST=true` (FE) | Tras **cita genuina** (paso 5): intent + `review_hold` |
| E | `META_SCHEDULE_DELIVERY_ENABLED=true` (FE + Nest) | Promote solo cita actual revalidada → `pending` |
| F | `META_SCHEDULE_FLUSH=true` (FE) | Flush FE→Nest; drain envía Schedule **website** |
| G | Events Manager (dataset **web**) | Un Schedule atribuible a la cita del paso 5 |

**Nunca** activar delivery/flush para WhatsApp. Canal WhatsApp debe permanecer `needs_review` / reject Nest.

Si algo falla en E–G: ir a §6 (flags off) **antes** de tocar esquema.

---

## 5. Verificación — primera cita genuina (sin fabricar)

No crear leads, citas ni POST a Meta/Graph. Usar la **próxima** (o la más reciente post-paso D) confirmación real de cliente en canal **web** con consentimiento.

### 5.1 Elegir candidata (solo lectura)

```sql
SELECT a.id AS appointment_id,
       a.lead_id,
       a.channel,
       a.status,
       a.confirmed_by_client,
       a.confirmed_at,
       a.meta_schedule_event_id,
       a.meta_schedule_event_time,
       l.meta_ads_consent,
       o.status AS outbox_status,
       o.last_error
FROM public.appointments a
JOIN public.leads l ON l.id = a.lead_id
LEFT JOIN public.meta_capi_outbox o
  ON o.idempotency_key = 'schedule:' || a.id::text
WHERE a.confirmed_by_client IS TRUE
  AND a.status IN ('aceptado', 'reprogramado')
  AND lower(trim(coalesce(a.channel, ''))) IN ('web', 'website')
  AND l.meta_ads_consent IS TRUE
  AND a.confirmed_at >= now() - interval '7 days'
ORDER BY a.confirmed_at DESC
LIMIT 5;
```

Elegir una fila **real** del negocio. Si no hay ninguna: **esperar** confirmación orgánica; no insertar filas de prueba ni disparar eventos.

### 5.2 Tras paso D (persist)

Sobre esa `appointment_id`:

- `meta_schedule_event_id` / `meta_schedule_event_time` no nulos; `event_time` = epoch de `confirmed_at`.
- Outbox `schedule:{id}` en `review_hold` (no `pending`).
- Cita sigue `confirmed_by_client` / status intactos.

### 5.3 Tras pasos E–F (delivery + flush)

- Misma clave: status `pending` → luego `forwarded` (o equivalente Nest).
- Events Manager dataset web: un Schedule con el `event_id` de la cita.
- Ningún Schedule WhatsApp/BM enviado.

### 5.4 Control negativo WhatsApp (lectura)

Si existe cita WA confirmada en lookback: outbox `needs_review` + `whatsapp_schedule_delivery_blocked` (o ausencia de envío). No promover.

---

## 6. Reversión operativa (flags + código; conserva datos)

1. Poner `META_SCHEDULE_LOCAL_PERSIST`, `META_SCHEDULE_RECOVER_ENABLED`, `META_SCHEDULE_DELIVERY_ENABLED`, `META_SCHEDULE_FLUSH` → unset/`false` en FE y Nest.
2. Redeploy o revert de código a SHA pre-candidato si hace falta comportamiento previo.
3. **Conservar** filas `meta_capi_outbox`, columnas `meta_schedule_*`, consent ledger, Pixel/CAPI.
4. **No** ejecutar `rollbacks/20260917160000_…_down.sql` (DROP de columnas intent).
5. `down.sql` de `17170000` / `17152000` solo emergencia manual explícita.

---

## 7. Fuera de alcance (no hacer en esta entrega)

- Merge / promote Production sin autorización.
- Activar Schedule WhatsApp / BM / remap a dataset web.
- Cambiar Pixel, Lead, ViewContent, dataset web o secretos CAPI.
- Fabricar contactos, citas o eventos Graph para “probar”.
- Ejecutar `down.sql` como rollback por defecto.

---

## 8. Checklist de go / no-go

- [ ] PRs abiertos apuntando a los SHA congelados
- [ ] Builds verdes en esos SHA
- [ ] Migraciones listadas; aún **no** aplicadas a Production
- [ ] Cuatro flags Schedule OFF en todos los entornos hasta §4
- [ ] Plan §5 listo (cita genuina; sin fabricar)
- [ ] Rollback §6 entendido
- [ ] WhatsApp Schedule bloqueado; Pixel/CAPI intactos

**Go** solo con aprobación explícita para merge → migraciones revisión → activación por pasos.
