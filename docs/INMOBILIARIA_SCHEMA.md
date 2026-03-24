# Módulo Inmobiliario (Venta) - Schema BD (Supabase/Postgres)

Documento de diseño para construir una base de datos equivalente al módulo de *ventas* del proyecto actual, pero adaptado a inmobiliaria:
- **Inventario** por *Proyecto/Edificio* con unidades (departamentos, locales, suites, etc.)
- **Showroom / tráfico**: actividad de asesores mostrando unidades (en oficina y/o en el proyecto)
- **Agendamientos**: citas para visitar/mostrar unidades (ubicación definida por la cita)
- **Leads** con **gestión/bitácora** y conexión a múltiples unidades
- **Negociación / cierre**: se guarda la **bitácora del precio final de cierre** (el precio publicado no se borra)
- **Multitenant**: por **Inmobiliaria/Empresa**, con “diferenciador” por **Proyecto/Edificio** dentro de la empresa

---

## 1) Supuestos de negocio (según tus respuestas)

1. **Tenant (multitenant)** = `inmobiliaria/empresa`.
2. Cada empresa tiene múltiples **proyectos/edificios**.
3. El **inventario** se modela como:
   - `proyecto` (edificio)
   - `unidad` (cada departamento/local/suite, etc.)
4. **Estados de unidad** (inventario) (todos los que propusiste):
   - `disponible`
   - `en_preventa`
   - `reservado`
   - `en_proceso`
   - `bajo_contrato`
   - `vendido`
   - `deshabilitado`
5. **Parqueaderos**: NO inventariar cada spot; solo guardar asignación/contadores como atributo de la unidad.
6. **Leads**:
   - un lead puede interesarse en **múltiples unidades** (`lead_units`)
   - la gestión incluye cambiar estado y además guardar **bitácora/acciones** del lead
7. **Negociación / cierre**:
   - se guarda registro del **precio final de cierre** (ej: `publicado=98k`, `cerrado=95k`)
   - se guarda quién vendió (asesor responsable)
   - el **precio publicado** se mantiene como “referencia histórica”

---

## 2) Entidades principales

- `tenants` (inmobiliarias/empresas)
- `projects` (proyectos/edificios)
- `units` (unidades del inventario)
- `leads` (prospectos) + `lead_units` (lead <-> unidades múltiples)
- `appointments` (agendamientos/citas) y/o `appointment_units` (si una cita aplica a varias unidades)
- `showroom_visits` + `showroom_visit_units` (tráfico del asesor con unidades mostradas)
- `lead_interactions` (bitácora/gestión del lead)
- `unit_sales_closings` (bitácora del precio final de cierre; el precio publicado no se borra)
- (opcional) `contracts` y `contract_units` (cuando se habilite módulo extra para PDFs/anticipo)

---

## 3) Propuesta de tablas (estructura recomendada)

> Nota: este documento es de diseño. No se asume que este orden sea el ideal para migraciones. Puedes convertirlo luego a migrations y RLS.

### 3.1 `tenants`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | pk |
| `name` | text | nombre de la inmobiliaria |
| `ruc` | text | opcional |
| `address` | text | opcional |
| `phone` | text | opcional |
| `email` | text | opcional |
| `is_active` | boolean | default true |
| `created_at` | timestamptz | default now() |

### 3.2 `projects`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | pk |
| `tenant_id` | uuid | fk -> `tenants(id)` |
| `name` | text | "EDIFICIO PUERTAS DEL SOL" |
| `address` | text | |
| `estimated_projection_date` | date | desde excel (fecha_proyeccion) |
| `architects` | text | |
| `plan_type` | text | "PLAN COMERCIAL TENTATIVO..." |
| `policies_json` | jsonb | forma_pago + descuentos_preventa + reglas cash (flexible) |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now() |

`policies_json` recomendado:
- `forma_pago`:
  - `anticipo_porcentaje`
  - `durante_construccion_porcentaje`
  - `al_final_porcentaje`
- `descuentos_preventa` array:
  - `months_anticipation`
  - `discount_percent`
- `cash_discount_rule` text (o json)

### 3.3 `units` (inventario inmobiliario)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | pk |
| `tenant_id` | uuid | fk -> `tenants` (para aislamiento) |
| `project_id` | uuid | fk -> `projects` |
| `category` | text | "Departamento", "Local Comercial", etc. |
| `unit_number` | text | "201", "601", "7", etc. (único dentro de proyecto) |
| `unit_subtype` | text | ej: suite, 1_dormitorio, 2_dormitorios, 2_5_dormitorios... |
| `floor` | text | ej: "PB", "PA - ISLA" |
| `area_internal_m2` | numeric | |
| `area_terrace_m2` | numeric | default 0 |
| `parking_assigned` | integer | parqueos asignados (ej: 2) |
| `cost_per_m2_internal` | numeric | `costo_m2_interno` |
| `published_commercial_price` | numeric | valor_comercial_total del excel (PRECIO PRINCIPAL; no se borra) |
| `status` | text/enum | estados listados arriba |
| `description` | text | opcional |
| `slug` | text | opcional, útil para URLs |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now() |

Restricciones recomendadas:
- `unique (tenant_id, project_id, unit_number)`

### 3.4 `unit_media` (opcional, pero recomendado)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | pk |
| `unit_id` | uuid | fk -> `units` |
| `type` | text | `main`, `gallery` (o más) |
| `url` | text | |
| `sort_order` | integer | opcional |

### 3.5 `offices` (oficinas/sala de atención) - para showroom

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | pk |
| `tenant_id` | uuid | fk |
| `name` | text | "Showroom principal", etc. |
| `address` | text | |
| `phone` | text | opcional |
| `created_at` | timestamptz | default now() |

Si en tu operación “showroom” es más bien “el proyecto”, puedes dejar `offices` mínima o incluso prescindirla y usar solo `project_id` en visitas.

### 3.6 `profiles` (reutilizas tu tabla actual de auth/perfiles)

En este diseño asumimos que `profiles(id, full_name, role, ...)` ya existe como en tu proyecto actual.

### 3.7 Asignación asesor <-> proyecto (recomendado)

| Campo | Tipo | Notas |
|---|---|---|
| `project_salespeople` | table join | |
| `id` | uuid | pk |
| `tenant_id` | uuid | fk |
| `project_id` | uuid | fk |
| `salesperson_id` | uuid | fk -> `profiles(id)` |
| `role_in_project` | text | `asesor`/`vendedor`/etc si quieres distinguir |
| `created_at` | timestamptz | default now() |

### 3.8 `leads`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | pk |
| `tenant_id` | uuid | fk |
| `name` | text | nombre del cliente / razón social |
| `phone` | text | |
| `email` | text | opcional |
| `status` | text/enum | estados de lead (no los fijamos aquí; ver sugerencia abajo) |
| `budget` | numeric | opcional |
| `financing` | boolean | opcional |
| `assigned_to` | uuid | fk -> `profiles(id)` |
| `source` | text | opcional |
| `resume` | text | resumen/observaciones |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now() |

Sugerencia de estados `lead.status` (para UI):
- `nuevo`
- `interesado`
- `en_contacto`
- `agendado`
- `en_negociacion`
- `reservado`
- `vendido`
- `no_interesado`

### 3.9 `lead_units` (lead -> múltiples unidades)

| Campo | Tipo | Notas |
|---|---|---|
| `lead_id` | uuid | fk -> `leads` |
| `unit_id` | uuid | fk -> `units` |
| `priority` | integer | opcional (para ordenar unidades en UI) |
| `created_at` | timestamptz | default now() |

Restricción:
- `unique (lead_id, unit_id)`

### 3.10 `lead_interactions` (bitácora/gestión del lead)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | pk |
| `tenant_id` | uuid | fk |
| `lead_id` | uuid | fk |
| `responsible_id` | uuid | fk -> `profiles(id)` |
| `type` | text/enum | llamada, whatsapp, visita, propuesta, seguimiento, etc. |
| `content` | text | detalle |
| `result` | text | resultado/nota del asesor |
| `created_at` | timestamptz | default now() |

### 3.11 `appointments` (agendamientos/citas)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | pk |
| `tenant_id` | uuid | fk |
| `lead_id` | uuid | fk -> `leads` (puede ser null si es walk-in) |
| `responsible_id` | uuid | fk -> `profiles(id)` |
| `title` | text | ej "Visita proyecto" |
| `start_time` | timestamptz | |
| `end_time` | timestamptz | opcional |
| `status` | text/enum | pendiente/aceptado/reprogramado/atendido/cancelado |
| `location_type` | text | `oficina`, `proyecto`, `mixto` |
| `office_id` | uuid | nullable fk -> `offices` |
| `project_id` | uuid | nullable fk -> `projects` |
| `notes` | text | |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now() |

Para asociar unidades a la cita (si una cita aplica a varias):
- Opción simple (recomendada para MVP): `primary_unit_id` nullable
- Opción flexible: tabla `appointment_units`

Aquí proponemos la tabla flexible:
### 3.12 `appointment_units`

| Campo | Tipo | Notas |
|---|---|---|
| `appointment_id` | uuid | fk |
| `unit_id` | uuid | fk |
| `created_at` | timestamptz | default now() |

Restricción:
- `unique (appointment_id, unit_id)`

### 3.13 `showroom_visits` (tráfico / visitas del asesor)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid/ bigint | pk |
| `tenant_id` | uuid | fk |
| `salesperson_id` | uuid | fk -> `profiles(id)` |
| `source` | text/enum | `oficina`, `proyecto`, `mixto` |
| `office_id` | uuid | nullable |
| `project_id` | uuid | nullable |
| `lead_id` | uuid | nullable (si ya existe lead) |
| `client_name` | text | para walk-ins |
| `phone` | text | opcional |
| `visit_start` | timestamptz | default now() |
| `visit_end` | timestamptz | nullable |
| `notes` | text | |
| `created_at` | timestamptz | default now() |
| `updated_at` | timestamptz | default now() |

Para unidades mostradas:
### 3.14 `showroom_visit_units`

| Campo | Tipo | Notas |
|---|---|---|
| `showroom_visit_id` | uuid | fk |
| `unit_id` | uuid | fk |
| `created_at` | timestamptz | default now() |

Restricción:
- `unique (showroom_visit_id, unit_id)`

### 3.15 `unit_sales_closings` (bitácora del precio final de cierre)

Esta es la tabla que responde exactamente tu requisito:
- mantener precio publicado como “main”
- almacenar precio final al cerrar
- registrar quién cerró y su fecha

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | pk |
| `tenant_id` | uuid | fk |
| `unit_id` | uuid | fk -> `units` |
| `lead_id` | uuid | fk -> `leads` (nullable) |
| `sold_by_id` | uuid | fk -> `profiles(id)` |
| `published_price_snapshot` | numeric | snapshot del precio publicado en el momento del cierre |
| `sale_price_final` | numeric | el precio real de cierre (ej: 95k) |
| `sale_at` | timestamptz | fecha/hora del cierre |
| `notes` | text | razón/observaciones |
| `created_at` | timestamptz | default now() |

Restricción recomendada (si cada unidad se cierra una sola vez):
- `unique (unit_id)` sobre la tabla

Si más adelante permites reservaciones/retrocesos y cierres múltiples, se quita esa unique.

Al cerrar:
- `units.status` pasa a `vendido` (o `bajo_contrato` según tu proceso interno)
- se crea registro en `unit_sales_closings`

---

## 4) Contratos / PDFs / anticipo (opcional - módulo extra)

Como pediste, es una etapa extra para cuando el lead llega a “vendido”:

### 4.1 `contracts`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | pk |
| `tenant_id` | uuid | fk |
| `lead_id` | uuid | fk |
| `contract_number` | text | opcional |
| `status` | text | pendiente / firmado / anulado |
| `pdf_url` | text | evidencia contrato |
| `anticipo_amount` | numeric | opcional |
| `anticipo_date` | date | opcional |
| `anticipo_proof_url` | text | opcional |
| `created_by` | uuid | fk -> profiles |
| `created_at` | timestamptz | default now() |

### 4.2 `contract_units` (si el contrato incluye múltiples unidades)

| Campo | Tipo |
|---|---|
| `contract_id` | uuid fk |
| `unit_id` | uuid fk |

---

## 5) Flujo funcional (equivalente al módulo actual)

### 5.1 Alta de proyecto y unidades (inventario manual)
1. Crear `tenant`
2. Crear `project`
3. Cargar `units` con:
   - categoría/subtipo
   - número/unidad
   - áreas internas/terraza
   - parking_assigned
   - published_commercial_price
   - status inicial (ej: `disponible` o `en_preventa`)

### 5.2 Leads y gestión
1. Crear `lead`
2. Seleccionar múltiples `units` en `lead_units`
3. Registrar interacciones en `lead_interactions` (llamadas, mensajes, etc.)
4. Cambiar `lead.status` según avance

### 5.3 Agendamientos
1. Crear `appointment` ligado a `lead` (o sin lead si es walk-in)
2. Definir `location_type` (oficina/proyecto/mixto) y asociar unidades en `appointment_units`

### 5.4 Showroom / tráfico
1. Registrar `showroom_visits`
2. Asociar unidades mostradas con `showroom_visit_units`
3. Si se crea lead desde walk-in, se conecta `lead_id`

### 5.5 Cierre y bitácora de precio final
1. Cambiar `units.status` a `reservado` o `vendido` (según tu proceso)
2. Al cierre final:
   - crear `unit_sales_closings` con `sale_price_final` y `sold_by_id`
   - snapshot del `published_commercial_price`

---

## 6) Qué necesito de ti para ajustar (check rápido)

Antes de convertir este diseño a migraciones/mapping exacto, solo confirmaría:
1. ¿Al cerrar negocio, una unidad puede tener **solo un** cierre final? (recomendado `unique unit_id`)
Si solo puede tener un solo cierre final 
2. ¿`reservado` tiene anticipo/contrato o anticipo solo en `vendido`?
El reservado tambien tiene un anticipo/contrato
3. ¿Una cita puede incluir *varias* unidades en paralelo (por flexibilidad) o en UI siempre será 1 unidad principal?
Si puede tener varias unidades a visitar

Si respondes eso, el schema queda “cerrado” al 100%.

