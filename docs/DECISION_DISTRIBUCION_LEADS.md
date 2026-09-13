# Distribución de leads: decisión para La Vilet

Revisión: 13 de septiembre de 2026. Esta es una recomendación de arquitectura; no activa una nueva distribución ni reasigna leads existentes.

## Recomendación

Para La Vilet recomiendo que la plataforma sea la autoridad que decide la asignación comercial, y que Kommo refleje ese responsable. Kommo sigue recibiendo los mensajes y manteniendo el historial del canal. Debe existir una sola autoridad para cambiar automáticamente al responsable; dos repartidores independientes pueden asignar el mismo lead a personas diferentes.

La razón específica es que la plataforma concentra la agenda, las solicitudes de visita, el equipo habilitado por proyecto y los plazos de revisión. Llevar la decisión a Kommo obligaría a sincronizar esos datos antes de decidir, o a mantener parte de las reglas en cada sistema. La recomendación no implica que una aplicación propia sea, por naturaleza, más fiable que un CRM comercial: exige mantener y comprobar la integración.

El código revisado ya asigna leads mediante funciones de base de datos como `handoff_lead`; el reparto de visitas también se resuelve en la plataforma. El cliente Kommo del ejecutor revisado actualiza campos y ejecuta Salesbots, pero no encontré allí una operación específica que sincronice `responsible_user_id`. Esto no descarta procesos externos o automatizaciones configuradas en Kommo: hace falta verificar esa sincronización antes de darla por completa.

## Ventajas y desventajas reales

| Alternativa | Ventajas | Desventajas o costos |
| --- | --- | --- |
| Kommo decide; la plataforma importa el responsable | Menor cantidad de lógica propia que mantener. Reglas operables desde el CRM. Para un reparto sencillo entre asesores, evita depender de la aplicación propia al asignar un lead que acaba de entrar por Kommo. | Para considerar agenda, carga o reglas que solo existen aquí, hay que suministrar esos datos e integrar los cambios. La plataforma necesita recibir la asignación antes de coordinar avisos y permisos. Cambios en ambos lados requieren una política de conflictos. |
| La plataforma decide; Kommo recibe el responsable | Un mismo lugar relaciona solicitudes, agenda, elegibilidad, seguimiento y reparto. Permite explicar por qué recibió un lead cada asesor y adaptar la regla al negocio. Facilita incorporar otros canales sin rehacer la distribución en cada CRM. | Hay que mantener el servicio, su disponibilidad, la cola de sincronización y las alertas. Una caída de nuestra plataforma afecta al reparto. Los cambios directos del responsable en Kommo deben conciliarse mediante una regla explícita. No evita los límites, fallos o demoras de la API de Kommo. |

Kommo sí tiene herramientas de automatización: Salesbot documenta el cambio de responsable y un bloque Round Robin para alternar acciones. No es correcto decir que Kommo no puede repartir leads; hay que evaluar si las reglas concretas de La Vilet pueden representarse y mantenerse allí. [Documentación de Salesbot](https://support.kommo.com/docs/salesbot-overview).

Si la operación se simplificara a recibir WhatsApp y repartir por turnos entre pocos asesores, escogería Kommo por el menor mantenimiento. Con la coordinación de visitas y las reglas que ya existen en La Vilet, el costo adicional de integrar una autoridad en la plataforma tiene una justificación funcional.

## Regla de reparto que propongo

1. Conservar al asesor comercial existente cuando el lead retoma una conversación. Un mensaje nuevo o una segunda cita no son, por sí solos, otra oportunidad que deba repartirse.
2. Para un lead nuevo que necesita atención humana, seleccionar asesores activos, habilitados para el proyecto y con capacidad de atender. Estar conectado a la web no debe ser la única prueba de disponibilidad.
3. Equilibrar la carga real y usar turnos para desempatar. Contar pendientes relevantes y su antigüedad; repartir diez leads a cada uno no garantiza una carga equivalente.
4. Si nadie puede atender, conservar la solicitud en la bandeja, mostrar el tiempo de espera y avisar a coordinación. No asignar ficticiamente ni perder el pendiente.
5. Registrar entrega al asesor, aceptación y primera respuesta como eventos distintos. Aplicar alertas y una reasignación controlada al vencer el plazo, con motivo e historial.
6. Distinguir responsable comercial del lead y responsable de una visita. Que otro asesor cubra una visita por disponibilidad no debe cambiar silenciosamente al dueño comercial de la relación.

El reparto por carga y por turno son estrategias distintas. Dynamics 365 documenta ambas, junto con criterios de capacidad y jornada. Esa distinción fundamenta la regla propuesta; no significa que todas esas capacidades ya estén implementadas en La Vilet. [Distribución en Dynamics 365](https://learn.microsoft.com/en-us/dynamics365/sales/understand-lead-distributions-assignment-rules).

## Condiciones para que la opción recomendada sea fiable

- Guardar la decisión y el pendiente de sincronización juntos; identificarlos para que un reintento no produzca otra asignación.
- Vincular cada asesor con el usuario correcto de Kommo, y verificar esa identidad antes de copiar el responsable.
- Reintentar fallos temporales de sincronización y mostrar los que no se resolvieron. No marcar «sincronizado» solo por haber enviado una petición.
- Revisar periódicamente discrepancias de responsable. Un webhook repetido o atrasado no debe deshacer una decisión más reciente.
- Canalizar las reasignaciones manuales por coordinación, con motivo y registro. Definir cómo se aceptan las que se hagan en Kommo.
- Mantener un procedimiento para atender leads si cae uno de los servicios. Kommo no debe ponerse a repartir automáticamente por su cuenta mientras la plataforma está recuperando operaciones pendientes.

Estas son condiciones del diseño recomendado, no una afirmación de que la integración actual ya las cumple. Sin mantenimiento y seguimiento de errores, la opción más sencilla con Kommo sería preferible.

## Qué muestran los casos empresariales

No hay una única opción usada por todas las empresas grandes, ni evidencia aquí para afirmar cuál tiene la mayoría del mercado. Hay CRMs con asignación incorporada, como Dynamics 365, y empresas que añaden un sistema especializado conectado a su CRM.

Un caso documentado es Snowflake: implementó LeanData para asociar leads a cuentas y dirigirlos al responsable correcto en su operación con Salesforce, incluyendo reglas de negocio y SLA. Es un caso publicado por el proveedor y no una auditoría independiente; demuestra que usar un motor especializado integrado al CRM es una arquitectura real, no que toda empresa necesite construir el suyo. [Caso Snowflake / LeanData](https://www.leandata.com/wp-content/uploads/2021/08/leandata-helped-snowflake-reduce-lost-leads-improve-response-times-and-increase-booked-meeting-rates.pdf).

La lección aplicable a La Vilet es elegir dónde reside la información necesaria para decidir, mantener una autoridad clara y medir si la asignación termina en atención efectiva. Copiar la marca de software de una empresa grande no sustituye esas condiciones.
