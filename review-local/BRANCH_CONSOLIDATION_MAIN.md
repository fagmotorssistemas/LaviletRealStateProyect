# Consolidación de ramas → solo `main` (sin push)

Fecha: 2026-09-18  
Restricción respetada: **ningún push ni borrado remoto** en esta pasada.

## SHAs nuevos de `main` (locales)

| Repo | Remote GitHub | HEAD local |
| --- | --- | --- |
| Frontend | LaviletRealStateProyect | `7b2ec1d296b2166735d7b2208d89908c488037ab` |
| Backend | backend-La-Vilet | `6482ccf58a5a8854fd8e08ed888065754f52952f` |

Flags WA: **OFF** en FE `.env.local` y Nest `.env`.

---

## Commits locales guardados en `main` (antes de inventariar)

### Frontend (`c126f7d` luego merge `7b2ec1d`)
- Scope tenant en `listMetaCapiConversionLog`
- Docs activación + local-only demo SQL fuera de `migrations/`
- Labels / closeout review (sin patches ni `.env`)

### Backend (`6482ccf`)
- Lane `META_WA_CAPI_ACCESS_TOKEN`
- Specs flujo Nest + Graph simulado
- Scripts sonda/inspect (leen env; sin secretos en repo)
- `.env.example` documenta token WA vacío

**Excluido a propósito:** `.env*`, `.env.local-admin.local`, `supabase/.temp/**`, backups `*.bak` con keys, patches efímeros `review-local/*.patch`, resultados de sonda `LAST_RESULT` / HTML preview.

---

## Qué quedó unificado en `main`

### Frontend
- `origin/main` (34 commits: UI, agenda, financiamiento, bitácora outbox MetaCapiBitacoraView, etc.) **integrado** vía merge.
- Trabajo WA LeadSubmitted local (5 commits previos + prep) conservado.
- Conflictos resueltos:
  - Página CAPI → UI outbox de origin (`MetaCapiBitacoraView`)
  - Actions → **ambas**: `fetchMetaCapiBitacora` + `listMetaCapiConversionLog` (tenant-scoped)
  - Nav → un solo módulo Marketing / CAPI Meta
  - `roleAccess` → origin + `!ventas` en `marketingOnly`
- Backup `env.local.before-restore-*.bak` **eliminado del árbol** (contenía service_role / OIDC)

### Backend
- 3 commits WA previos + commit de credential lane/tests
- Ramas laterales ya estaban contenidas en `main` (incl. merge PR #2)

---

## Ramas locales eliminadas (contenido ya en `main`)

Recuperables con `git checkout -b <name> <sha>` o `git branch <name> <sha>`.

### Frontend
| Rama | SHA original |
| --- | --- |
| feat/kommo-ctwa-clid-preserve | `ef4e9e3fa941285ab6c8a3ec3c3f7f85b9708a77` |
| feat/meta-schedule-aceptar-cita | `5a23f0a4a22beb94c319374394d2c696c011d933` |
| fix/meta-emq-matching | `180c1788ea6f8465cbb2109134a75ed1db3e3260` |
| fix/meta-pixel-consent-autoconfig | `105379800af2cdd451026f4b7176f6f21f3fab16` |
| review/meta-capi | `5934b7d53f2784c58dfecf60c517b47befbf816c` |

Local restante: **solo `main`**.

### Backend
| Rama | SHA original |
| --- | --- |
| fix/meta-emq-name-split | `c3d1f4cbcd553fa1a2bc1360727de2783bbd1b9f` |
| fix/supabase-drain-exclude-review-hold | `ce707c75c032eaf10cbde4e47859b6d122389f69` |

Local restante: **solo `main`**.

---

## Inventario remoto (aún existe; borrado **pendiente de tu OK + push**)

### Frontend `origin`
| Rama | Tip | vs main local |
| --- | --- | --- |
| origin/main | `4958d4e…` | ancestro; local ahead **6** |
| origin/review/meta-capi | `be7932a645a8ff0ed39fbd0f1549bcc5ada91b5a` | **contenida** en main local |

### Backend `origin`
| Rama | Tip | vs main local |
| --- | --- | --- |
| origin/main | `e65ac41…` | ancestro; local ahead **4** |
| origin/fix/meta-emq-name-split | `c3d1f4c…` | contenida |
| origin/fix/supabase-drain-exclude-review-hold | `ce707c7…` | contenida |

**Casos divergentes / inciertos:** ninguno detectado. Todas las laterales estaban fully contained; no hubo trabajo exclusivo no mergeable.

---

## Plan de consolidación remota (NO ejecutado)

Cuando autorices publicación:

1. **Push main** (fast-forward / merge remoto):
   - FE: `git push origin main` (6 commits; **dispara Vercel** proyecto `lavilet` / `prj_XSCIgblTcJorVqsexjC9wAAZheI3`)
   - Nest: `git push origin main` (4 commits; **rebuild DigitalOcean** vía Dockerfile / App Platform según `docs/DEPLOY_DIGITALOCEAN.md`)
2. Confirmar `main` como default en ambos repos GitHub (ya `origin/HEAD -> origin/main`).
3. Borrar ramas remotas ya integradas:
   - FE: `origin/review/meta-capi`
   - Nest: `origin/fix/meta-emq-name-split`, `origin/fix/supabase-drain-exclude-review-hold`
4. **No** force-push.

### Impacto de push (por qué revisar antes)
- El código WA LeadSubmitted + migración `20260918120000` **aún no están “activados”** (flags OFF), pero **sí se desplegaría el código** en Vercel/DO al pushear main.
- Vercel historial reciente ya usa commits “trigger vercel rebuild” en origin/main.
- Nest en DO recibiría lane WA + tests en imagen; delivery sigue OFF si env prod no cambia.

---

## Validaciones hechas
- `git fetch --all --prune` ambos repos
- Secret scan antes de commit/merge; bak de env removido
- `merge-base --is-ancestor` = true en todas las laterales borradas
- Flags WA false locales
- Nest specs LeadSubmitted flow (re-ejecutados tras commits)

## Qué falta ejecutar en GitHub (tú / cuando autorices)
1. Push `main` FE + Nest  
2. Delete remote branches listadas  
3. Verificar deploy Vercel `lavilet` + Nest DO  
4. **No** encender flags WA ni aplicar migración LS remota en este paso de consolidación
