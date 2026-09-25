# Propuesta pendiente — 25 de septiembre de 2026

Estado: pendiente de decisión del usuario. No implementar estas mejoras durante la reparación de recepción Kommo.

## Prioridad inmediata

Restaurar recepción y respuesta del lead de prueba sin ampliar la automatización a otros leads. Confirmar logs del webhook en producción y compatibilidad del código con las funciones de Supabase antes de migrar o cambiar rutas.

Evidencia revisada: ae8ce39 (autor Git Pablo, 23/09) sustituyó lv_app_receive/lv_app_receive_advisor_outbound por lv_receive_kommo_observation. El documento de activación pendiente se incorporó en 2910779 (24/09). El despliegue f9878b5 está Ready/Production/Current según captura del usuario; ese commit no modifica el webhook. La inspección de lectura del 25/09 no encontró la nueva función ni kommo_message_evidence en la API del proyecto Supabase consultado. Falta confirmar en runtime el error de los mensajes de las 11:31 y 11:54.

## Mejoras para decidir después

1. Trazabilidad por identificador desde recepción hasta envío, con estados comprensibles y fallos explícitos. La ausencia de recepción exige contraste con Kommo, no inferencia a partir de la cola local.
2. Ficha comercial común visible en la interfaz: hechos y procedencia, preferencias, selección, objetivo, compromiso pendiente y siguiente paso.
3. Checklist flexible: pendiente, confirmado, aplazado y no aplica. No exigir presupuesto ni repetir preguntas contestadas.
4. Interpretar todas las solicitudes del turno y permitir ampliación explícita del alcance sin arrastrar filtros anteriores indebidamente.
5. Plan de respuesta con hechos verificados, obligaciones, acciones y pregunta pertinente; libertad de redacción sin exigir copiar cifras irrelevantes de una base.
6. Controles deterministas para datos/acciones y revisión semántica para significado/cobertura, sin asumir que la base siempre es correcta.
7. Un solo intento adicional de reparación cuando el defecto sea corregible; volver a validar, sin repetir acciones o envíos. Si falla, respaldo pertinente.
8. Pruebas de conversaciones completas basadas en casos reales y activación gradual para el lead de prueba, con versión de retorno.

Pospuestos: unificación de llamadas de IA y monitoreo externo permanente. No prometer cero fallos ni restaurar datos borrados como mecanismo de reversión.
