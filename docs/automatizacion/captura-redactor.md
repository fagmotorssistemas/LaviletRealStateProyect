# Entrada del redactor en la bitácora

## Ampliación: distinguir llamadas de IA

Las llamadas estructuradas de `aiJson` ahora guardan entrada y salida protegidas, no solo las de redacción. Los nodos se distinguen con prefijo IA y borde violeta. La función se registra según el contrato de salida: clasificador de alcance, extractor, redactor, revisor, generador de borrador, interpretación de datos o lectura de imagen/archivo. El tipo de tono `writing` ya no se interpreta como prueba de que se ejecutó el redactor final.

Al abrir el nodo aparecen tres secciones: entrada (instrucciones, datos y esquema), salida JSON recibida y enlace al paso causante que usa el resultado. Ese enlace permite consultar la decisión registrada: no se deduce aceptación a partir del éxito técnico de la llamada. Cada reintento conserva su propia llamada. La salida es el JSON parseado, no el cuerpo HTTP del proveedor ni razonamiento interno. Las llamadas fallidas sin JSON válido muestran ausencia de salida. Los adjuntos binarios no se guardan.

Los registros antiguos sin función explícita se identifican como llamadas históricas; no se les atribuye un rol por su nombre ambiguo. Esta ampliación no cambia las instrucciones comerciales ni añade llamadas a IA. Los límites y permisos descritos abajo siguen vigentes.

Desde este cambio, las nuevas llamadas `writing` conservan una copia protegida de las instrucciones después de aplicar el estilo de conversación y las instrucciones JSON, los datos de entrada y el esquema de respuesta. La clasificación de alcance también usa este tipo de llamada: el paso causante permite distinguirla del redactor final.

En **Flujo visual → conversación → mensaje → Redacción con IA → Ver instrucciones y contexto enviados a la IA**:

- `instructions`: instrucciones compuestas enviadas al modelo.
- `user_prefix`: texto que precede a los datos serializados como JSON.
- `data`: mensaje, base, contexto y demás campos realmente entregados a esa llamada. En el redactor final, `historial_reciente` conserva hasta ocho mensajes, con un máximo de 1.800 caracteres por mensaje en la entrada original; otros campos pueden aportar contexto adicional.
- `response_schema`: formato interno exigido al modelo.
- `privacy_filtered`: se aplicaron protecciones de datos sensibles. No es una copia literal sin censura.
- `limited`: la captura excedió alguno de sus límites (120.000 caracteres de texto, profundidad 20 o 300 elementos por colección).

No se reconstruyen entradas de ejecuciones antiguas a partir de su hash. No se capturan adjuntos ni respuestas completas del proveedor. Se mantienen los permisos administrativos y el aislamiento por organización/proyecto de la bitácora. No añade llamadas a IA; aumenta el almacenamiento de trazas.

## Diagnóstico de Carlos, 23 de septiembre, 15:19

La ejecución declaró código `37536acc5a43a5cfbf01f3b98d489c76ed07469a`, anterior a `e7f9be8`. Entró en búsqueda de catálogo: su base no tenía apertura amable. El redactor añadió «En Edificio La Vilet» y «exclusivamente de opciones inmobiliarias» y su respuesta fue conservada. Antes, a las 15:17, Carlos había pedido información de autos. Ese antecedente es consistente con la aclaración, pero la captura antigua no permite reconstruir la entrada exacta ni atribuir el texto a una instrucción concreta. La mejora de aperturas conserva una apertura decidida; no la introduce si la base no la tiene.
