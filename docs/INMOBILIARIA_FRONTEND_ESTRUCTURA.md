# Módulo Inmobiliario - Estructura Frontend (Next.js + Supabase)

Documento para construir el esqueleto del frontend del módulo inmobiliario (equivalente a tu módulo `seller` de ventas, pero adaptado a inmobiliaria).

Incluye:
- Rutas/pages recomendadas (App Router)
- Servicios y hooks (capa de datos)
- Componentes principales (UI)
- Cómo mapear estados de inventario/leads/agendamientos
- Convenciones de carpetas para que sea fácil replicar en el nuevo proyecto

---

## 1) Rutas (pages) por módulo

Asumiendo un módulo con grupo de rutas tipo `/(seller)` en tu proyecto actual, en el nuevo proyecto se recomienda un prefijo similar:
- `/inmobiliaria/leads`
- `/inmobiliaria/showroom` (tráfico + visitas del asesor)
- `/inmobiliaria/agenda` (citas/agendamientos)
- `/inmobiliaria/inventario` (unidades por proyecto)
- `/inmobiliaria/proyectos` (opcional: listado/selección de proyecto para filtrar)
- `/inmobiliaria/contracts` (opcional - módulo extra cuando habiliten PDFs/anticipo)

### 1.1 Navegación (sidebar)
Recomendación de menú:
- `Leads`
- `Showroom & Tráfico`
- `Agenda`
- `Inventario`
- `Contratos` (opcional / solo si ya se habilitó)

Iconos sugeridos (para replicar estilo del sidebar actual):
- `Leads`: `UserPlus`
- `Showroom`: `Store` / `Landmark`
- `Agenda`: `CalendarDays`
- `Inventario`: `LayoutGrid`
- `Contratos`: `FileText`

---

## 2) Capa de datos (services)

Crear un service dedicado por módulo:
- `src/services/inmobiliaria.service.ts`

### Funciones recomendadas (contratos con el schema)

Inventario / Unidades:
- `listProjects(tenantId)`
- `listUnits({ tenantId, projectId, status, category, search, filters, pagination })`
- `getUnit(unitId)`
- `updateUnitStatus(unitId, newStatus)`
- `createUnit({...})` (si en el MVP hay altas manuales)
- `importUnitsFromExcel(files)` (opcional, si luego lo implementan)

Leads:
- `listLeads({ tenantId, projectId?, status?, search?, assignedTo?, pagination })`
- `getLead(leadId)` (incluye `lead_units`, si aplica)
- `createLead({...})`
- `updateLeadStatus(leadId, newStatus)`
- `addLeadInteraction({ leadId, type, content, result, responsibleId })`

Showroom:
- `listShowroomVisits({ tenantId, projectId?, salespersonId?, dateRange?, pagination })`
- `getShowroomVisit(visitId)`
- `createShowroomVisit({ source, office_id?, project_id?, lead_id?, client_name, units[] })`

Agenda:
- `listAppointments({ tenantId, responsibleId?, filters, dateRange?, status?, pagination })`
- `getAppointment(apptId)`
- `createAppointment({ leadId?, location_type, office_id?, project_id?, start_time, units[] })`
- `updateAppointmentStatus(apptId, newStatus)`
- `cancelAppointment(apptId)`

Cierre / Contratos:
- `recordUnitClosing({ unitId, leadId?, soldById, salePriceFinal, saleAt, notes })`
- `listContracts({ tenantId, leadId?, status?, pagination })`
- `uploadContractPdf(...)` (si usan storage; el service debe guardar `pdf_url`)

---

## 3) Hooks (lógica de UI + llamadas a Supabase)

Crear hooks por pantalla para mantener el componente `page.tsx` limpio.

- `src/hooks/inmobiliaria/useLeads.ts`
  - estado: `leads`, `totalCount`, `isLoading`, `filters`, `sort`, `pagination`
  - acciones: `reload`, `updateFilter`, `resetFilters`, `openLeadModal`

- `src/hooks/inmobiliaria/useInventoryUnits.ts`
  - estado: `units`, `processedUnits`, `allUnits`, `totalCount`, `filters`, `pagination`

- `src/hooks/inmobiliaria/useShowroom.ts`
  - estado: `visits`, `salespeople`, `filters`, `reload`

- `src/hooks/inmobiliaria/useAgenda.ts`
  - estado: `appointmentsPending`, `appointmentsHistory`, `filters`, `actions`

Si ya tienes patrones en `src/hooks/useAgenda`, `useShowroom`, etc., se recomienda copiar ese patrón y renombrar a inmobiliaria.

---

## 4) Componentes por módulo

### 4.1 Leads
Estructura sugerida:
- `src/components/inmobiliaria/leads/LeadsToolbar.tsx`
- `src/components/inmobiliaria/leads/LeadsList.tsx`
- `src/components/inmobiliaria/leads/LeadDetailModal.tsx`
- `src/components/inmobiliaria/leads/LeadInteractionsTimeline.tsx`
- `src/components/inmobiliaria/leads/LeadInteractionForm.tsx`

Contenido del `LeadDetailModal`:
- resumen del lead (nombre/teléfono/estado)
- unidades interesadas (lista de chips con `unit_number` + precio publicado + estado unidad)
- bitácora (`lead_interactions`)
- gestor de estado (dropdown + historial si aplica)

### 4.2 Inventario (Unidades por proyecto)
Estructura sugerida:
- `src/components/inmobiliaria/inventory/InventoryToolbar.tsx`
- `src/components/inmobiliaria/inventory/InventoryUnitsTable.tsx`
- `src/components/inmobiliaria/inventory/InventoryUnitCard.tsx` (si hay vista grid)
- `src/components/inmobiliaria/inventory/UnitDetailModal.tsx`
- `src/components/inmobiliaria/inventory/UnitStatusModal.tsx` (reservar/vender, etc.)

En `UnitDetailModal`:
- datos base (áreas, tipo, piso, parking_assigned)
- `published_commercial_price`
- estado actual (badge)
- si el negocio ya cerró:
  - mostrar `sale_price_final`
  - mostrar `sold_by` y fecha
  - botón para ver contrato (si el módulo extra está habilitado)

### 4.3 Showroom & Tráfico
Estructura sugerida:
- `src/components/inmobiliaria/showroom/ShowroomToolbar.tsx`
- `src/components/inmobiliaria/showroom/ShowroomVisitsTable.tsx`
- `src/components/inmobiliaria/showroom/ShowroomVisitCard.tsx`
- `src/components/inmobiliaria/showroom/VisitFormModal.tsx`

En el `VisitFormModal`:
- fuente: oficina/proyecto/mixto
- selector de `project` (si aplica)
- selector de unidades mostradas (multi-select)
- cliente: si se registra lead desde visita, vincular `lead_id` o crear en cascada

### 4.4 Agenda (Citas)
Estructura sugerida:
- `src/components/inmobiliaria/agenda/AppointmentCard.tsx`
- `src/components/inmobiliaria/agenda/AppointmentDetailModal.tsx`
- `src/components/inmobiliaria/agenda/AppointmentFormModal.tsx`
- `src/components/inmobiliaria/agenda/BotSuggestionsCard.tsx` (opcional, si reutilizas el patrón)

Campos clave de la cita:
- `location_type` y ubicación (office/proyecto)
- lead vinculado (opcional)
- unidades a mostrar (1 o varias)
- notas y estado

---

## 5) Componentes compartidos (UI)

Recomendados:
- `src/components/inmobiliaria/shared/StatusBadge.tsx`
- `src/components/inmobiliaria/shared/PriceText.tsx` (formatea moneda)
- `src/components/inmobiliaria/shared/UnitChips.tsx`
- `src/components/inmobiliaria/shared/FileUploader.tsx` (para contratos/anticipo)

---

## 6) Estados: mapeo a UI

### 6.1 Inventario (unidad)
Badges por estado:
- `disponible` => verde suave
- `en_preventa` => azul suave
- `reservado` => ámbar
- `en_proceso` => morado/azul
- `bajo_contrato` => gris
- `vendido` => rojo suave o neutral alto contraste
- `deshabilitado` => gris oscuro

### 6.2 Lead
El dropdown de lead status debe permitir:
- actualizar estado manualmente
- guardar interacción en bitácora cuando el usuario cambie estado (si quieres trazabilidad)

### 6.3 Citas / Agendamientos
Badges por status:
- `pendiente` / `aceptado` / `reprogramado`
- `atendido` / `cancelado`

---

## 7) Convenciones para el nuevo proyecto

Para que el nuevo proyecto quede mantenible:
- Mantener `services/` como capa única de acceso a Supabase.
- Mantener `hooks/` como capa de:
  - filtros, paginación, loading
  - transformar datos para UI (por ejemplo “units con badge status”)
- Mantener `components/` solo con UI (sin lógica compleja de negocio).

---

## 8) Lista corta de “MVP” para empezar rápido

1. `projects` y selector de `project_id`
2. `inventario` con tabla de `units` (filtrado por status/categoría/búsqueda)
3. `leads` list + `lead_units` multi-unidad + bitácora básica
4. `agenda` con creación/edición + asociación a lead + unidades
5. `showroom` con registro de visita + unidades mostradas
6. `unit closing`: al marcar vendido, se guarda `unit_sales_closings` y se muestra en UI

---

## 9) Supuestos/decisiones ajustables

Este esqueleto asume:
- una cita puede asociar múltiples unidades (tabla join) aunque la UI pueda usar solo 1 principal
- el cierre final de negocio se registra una vez por unidad (si más adelante necesitas múltiples cierres, se ajusta la constraint)
- contratos/PDF se dejan para un módulo extra

Si quieres, en la siguiente iteración hacemos un “plan de carpetas exacto” según el repo que ya tienes creado en la otra computadora (pero necesito que me digas sus rutas base o me pegues el árbol de `src/app` y `src/components`).

