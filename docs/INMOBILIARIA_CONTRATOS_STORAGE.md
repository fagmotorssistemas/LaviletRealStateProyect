# Storage (Supabase) - Módulo Contratos

Este documento describe el bucket y la convención de rutas que usa el módulo de `contratos` para subir:
- el **PDF del contrato**
- el **comprobante del anticipo**

## Bucket requerido

El frontend sube archivos a este bucket:

`contracts-docs`

Rutas (path) que se generan desde el código:
- Contrato PDF: `{tenantId}/contracts/{contractId}/contrato.pdf`
- Comprobante anticipo: `{tenantId}/contracts/{contractId}/anticipo/{nombre_original_sanitizado}`

## SQL (base) para crear bucket y policies

Ejecuta esto en Supabase SQL Editor:

```sql
-- 1) Bucket
insert into storage.buckets (id, name, public)
values ('contracts-docs', 'contracts-docs', true)
on conflict (id) do nothing;

-- 2) Policies (RLS en storage.objects)
alter table storage.objects enable row level security;

-- Permite que usuarios autenticados suban/actualicen/eliminan archivos dentro del bucket
create policy "contracts-docs: authenticated insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'contracts-docs');

create policy "contracts-docs: authenticated update"
on storage.objects
for update
to authenticated
using (bucket_id = 'contracts-docs')
with check (bucket_id = 'contracts-docs');

create policy "contracts-docs: authenticated delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'contracts-docs');
```

> Nota: como el bucket está marcado como `public = true`, la apertura desde el frontend usa la URL pública devuelta por `getPublicUrl`, sin URLs firmadas.

## Recomendación de seguridad (opcional)

Si quieres restringir el acceso por tenant (no solo “authenticated”), tendrás que:
- definir cómo se determina el tenant del usuario (tabla de membresía, claims, etc.)
- crear policies que validen el `tenantId` presente en el path del objeto.

El archivo define una policy “base” para habilitar la funcionalidad rápidamente.

