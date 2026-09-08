# Dashboard de automatización comercial

Punto de restauración del frontend: `git checkout pre-lead-automation-dashboard`  
SHA: `ed754efea9047d8562ff2e34fff562a062541bb9`

Reversión SQL: ejecutar `supabase/migrations/20260903120000_lead_automation_dashboard_down.sql`.

## Objetos nuevos

- Vista `public.vw_lead_automation_dashboard` (`security_invoker = true`)
- RPC `public.get_lead_automation_kpis(p_tenant_id, p_project_id, p_from, p_to)` (`SECURITY INVOKER`)
- Policies de **solo SELECT** para `authenticated` en tablas de automatización que ya tenían RLS activo y **cero policies** (sin ellas PostgREST devolvía vacío):
  - `conversations`
  - `messages`
  - `lead_score_events`
  - `lead_temperature_history`
  - `lead_stage_history`
  - `bot_escalations`
  - `lead_nutrition`
  - `nutrition_delivery_history`
  - `lead_scoring_rules`

No se añadieron policies de INSERT/UPDATE/DELETE. El dashboard es de solo lectura.

## Permisos

```sql
GRANT SELECT ON public.vw_lead_automation_dashboard TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lead_automation_kpis(uuid, uuid, timestamptz, timestamptz) TO authenticated;
```

`anon` no recibe acceso. La pantalla usa el cliente de sesión (`NEXT_PUBLIC_SUPABASE_ANON_KEY` + JWT), nunca `SUPABASE_SERVICE_ROLE_KEY`.

## Aislamiento por tenant

El CRM ya filtra por `tenant_id` en aplicación (`getAccessibleTenantIds`). Las policies históricas de `leads`, `projects` y `tenants` son `USING (true)` para `authenticated`; esta entrega **no las reescribe** para no romper n8n ni el resto del CRM.

La vista hereda RLS de las tablas base. El frontend y el RPC siempre reciben `tenant_id` (y `project_id` si hay filtro). Un usuario autenticado de otro tenant no debería ver datos si en el futuro se endurece RLS; hoy el aislamiento efectivo es el mismo que en Leads/Inventario.

## SLA

```
no_aplica   → seller_response_due_at IS NULL
respondido  → seller_first_response_at IS NOT NULL
vencido     → due_at < now() y sin respuesta
pendiente   → due_at >= now() y sin respuesta
```

## Pestaña Reglas

La UI de parámetros vive en `/inmobiliaria/automatizacion/reglas`. El guion del bot vive en `/inmobiliaria/automatizacion/guion`. Estado actual: `docs/AUTOMATION_APP_STATE.md`. Reversión de reglas: `docs/AUTOMATION_RULES.md`. No hace falta borrar el dashboard para deshacer las reglas.
