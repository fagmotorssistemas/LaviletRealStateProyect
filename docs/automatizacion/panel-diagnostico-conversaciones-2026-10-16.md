# Panel de diagnóstico de conversaciones

Implementación local del 16 de octubre de 2026 en `/inmobiliaria/analisis-conversaciones`.
El alcance es el contenido central de esta sección. La barra superior, el menú
izquierdo y el resto de las pantallas mantienen sus componentes existentes.

## Qué permite consultar

- Cohorte por fecha de alta del lead, con límites diarios de Ecuador. Filtros por
  nombre/ficha/asesor, proyecto, responsable, origen, etapa y versión observada.
- Total, señales para revisar, pendientes del equipo e interés comercial
  registrado. Interés incluye las etapas de interés, proceso de reserva y venta
  con evidencia disponible; su porcentaje describe la cohorte actual y no es
  una tasa de cierre ni una probabilidad de pérdida.
- Punto actual del recorrido, hitos comprobados y sus casos. Visita y
  financiamiento no son pasos obligatorios consecutivos. No se reconstruyen
  transiciones históricas inexistentes a partir de la etapa actual.
- Motivos del cliente y dificultades de conversación con citas verificadas.
  Se distinguen evidencia directa, hipótesis y factores atendidos. Varias causas
  pueden coexistir; los grupos cuentan leads distintos dentro de cada motivo.
- Origen, temperatura, inmueble, residencia declarada y evolución descriptiva
  por semana de alta. Las cohortes recientes tienen menos tiempo de maduración.
- Mediana de primera respuesta con evidencia de envío, separando al asesor.
  Se muestra cuántos leads tienen un intervalo medible. El tiempo transcurrido
  incluye horas fuera de oficina; las alertas de SLA usan el plazo configurado.
- Pérdidas y ventas registradas, interés futuro con acuerdo y contacto detenido
  conservan significados independientes. El motivo de cierre del equipo aparece
  identificado como registro comercial.
- Detalle con diagnóstico, fuentes incompletas, línea de tiempo, ficha existente,
  acceso a Kommo y registro de revisión por el responsable o un administrador.
- Exportación CSV de los casos filtrados, con período, fecha de consulta,
  versión, estado de evaluación y protección contra fórmulas en celdas.

## Señales operativas

Se calculan sin llamadas al modelo: derivación fuera del plazo configurado,
solicitud de reserva sin responsable, aviso de reserva pendiente/fallido,
coordinación de visita sin asesor, incidentes que requieren revisión y trabajos
de seguimiento cuya fecha pasó y necesitan comprobación.

Los eventos cancelados con `requires_review=true` también pueden representar
fallos. Se consultan tanto por `payload.kommoId` como por `contact_key`, siempre
dentro de tenant/proyecto y de los leads autorizados por la sesión. Una respuesta
posterior puede resolver un fallo previo al envío; una operación incierta conserva
su revisión pendiente. Kommo aceptado no acredita envío ni entrega de WhatsApp.

La ausencia de sincronización completa no prueba falta de atención. Una nota
manual de resolución no elimina un pendiente que sigue en su fuente. El retorno
del cliente después de una gestión se registra como secuencia observable, sin
atribuir causalidad ni una venta.

## Evaluación con IA, contrato v2

Se conserva el inicio (hasta 12 mensajes) y el intercambio reciente (hasta 60),
con deduplicación. Se declara el límite y se reducen documentos, teléfonos y
correos. El modelo recibe el contexto operativo disponible y sus limitaciones.
Cada factor contiene tipo, motivo, evidencia directa/hipótesis, estado
abierto/atendido, explicación, sugerencia interna y citas de mensajes reales.
Una declaración explícita anterior no se invalida por un agradecimiento posterior.
Una posición de rechazo analítica no cambia el cierre comercial del CRM.

La huella de reutilización incluye mensajes, versión del contrato/instrucciones,
contexto operativo y última observación del equipo. Un cambio operativo puede
invalidar la evaluación aunque no llegue otro mensaje. Las evaluaciones del
contrato anterior se conservan visibles como desactualizadas y se excluyen de
los agregados vigentes.

Abrir, filtrar, actualizar o exportar el panel no llama a IA. La evaluación manual
y el mantenimiento habilitado utilizan el proveedor configurado. No se hicieron
llamadas reales al modelo durante la implementación o las pruebas.

## Migraciones y activación

Aplicar en este orden antes de desplegar:

1. `20261016220000_conversation_analysis_reviews.sql`: observaciones privadas,
   con RLS de lectura y escritura, actor de sesión, alcance y restricción al
   responsable/administrador. No concede actualización o eliminación al cliente.
2. `20261016221000_conversation_analysis_v2_candidates.sql`: selección acotada
   de una conversación por pasada de mantenimiento; incluye situaciones urgentes
   antes de 24 horas y excluye contactos con entradas pendientes. Conserva el
   aislamiento de pruebas y evita reevaluar un estado v2 sin cambios.

Dependen de las migraciones existentes de perfiles comerciales, análisis y
reservas del 15–16 de octubre. La ausencia de una fuente o de la migración de
revisiones se muestra en el panel; no se disimula como un total de cero fiable.

En concreto, `20261015210000_lead_commercial_pipeline.sql` debe instalarse
antes de la primera: crea `lv_can_manage_lead_commercial_profile(uuid)`, que
aplican sus políticas de permisos. La primera migración comprueba esta dependencia
antes de crear objetos, se ejecuta en una transacción y permite repetirla sin
borrar observaciones. El error PostgreSQL `42883` de esa función indica que falta
esa dependencia o que su instalación anterior está incompleta; no se deben
retirar las políticas para eludirlo. Las otras bases del panel son
`20261016090000_reservation_assignment_and_alert.sql` y
`20261016100000_conversation_analysis.sql`.

La versión corregida de `20261015210000_lead_commercial_pipeline.sql` conserva
el tipo de retorno instalado de `set_lead_stage(uuid,text,text)`: una fila de
`public.leads` en el SQL original del embudo, o `void` en otras instalaciones.
También conserva sus nombres de argumentos y su OID, sin eliminar funciones
ni dependencias. Esto corrige el error `42P13` al aplicar la dependencia.
Se ejecuta completa dentro de una transacción y puede repetirse sin borrar
fichas, historiales u observaciones existentes. Un contrato de retorno distinto
se rechaza y revierte la instalación, en vez de cambiarlo silenciosamente.

`CONVERSATION_ANALYSIS_AUTOMATIC=false` conserva su función de desactivar el
análisis automático. El cron y la configuración del ejecutor existentes siguen
siendo necesarios. No se creó un servicio externo ni una tarea adicional.

Las migraciones productivas y el despliegue no se ejecutaron en esta entrega.

## Verificación local

```text
npm run test:conversation-analysis
npm run test:conversation-analysis-ui
node --test scripts/oct16-ui.test.cjs
node --require ./scripts/test-typescript.cjs --test scripts/showroom-analysis-schema.pglite.test.cjs scripts/transport-runtime.test.cjs
npx tsc --noEmit --incremental false
```

Las pruebas comprueban el diagnóstico, citas, estados independientes, límites de
fechas, tiempos medibles, versiones, CSV, autorización por tenant/proyecto/actor,
selección de candidatas, filtros, evaluación/revisión simuladas y escritorio/móvil.
El navegador usa la página y sus estilos reales con acciones y datos ficticios;
no demuestra acceso con una sesión productiva ni precisión del modelo real.

Capturas locales: `tmp/conversation-analysis-ui/desktop.png`, `mobile.png` y
`mobile-detail.png`. La compilación de producción terminó con código 0; el
proyecto conserva el diagnóstico previo `test_contacts_action_failed` al
prerenderizar la pantalla de contactos de prueba, fuera de este panel.

Antes de interpretar resultados comerciales en producción, revisar una muestra
de evaluaciones con personas del equipo y comprobar sincronización, cobertura y
retención. El panel no introduce un predictor estadístico de abandono; presenta
señales explicables y evidencia para intervenir.
