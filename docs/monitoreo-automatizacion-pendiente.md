# Monitoreo de calidad — propuesta pendiente

El usuario decidió posponer su implementación el 22/09/2026. No se ha activado ningún monitoreo continuo ni contratado servicios.

Objetivo: detectar problemas sin que el usuario tenga que copiar mensajes o revisar cada ejecución. Aprovechar la infraestructura actual de Vercel/Supabase antes de considerar un VPS.

Propuesta:

1. Registrar mensaje, versión de reglas, interpretación normalizada, consulta, respuesta base, propuesta del redactor, validaciones y respuesta enviada.
2. Procesar ejecuciones nuevas con una tarea programada y un cursor persistente, evitando revisiones duplicadas.
3. Ejecutar controles de código sobre enlaces obligatorios, solicitudes omitidas, preguntas repetidas, cambios de alcance y restricciones sin evidencia.
4. Reservar revisión con IA para casos sospechosos o una muestra configurable, con límite de consumo.
5. Guardar incidentes con evidencia, módulo responsable, severidad y propuesta. Presentarlos en el panel. Definir canal de notificación antes de enviar avisos externos.
6. No modificar prompts, código o reglas automáticamente: validar las propuestas con reproducciones y pruebas antes de desplegar.

Costos por definir: volumen de turnos, frecuencia, retención, planes actuales y modelo de auditoría. El cron consume recursos de funciones/base de datos y las revisiones con IA consumen tokens. No se necesita mantener Chrome abierto. No hay presupuesto contratado ni promesa de costo cero.

Casos iniciales de referencia: cinco dormitorios interpretados como indispensables sin evidencia; selección explícita del 502 tratada como búsqueda; aceptación de detalles confundida con brochure; pregunta doble sobre una unidad y máximo residencial.
