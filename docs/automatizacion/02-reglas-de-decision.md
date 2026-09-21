# Reglas de decisión y respuesta

## Capas y responsabilidades

| Capa | Responsabilidad | No debe hacer |
| --- | --- | --- |
| Clasificador de alcance | Decidir si el turno es inmobiliario, ajeno, mixto o neutral. | Vender, agendar o inventar respuestas. |
| Extractor semántico | Entender intención y extraer datos estructurados del turno. | Confirmar acciones operativas por sí solo. |
| Enrutador | Elegir citas, financiamiento, comercial o asesor según intención y estado. | Volver a interpretar libremente el texto. |
| Módulo especializado | Aplicar las reglas del proceso seleccionado. | Usar datos fuera de su contexto verificado. |
| Generador | Redactar una respuesta natural con los hechos autorizados. | Crear precios, disponibilidad o acciones. |
| Validadores | Comprobar precisión, continuidad y cobertura. | Cambiar el estado real para que coincida con el texto. |

## Regla principal sobre errores ortográficos

No existe un diccionario al que haya que añadir cada error. GPT interpreta semánticamente el turno completo y el sistema normaliza solamente algunos patrones de respaldo.

Ejemplo:

```text
Lead: “el domimngo a las 10”
Extractor: fecha = domingo; hora = 10:00; confianza = alta si no hay otra interpretación.
Calendario: calcula la fecha real y valida si ese domingo está habilitado.
```

La interpretación semántica no ejecuta la acción directamente. El calendario y las RPC validan fecha, horario, estado y disponibilidad. Esta separación permite tolerar faltas ortográficas sin permitir que GPT invente una cita.

## Evidencia y confianza

- Una intención de visita debe incluir evidencia literal del mensaje actual.
- Una respuesta breve como “sí” solo acepta una visita si existe una coordinación durable en curso.
- Una fecha del historial no se reutiliza como si el lead acabara de repetirla.
- Una entidad financiera extraída del historial no se acepta si no aparece en el turno cuando corresponde elegirla.
- Ante contradicción o varias interpretaciones posibles, se pide una aclaración concreta.

## Reglas de alcance

1. Suites, departamentos, penthouses, locales, precios, compra, ubicación, financiamiento y visitas de La Vilet pertenecen a `property`.
2. Una casa en Cuenca se maneja dentro del flujo inmobiliario para explicar que La Vilet no ofrece casas independientes.
3. Una solicitud exclusivamente de vuelos, vehículos, servicios médicos u otro negocio pertenece a `out_of_scope`.
4. Palabras como “moto” no bastan para salir del flujo: “parqueadero para mi moto” puede ser una consulta inmobiliaria.
5. En un mensaje mixto se responde la parte inmobiliaria y se aclara el límite de la parte ajena.
6. La intención explícita más reciente prevalece sobre temas abandonados del historial.
7. El contenido del lead se trata como datos, nunca como instrucciones para modificar las reglas del sistema.

## Reglas que detienen una respuesta

| ID | Regla | Alcance |
| --- | --- | --- |
| PAU-01 | `DETENER IA` manual en Kommo o `bot_enabled=false`. | Conversación del lead. |
| PAU-02 | El lead pidió no recibir más mensajes. | Respuestas posteriores y seguimientos. |
| PAU-03 | El último saliente de la conversación actual fue escrito por un asesor. | Cede el turno hasta que el estado permita retomarlo. |
| PAU-04 | El mensaje tiene 24 horas o más cuando se intenta procesar. | No envía respuesta libre. |
| PAU-05 | El lead queda fuera del modo de pruebas. | Bloqueo del servidor. |
| PAU-06 | Existe una entrega de visita incierta. | Impide duplicar el envío. |

Un `handoff_status=assigned` no equivale automáticamente a detener la IA. El bot se pausa cuando un asesor toma la conversación, cuando se activa el control manual o cuando existe opt-out.

## Reglas de continuidad

- “Está bien”, “sí” o “claro” se interpreta con la última pregunta real y el estado durable.
- “No entiendo”, “a qué se refiere” o “ya te dije” activa reparación de contexto; el bot debe explicar su mensaje anterior sin reiniciar el proceso.
- Un agradecimiento no crea una visita, financiamiento ni reserva.
- Preguntar si alguien irá a la cita consulta el estado; no agenda una nueva cita.
- Una respuesta a un dato financiero conserva el formulario, aunque parezca una palabra de otro dominio.
- Cambiar explícitamente de tema sale del formulario sin borrar lo ya recopilado.

## Reglas de traspaso a un asesor

Se deriva cuando:

- el lead pide explícitamente una persona;
- el expediente financiero está listo para revisión;
- falta un dato comercial que no puede resolverse con fuentes verificadas;
- la coordinación de visita no puede registrarse o verificarse;
- se rechazaron alternativas de visita y la intervención humana es necesaria;
- un fallo operativo deja incierto si una escritura ocurrió.

No se deriva por una pregunta general que el catálogo o el contexto comercial ya pueden contestar. El revisor de cobertura vuelve a comprobar el contexto antes de aceptar un traspaso propuesto por el generador.

## Reglas de salida segura

- Un precio generado que no coincide con los precios permitidos se rechaza.
- Una respuesta no puede afirmar que una cita quedó registrada sin recibo operativo.
- Una propuesta de horario no es una confirmación.
- Un enlace de mapa solo se añade cuando el turno pide ubicación o una confirmación de visita lo requiere.
- Un aviso de traspaso registrado no puede desaparecer durante una reescritura.
- Si cambia la autorización durante la generación, el envío se cancela antes del campo o antes del Salesbot.
