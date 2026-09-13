# Controles de automatización

Reglas y SLA, Guion del bot y Ubicación comparten la presentación de Monitoreo: resumen de datos actuales, selector de proyecto y acceso a la bandeja de citas pendientes. El acceso utiliza el mismo proveedor de solicitudes y conserva sus permisos y notificaciones.

## Reglas y SLA

La navegación separa horario, equipo, calificación y seguimiento. Cambiar de sección conserva los campos que se están editando; cada sección mantiene su acción de guardar. La sección seleccionada se conserva al recargar los datos después de guardar.

SLA significa acuerdo de nivel de servicio. `sla_response_minutes` mide el plazo de respuesta del asesor tras el traspaso; `review_sla_minutes` mide el plazo para revisar una solicitud de cita. Ninguno programa una espera antes de responder con IA. La pantalla lee estos valores del proyecto. Los puntos por evento siguen siendo reglas compartidas de la plataforma.

La secuencia de cuatro semanas se prepara con todos sus pasos desactivados y sin aprobación de Meta. **Desactivar toda la secuencia** actualiza solamente `active = false` de `nutrition_steps` del proyecto seleccionado, mediante una acción que exige administrador y acceso al proyecto. No borra temas ni cambia aprobaciones. El seguimiento aún no tiene conectado un ejecutor de envíos automáticos; la pantalla lo indica.

## Guion del bot

Las instrucciones comerciales y preguntas orientativas conservan sus editores. La sección informativa **Citas y financiamiento** explica que estos procesos utilizan textos predefinidos según el estado y completan los datos reales. No presenta un editor ficticio: cambiar una instrucción comercial no modifica esos textos operativos.

## Ubicación

El mapa conserva la selección de punto y el guardado explícito. La pantalla distingue el enlace guardado de la vista previa y muestra si hay cambios pendientes. Mover el marcador no altera la ubicación compartida hasta guardar.

## Validación

`npm run test:automation` incluye pruebas de la preparación desactivada, alcance por proyecto, rechazo sin proyecto y propagación de errores de permisos. `npm run build` comprueba los componentes y las rutas. La revisión visual requiere un navegador conectado y una sesión de administrador.

## Precios

Automatización → Precios permite al administrador editar el precio comercial en USD de departamentos y suites, o consultar todas las categorías del proyecto. Guarda `units.published_commercial_price`, el mismo valor del inventario; no crea otro catálogo de precios ni modifica costos o publicación de unidades. Un valor vacío retira el precio (null, no cero). La edición comprueba proyecto, tenant y versión de la unidad para no sobrescribir un cambio concurrente.

Guardar un precio no cambia el modo comercial. En lanzamiento sigue oculto al bot; en preventa puede utilizarse cuando la unidad está publicada y disponible. El formulario muestra esa condición y enlaza a Reglas y SLA. Las pruebas de precios están incluidas en `npm run test:automation`.
