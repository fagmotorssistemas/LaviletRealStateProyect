# Conversación directa en todos los modos

Por solicitud expresa, la regla se aplica también a Original. Se conservan las demás instrucciones del perfil.

`direct-conversation-rule.ts` define la regla única: hablar directamente con el cliente, sin narrar sus acciones como un informe. Permite reconocer necesidades pertinentes y confirmar datos necesarios. La revisión debe corregir el estilo sin omitir información ni derivar a un asesor por ese motivo.

`tone-settings.ts` incorpora la regla a todas las tareas de redacción y revisión, incluso cuando falla la lectura de la configuración y se utiliza Original. No se incorpora a tareas de extracción/resumen ni modifica plantillas fijas.

Pruebas: las 36 combinaciones de estilo/calidez/detalle reciben la regla en redacción y revisión. Se verifica que las instrucciones anteriores del modo Original permanecen iguales al retirar únicamente esta adición autorizada. Suite de 222 pruebas aprobada. No requiere SQL ni cambiar la selección guardada.
