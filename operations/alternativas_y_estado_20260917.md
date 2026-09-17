# Alternativas de inmuebles y guardado del proyecto

La regla compartida `UNIT_ALTERNATIVE_RULES` se aplica a redacción y revisión en todos los tonos. Cuando no existe una coincidencia, recomienda una alternativa del catálogo con una explicación verificable; respeta precios autorizados, presupuesto, requisitos indispensables, rechazos anteriores y procesos activos. No actualiza la preferencia del cliente por ofrecerle otra opción.

`unit-alternatives.ts` selecciona una alternativa para requisitos numéricos de dormitorios, piso y superficie interior. No fija el 602. Las restricciones adicionales, ambigüedades, preferencias previas y consultas combinadas quedan a la redacción contextual con la misma regla. No infiere que un atributo no documentado no exista. `sdr.ts` y `price-reply.ts` comparten esta selección; la revisión general recibe la regla independientemente del tono o flujo.

El guardado en `automatizacion/proyecto/actions.ts` devuelve `projects.updated_at` tal como queda en la base, en lugar de una fecha calculada antes del UPDATE. Mantiene el control de concurrencia y los demás campos de políticas. Los errores esperados se devuelven como datos para que el formulario muestre el motivo en español y conserve lo editado.

Pruebas: `unit-alternatives.test.cjs`, `project-readiness.test.cjs`, integraciones y controles de tono. Cubren selección cambiante, presupuesto, disponibilidad, requisitos firmes, rutas comercial/precio, dos guardados sucesivos, conflicto real de concurrencia y preservación de políticas.

No requiere SQL ni cambia el estado real de la obra, los lugares habilitados o los permisos de precios.
