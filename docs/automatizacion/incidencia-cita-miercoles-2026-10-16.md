# Coordinación del miércoles a las 15:00 y redacción de citas

> Este documento conserva el diagnóstico y la primera iteración de la corrección. La solución vigente y sus comprobaciones están en [Interpretación por IA y continuidad](correccion-interpretacion-y-continuidad-2026-10-16.md). Se sustituyeron los analizadores de texto por el contrato `visit-preference-v2`; las cifras de esta primera iteración no acreditan la validación actual.

## Qué ocurrió en el caso real

Se consultaron únicamente registros existentes por GET, dentro del proyecto. La conversación de referencia es Kommo 4454162; el evento de las 15:19 de Ecuador es `aa932d11-0a9c-4492-bb84-8ac0a6e6826a`.

La IA sí entendió los mensajes. Su salida estructurada incluía:

| Turno | Datos extraídos por IA | Qué ocurrió después |
| --- | --- | --- |
| «O sea… Quisiera una para el miércoles». | Día: miércoles; confianza alta. | El normalizador interpretaba la palabra «o» de la muletilla como una alternativa y descartaba la preferencia. |
| «El miércoles a las 3, miércoles a las 3 de la tarde». | Día: miércoles de la próxima semana; hora: «a las 3 de la tarde»; intención de aportar una preferencia. | La combinación `request_visit/preference` estaba autorizada en el prompt, pero no en su normalizador. El formato de hora tampoco se admitía. El parser SQL, al recibir el audio repetitivo sin esa interpretación, devolvía ambigüedad. |
| «Sí, sí, justamente para esa fecha» y «ya». | «Miércoles 21 de octubre», «a las 3 de la tarde». | Los formatos de día con fecha y hora expresada con período se volvían a rechazar. |

El resultado operativo seguía en `collecting`, con `requested_date=null`, `start_time=null`, `has_time=false` y sin identificador de solicitud. La consulta a `appointment_reschedule_requests` para este lead devolvió cero filas. El texto del redactor sí mencionaba miércoles y 15:00 porque disponía del historial, pero eso no creó el registro correspondiente.

Este fallo no consistió en leer o vetar el mensaje final del redactor. Se rechazaron los **datos estructurados del extractor** antes de ejecutar el registro. La corrección conserva la separación: la IA interpreta el lenguaje; los datos canónicos y los permisos permiten ejecutar una operación; el redactor escribe el mensaje completo.

## Cambios locales

- Se admite la combinación de intención y propósito que el prompt ya autorizaba.
- La muletilla «o sea» deja de tratarse como una elección entre horarios; las alternativas reales y negativas conservan su protección.
- Los metadatos «a las 3 de la tarde» se normalizan al formato horario admitido.
- «Miércoles 21 de octubre» conserva el día semanal declarado, y SQL comprueba que coincide con la fecha.
- SQL acepta confianza alta o media conforme al contrato común, manteniendo la evidencia literal y la validación del horario.
- Al recibir la primera fecha se conserva una hora previamente declarada; cambiar una fecha ya elegida mantiene su comprobación independiente.
- Una respuesta actual fundamentada a `visit_date_time` puede continuar el borrador vigente aunque falte la etiqueta paralela de intención. Una respuesta a otra pregunta no debe incorporarse por encontrar palabras de fecha.
- Se refuerza la separación de permisos: pedir asesor o aceptar otra gestión no inicia una cita; elegir entidad financiera no crea otro consentimiento ni borra el ya guardado.
- El plan del redactor se deriva del resultado operativo: con datos pendientes exige la pregunta correspondiente; con solicitud verificada comunica el registro y la revisión del equipo. Repetir la preferencia no sustituye avanzar la coordinación.
- Se retiran bases e instrucciones que empujaban a coletillas como «esto no confirma», «no son cupos confirmados» o «debe revisarse antes de confirmar». Se pide una respuesta cercana, con avance y siguiente acción en positivo, sin imponer otra frase fija.

No se añade una llamada extra a IA ni una reescritura del mensaje final por código.

## Cuándo termina el agendamiento

El procedimiento vigente tiene estas decisiones:

1. **El cliente indica lugar, fecha y hora:** se registra la solicitud y se coordina la revisión del asesor. Se conserva el horario propuesto.
2. **El asesor revisa la agenda y acepta o propone un horario:** se comunica la propuesta correspondiente.
3. **Constan las aceptaciones requeridas y se guarda la cita:** se informa la cita confirmada con fecha, hora y lugar.

El arreglo permite superar la recopilación que se había quedado atascada. No cambia el procedimiento por una reserva automática de agenda sin comprobar disponibilidad.

Ejemplos orientativos, sin incorporarlos como plantillas obligatorias:

- Solicitud efectivamente registrada: «Será un gusto recibirle. Registré su solicitud para el miércoles 21 a las 3:00 p. m.; el equipo revisará ese horario y le responderá por aquí».
- Cita efectivamente confirmada: «Le esperamos el miércoles 21 de octubre a las 3:00 p. m. en nuestra oficina. Le comparto la ubicación: [enlace verificado]».

El primer ejemplo requiere un recibo real de solicitud. El segundo requiere la cita confirmada. El redactor puede formular ambos objetivos de otras maneras.

## Migración y puesta en marcha

El borrador `20261016233000_visit_intake_semantic_recovery.sql` de esta primera iteración se retiró de la entrega local. La migración vigente es [20261017000000_typed_visit_preferences.sql](../../supabase/migrations/20261017000000_typed_visit_preferences.sql), que no requiere aplicar aquel borrador.

Cambia las funciones de admisión de metadatos y acumulación de fecha/hora. Comprueba las definiciones esperadas y permite volver a ejecutarla sin crear solicitudes. No procesa borradores históricos, modifica citas de leads ni envía mensajes al aplicarse.

En esta intervención **no se aplicó en producción ni se desplegó el código**. Corresponde aplicar esta migración sobre las funciones anteriores del proyecto, desplegar los cambios y comprobar la coordinación con contactos autorizados. La cita mostrada en la captura no se presenta como reparada o agendada retrospectivamente.

## Validación local

Se reprodujo la secuencia con la interpretación real del extractor y una base SQL aislada. La corrección termina en una sola solicitud para miércoles a las 15:00, en `awaiting_advisor`. También se comprobaron alternativas reales, negativas, evidencia inexistente, conflicto entre día semanal y fecha, hora antes de fecha y confianza media.

Las pruebas de composición conservan literalmente varias formulaciones distintas del redactor y verifican el estado que recibe. Las respuestas y proveedores están simulados: esta validación no certifica naturalidad con un modelo real ni entrega en WhatsApp.

La primera iteración registró **620 de 620 comprobaciones en 15 archivos**, junto con TypeScript y ESLint. Esa cifra corresponde a un corte anterior y no debe presentarse como validación del contrato tipificado actual. El informe vigente registra las comprobaciones y limitaciones de la revisión posterior.

Una exploración adicional de límites de extracción detectó fallos que también se reprodujeron con `HEAD cb37290`. Se corrigieron los nueve relacionados con permisos cruzados y selección de entidad. En una ampliación distinta de recuperación semántica siguen tres diferencias preexistentes: contrato de recuperación de cantidades, una consulta informativa de entidad y aceptación breve de una invitación sin recibo. No se presenta toda la batería del repositorio como aprobada ni se intervienen esos tres escenarios ajenos al agendamiento de esta captura.
