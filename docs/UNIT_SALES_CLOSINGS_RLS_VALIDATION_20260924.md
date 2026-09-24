# Validación RLS de cierres y dependencias de activación

## Alcance local

La migración preparada es
`supabase/migrations/20260924183000_unit_sales_closings_scoped_authorization.sql`.
No se aplicó en ningún entorno remoto y no se tocaron datos comerciales.

La política exige que un asesor escriba únicamente un cierre cuyo `sold_by_id`
sea su propio `auth.uid()` y cuya unidad pertenezca a un proyecto asignado a ese
asesor dentro del mismo tenant. El administrador puede operar entre proyectos.
Un usuario sin asignación no obtiene filas ni puede escribir. Las políticas
restrictivas de INSERT y UPDATE impiden que otra política permisiva futura abra
accidentalmente esas escrituras.

## Resultado de la validación disponible

- La revisión estática confirma revocación de `anon`, CRUD para `authenticated`,
  acceso de `service_role`, separación por tenant/proyecto y control de
  `sold_by_id`.
- Se verificó de forma ejecutable el predicado de autorización con identidades de
  administrador, asesor asignado, asesor de otro proyecto y usuario sin asignación.
- La ejecución RLS completa no puede certificarse con PGlite: la versión local no
  aplica RLS con fidelidad. El arnés demostró que una política SELECT permisiva podía
  dejar pasar un INSERT que su `WITH CHECK` negaba. Por ello se retiró ese arnés y
  no se presenta como validación funcional de PostgreSQL/Supabase.
- El equipo local no tiene un servidor PostgreSQL ni Docker disponible. La prueba
  funcional con JWT/roles reales sigue pendiente en una base aislada.

## Matriz funcional para el entorno aislado

| Identidad | Lectura | INSERT/UPDATE esperado |
| --- | --- | --- |
| Administrador | Todos los proyectos autorizados por su rol | Permitido, incluida operación entre proyectos |
| Asesor A | Sus cierres y los del proyecto A | Solo unidad del proyecto A y `sold_by_id = auth.uid()` |
| Asesor B | Sus cierres y los del proyecto B | No puede operar en el proyecto A |
| Sin asignación | Ninguna fila | Denegado |

Además deben probarse: tenant distinto, unidad de otro proyecto, cambio de
`sold_by_id`, UPDATE de un cierre ajeno y DELETE reservado al administrador. Un
UPDATE/DELETE ocultado por `USING` puede afectar cero filas en vez de devolver un
error; la prueba debe comprobar también el número de filas afectadas.

## Dependencias exactas antes del despliegue

1. Tablas y columnas: `unit_sales_closings(tenant_id, unit_id, sold_by_id,
   sale_at, registered_at)`, `units(id, tenant_id, project_id)` y
   `project_salespeople(tenant_id, project_id, salesperson_id)`.
2. Funciones previas: `public.is_admin()` y
   `public.lv_shares_project(uuid, uuid)`, ambas con el comportamiento vigente del
   CRM. La migración crea `public.lv_can_write_unit_sale(uuid, uuid, uuid)` como
   `SECURITY DEFINER`, fija `search_path=public` y limita EXECUTE a
   `authenticated` y `service_role`.
3. Roles Supabase: `anon`, `authenticated` y `service_role`. `authenticated`
   necesita SELECT sobre `units` para evaluar la política de lectura; la
   autorización de escritura consulta las tablas internas mediante la función
   protegida.
4. Índices: la clave de `units.id` debe existir. La propia migración crea, de
   forma idempotente, `project_salespeople(salesperson_id, project_id, tenant_id)`
   y los índices de `unit_sales_closings(unit_id)`, `(tenant_id)` y
   `(sold_by_id)` para evitar que RLS fuerce barridos completos.
5. Ejecutar antes y después
   `operations/verify_unit_sales_closings_rls_readonly.sql`. Después deben existir
   exactamente las seis políticas declaradas por la migración y ninguna política
   abierta adicional.
6. Desplegar backend y frontend solo después de que la prueba aislada con JWT pase.
   Mantener apagados los productores durante el cambio; habilitarlos después del
   postflight. La activación CAPI conserva los flags y carriles del contrato final.

Esta validación no envía eventos a Meta. La deduplicación Pixel/CAPI y los estados
de Meta siguen dependiendo de la prueba integrada local acordada con el backend.
