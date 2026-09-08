# Reglas de automatización

Pestaña **Reglas** dentro de Automatización. El monitoreo (`/inmobiliaria/automatizacion`) no se reemplaza.

## Cómo revertir

**Frontend** (deja el dashboard como estaba):

- Borrar:
  - `src/app/inmobiliaria/automatizacion/reglas/`
  - `src/app/inmobiliaria/automatizacion/actions.ts`
  - `src/components/inmobiliaria/automation/AutomationSectionTabs.tsx`
  - `src/components/inmobiliaria/automation/AutomationRulesView.tsx`
  - `src/services/automationRules.service.ts`
  - `src/types/automationRules.ts`
  - `src/lib/inmobiliaria/automationRules.ts`
  - `src/lib/inmobiliaria/automationRules.test.ts`
- En `src/app/inmobiliaria/automatizacion/page.tsx` quitar `AutomationSectionTabs`.
- En `src/components/layout/InmobiliariaRouteKey.tsx` quitar `'/inmobiliaria/automatizacion'` si se añadió solo por esto.

El dashboard de monitoreo no depende de estas reglas.

**SQL** (vuelve SLA 120 y cortes 25/60 hardcodeados):

```sql
-- ejecutar en el SQL editor de Supabase
-- contenido de:
supabase/migrations/20260905140000_automation_rules_down.sql
```

No borra `project_automation_config`, `project_salespeople`, `lead_scoring_rules` ni `nutrition_steps`. Solo quita las columnas nuevas y restaura las funciones.

## Qué cambió en la base

- `project_automation_config.sla_response_minutes` (default 120)
- `project_automation_config.temperature_warm_min` (default 25)
- `project_automation_config.temperature_hot_min` (default 60)
- `apply_lead_events` lee los cortes
- `handoff_lead` lee el SLA
- `is_project_open`: si `is_active = false`, el proyecto cuenta como cerrado (no lanza excepción)
