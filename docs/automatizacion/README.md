# Automatización de La Vilet: referencia canónica

**Actualización del 26/09/2026:** [Validación con evidencia compartida](validacion-evidencia-compartida-20260925.md), incorporada en `22ad84f`, y [auditoría de casos pendientes, visibilidad de mensajes y caché](auditoria-visibilidad-cache-20260926.md).

**Revisión:** 22 de septiembre de 2026. El motor conversacional v2 y el Workflow base están versionados en `c1149bb`. La vista **Por mensaje**, su nueva instrumentación y las correcciones de continuidad descritas en el documento 11 son cambios locales pendientes de despliegue; no se ha verificado su funcionamiento en producción.
**Alcance:** mensajes de WhatsApp recibidos mediante Kommo, respuestas del bot, citas, financiamiento, nutrición y traspasos a asesores.
**Propósito:** explicar el comportamiento real sin mezclar reglas activas, cambios locales y propuestas futuras.

## Cómo leer el estado de una regla

| Estado | Significado |
| --- | --- |
| **Versionada** | Está en el `HEAD` de `main`. Aun así, su funcionamiento en producción depende de que el despliegue y las migraciones correspondientes hayan terminado correctamente. |
| **Configurada** | Depende de datos de Supabase, Kommo o variables del entorno. El código existe, pero puede estar apagada o limitada por configuración. |
| **Local pendiente** | Existe en este espacio de trabajo, pero todavía no se ha confirmado ni subido al repositorio. No se debe asumir que funciona en Vercel. |
| **Planificada** | Es una regla acordada o documentada que aún no está implementada por completo. |

La fuente de verdad se consulta en este orden:

1. Estado operativo en Kommo, Supabase y variables de Vercel.
2. Código y migraciones realmente desplegados.
3. Esta documentación, que explica esos componentes.
4. Los documentos antiguos de `docs/`, que quedan como historial y pueden describir estados anteriores.

## Por qué `/cuenca-azuay` devuelve 404

`/cuenca-azuay` no tiene un archivo `page.tsx` en el App Router, por lo que Next.js responde correctamente con **404**. La vista del flujo está en:

```text
http://localhost:3000/inmobiliaria/automatizacion/workflow
```

Esa ruta es privada. Se necesita una sesión válida y permiso para `/inmobiliaria/automatizacion`. La API de ejecuciones reales exige además rol `admin` y acceso a la organización correspondiente. La página Workflow y sus mapas ya están versionados. La nueva vista **Por mensaje** permanece en estado **local pendiente**; su presencia en este espacio de trabajo no demuestra que esté disponible en un despliegue remoto.

## El modelo mental correcto

La automatización no es una sola función. Es una cadena coordinada:

```mermaid
flowchart LR
    W[WhatsApp] --> K[Kommo]
    K --> H[Webhook]
    H --> Q[Cola en Supabase]
    Q --> E[Ejecutor]
    E --> P{Permisos}
    P -->|detenido| X[Registrar sin responder]
    P -->|permitido| C[Contexto]
    C --> I[Interpretación]
    I --> R{Enrutador}
    R --> V[Citas]
    R --> F[Financiamiento]
    R --> S[Respuesta comercial]
    R --> A[Asesor]
    V --> QL[Control de calidad]
    F --> QL
    S --> QL
    A --> QL
    QL --> D[Kommo + Salesbot]
    D --> M[Memoria y seguimientos]
```

## Cinco estados que nunca deben confundirse

| Eje | Pertenece a | Ejemplos | Qué controla |
| --- | --- | --- | --- |
| Etapa comercial del proyecto | Proyecto | Lanzamiento, Preventa | Cómo se presenta y comercializa el proyecto. |
| Estado físico de la obra | Proyecto | Sin iniciar, En construcción, Terminado | Qué se puede afirmar y qué lugares se pueden visitar. |
| Etapa comercial del lead | Lead | Contacto inicial, Calificado, Oportunidad, Reserva/cierre | Avance del proceso comercial. |
| Temperatura | Lead | Frío, Tibio, Caliente | Prioridad calculada con puntos. |
| Estado de seguimiento | Lead/conversación | Activo, nutrición, pausado, recuperación, finalizado | Qué contacto automático debe ocurrir después. |

Un lead puede estar al mismo tiempo en **Oportunidad**, **Tibio** y con **nutrición programada**. “Lanzamiento” no describe al lead y “Nutrición” no debería utilizarse como etapa comercial.

## Documentos de esta referencia

1. [Flujo completo](./01-flujo-completo.md): recorrido técnico y operativo de cada mensaje.
2. [Reglas de decisión y respuesta](./02-reglas-de-decision.md): prioridades, clasificador, extractor, pausas y validadores.
3. [Reglas comerciales](./03-reglas-comerciales.md): catálogo, precios, alternativas, ubicación, materiales y tours.
4. [Citas y financiamiento](./04-citas-y-financiamiento.md): estados, notificaciones, recordatorios y precalificación.
5. [Leads, temperatura y seguimiento](./05-leads-y-seguimiento.md): etapas, puntos, nutrición y recuperación.
6. [Configuración y mapa del código](./06-configuracion-y-codigo.md): pantallas, tablas, Salesbots, campos y módulos responsables.
7. [Motor conversacional y diagnóstico por turno](./07-motor-conversacional.md): contrato común, catálogo, memoria, trazas y pruebas.
8. [Caso de continuidad del 22 de septiembre](./08-regresion-conversacional-2026-09-22.md): fallos observados, correcciones y límites de la validación local.
9. [Propuesta de bitácora comprensible](./09-propuesta-bitacora-explicable.md): historial de la propuesta previa a su implementación; conserva el estado y los límites de aquella revisión.
10. [Diagnóstico del chat de las 10:58–11:24](./10-diagnostico-conversacion-1058-1124.md): historial del análisis sobre pérdida de filtros, aceptación de alternativas, plantillas y posibles derivaciones innecesarias.
11. [Cambios de trazabilidad y continuidad](./11-cambios-trazabilidad-y-continuidad.md): guía de la nueva vista **Por mensaje**, correcciones implementadas localmente, límites de la evidencia y comandos de validación.

## Qué permite ver el flujo visual

La revisión de selección explícita, enlaces 360 y validación numérica está documentada en [Selección y validación unificada — 26 de septiembre](./seleccion-validacion-unificada-20260926.md), con archivos, líneas y pruebas.

La pantalla de Workflow es de solo lectura. Contiene mapas para:

- recorrido principal;
- pausas de la IA;
- citas y visitas;
- financiamiento;
- nutrición.

La instrumentación base permite registrar pasos, duración, resultado y módulo responsable. Su disponibilidad en una ejecución depende de la versión que la procesó y de que sus registros se hayan guardado correctamente.

La ampliación local añade **Por mensaje**: conversaciones y lotes identificados, datos consultados, unidades con sus números, decisiones con su causa registrada, cambios de filtros y vistas previas de la respuesta base, propuesta y conservada. Los ajustes editables se enlazan cuando están identificados; las reglas de código se distinguen de esos ajustes. La pantalla no modifica ejecuciones pasadas.

Los mapas explican la estructura general. La vista por mensaje muestra únicamente pasos registrados: no reconstruye retrospectivamente intenciones, datos ni causas ausentes. Consulte el [documento 11](./11-cambios-trazabilidad-y-continuidad.md) para saber qué puede comprobar y qué sigue pendiente de despliegue y verificación.
