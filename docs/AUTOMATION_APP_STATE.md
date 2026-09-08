# Estado de Automatización (2026-09-05)

Punto de restauración para cuando algo no cuadre. No es un commit de git.

## Qué hay en el CRM hoy

| Superficie | Ruta | Quién | Qué hace |
|---|---|---|---|
| Menú Ventas | `/inmobiliaria/automatizacion` | asesor y admin | Entra a Monitoreo |
| Monitoreo | igual | asesor y admin | KPIs + tabla + drawer. Lee `vw_lead_automation_dashboard` |
| Reglas | `/inmobiliaria/automatizacion/reglas` | solo admin | Horario, equipo, puntaje, nutrición |
| Guion | `/inmobiliaria/automatizacion/guion` | solo admin | Preguntas y respuestas del bot |

Financiamiento sigue en Contabilidad. Nutrición (4 semanas Meta) no es el chat en vivo.

## Cómo habla el bot (n8n)

n8n no lee un textarea del CRM. Llama `get_active_prompt(tenant, project, name, channel)` sobre `agent_prompts`.

Hay dos capas:

1. Agentes grandes (`load_when = always`, no se editan en Guion): `resumen_conversacion`, `clasificador_intenciones`, `extractor_eventos`, `respuesta_comercial`.
2. Temas cortos (`precio`, `bienvenida`, `ubicacion`, …): sí se editan en Guion. Si `is_active = false`, `get_active_prompt` no los devuelve.

Las preguntas de captura viven en `agent_script_questions`. Al guardar, el CRM escribe un bloque `# GUION CRM START` … `# GUION CRM END` dentro de `respuesta_comercial` del proyecto (si existe) y un prompt `guion_preguntas` por si n8n lo pide después.

## Tablas que toca cada pestaña

- Monitoreo: vista + RPC KPIs; detalle lee conversaciones, score, nutrición del lead, escalaciones.
- Reglas: `project_automation_config`, `project_salespeople`, `lead_scoring_rules`, `nutrition_steps`.
- Guion: `agent_script_questions`, `agent_prompts` (temas + sync del bloque).

## Fallos ya vistos

- Tras `stash pop`, Automatización desapareció del menú: faltaba el item en `inmobiliariaNav.ts` y el path en `roleAccess.ts`.
- Reglas mostraba `{message, hint}`: `getCrmDataClient()` usaba `SUPABASE_SERVICE_ROLE_KEY` inválida. Las acciones de admin usan la sesión. Policies `is_admin()` cubren escritura.

## Cómo revertir solo Guion

Frontend: borrar `src/app/inmobiliaria/automatizacion/guion/`, `AutomationGuionView.tsx`, `automationGuion.service.ts`, `src/lib/inmobiliaria/automationGuion.ts` (+ test), `src/types/automationGuion.ts`. En tabs, quitar `guion`. SQL: `supabase/migrations/20260905163000_automation_guion_down.sql`.

Monitoreo y Reglas no dependen de Guion.
