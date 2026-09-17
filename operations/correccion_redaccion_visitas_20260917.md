# Corrección de redacción de visitas

Problema observado: una preferencia de horario pendiente produjo un mensaje repetitivo con «4 p.» incompleto. La recuperación de cifras de `restoreProtectedBase` separaba las abreviaturas por puntos y podía concatenar la frase original con una reformulación parcial.

Cambios:
- `turn-completeness.ts`: protege las abreviaturas a. m./p. m. al separar frases. Si recuperar una cifra implica añadir una frase cuyos números ya están parcialmente en la propuesta, no concatena: la validación rechaza la propuesta incompleta y conserva la base verificada. Las adiciones independientes de datos siguen admitidas y se revisan semánticamente.
- `visit-copy.ts`: reglas compartidas de precisión de visitas y validaciones para distinguir preferencia de confirmación, conservar oficina como destino y rechazar horas truncadas.
- `operational-copy.ts` y `turn-completeness.ts`: aplican esas reglas al redactar y revisar visitas. Las reglas de precisión aplican a cualquier tono; no alteran el estado de la cita.
- `conversationTone.ts`: Elegante evita lenguaje de informe y formalidades vacías; Breve evita repetir preferencia, fecha y siguiente paso. El perfil original no recibe estas nuevas preferencias estilísticas.

Verificación: 221 pruebas aprobadas, incluidas regresiones de la fecha omitida, hora duplicada, abreviaturas, oficina, confirmaciones pendientes y confirmaciones reales. Los snapshots de instrucciones originales permanecen intactos. No se modifican configuraciones guardadas ni se envían mensajes reales.
