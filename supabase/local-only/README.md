# Migraciones solo locales (NO producción)

Archivos aquí **no** forman parte del path `supabase/migrations` que aplica
`supabase db push` / migrate-all contra Production.

| Archivo | Uso |
| --- | --- |
| `20260918210000_local_crm_auth_profiles.sql` | Bootstrap auth/profiles/tenant demo en stack local (`127.0.0.1:54321`). |

Aplicar solo contra el Postgres local del frontend, p. ej.:

```bash
docker exec -i supabase_db_frontend psql -U postgres < supabase/local-only/20260918210000_local_crm_auth_profiles.sql
```

Credenciales de admin demo (`admin.local@lavilet.local`) viven en `.env.local-admin.local`
(gitignored vía `.env*`). Nunca copiar usuarios/secretos de Production.
