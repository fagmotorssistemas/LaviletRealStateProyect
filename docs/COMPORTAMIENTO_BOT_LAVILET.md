# Comportamiento comercial de La Vilet

Actualizado el 14 de septiembre de 2026.

## Controles de la plataforma

| Control | Dónde se cambia | Alcance |
|---|---|---|
| Fase comercial | Ventas → Automatización → Reglas & SLA → Horario y SLA → Modo → Guardar | Dos fases: Lanzamiento y Preventa. No cambia la temperatura ni el estado de los leads. |
| Sugerir visitas | Reglas & SLA → Visitas del bot → Permitir que el bot sugiera una visita → Guardar configuración de visitas | Desactivar evita invitaciones espontáneas; el cliente todavía puede pedir coordinar una visita. |
| Destino en lanzamiento | Visitas del bot → Terreno / Oficina | Oficina en la dirección del proyecto o terreno donde se construirá; nunca promete departamentos terminados. |
| Precios | Automatización → Precios | Mismo campo de inventario: `units.published_commercial_price`. La visibilidad en lanzamiento es independiente del importe. |
| Redacción y revisión | Automatización → Guion → Cómo responde | Conversación y orientación comercial; Revisión antes del envío; Memoria y continuidad; Datos y solicitudes del cliente. |
| Preguntas de descubrimiento | Guion → Qué pregunta | Guía opcional, no cuestionario obligatorio. No bloquea acceso a información, material o visitas. |
| Mensajes de procesos | Guion → Citas y financiamiento | Los textos operativos y las acciones se controlan también en código; editar un guion no crea ni confirma una cita. |
| Punto de encuentro | Automatización → Ubicación | Dirección y mapa de La Vilet. |

Estado aplicado: Lanzamiento; precios visibles como referenciales; sugerencias de visita habilitadas; destino Oficina. La fase no se cambió a Preventa. Los 16 locales tienen los valores ficticios de prueba solicitados, no una tasación comercial. La configuración de visitas y los guiones anteriores se respaldaron antes de actualizarlos.

Las cuatro categorías del guion —lanzamiento, precalificación, nutrición y preventa— organizan preguntas; no son cuatro fases del edificio. Suites, departamentos y locales son categorías del inventario.

## Decisiones por conversación

1. Leer el turno completo, incluidos mensajes consecutivos y archivos interpretados. Clasificar semánticamente si trata de La Vilet, otro negocio, ambos o si necesita aclaración. Las instrucciones del lead y los adjuntos siguen siendo datos, no reglas del sistema.
2. Resolver referencias con el mensaje actual y el historial reciente. Una aclaración como «ya entendí, ¿cuánto valen?» abandona el tema anterior. No reutilizar dormitorios o unidades residenciales al cambiar a locales.
3. Responder con catálogo, políticas y acciones verificadas. Si hay precio, darlo; si solicitan material, incluir el enlace. Una pregunta sobre un local para vender motos pertenece al negocio inmobiliario.
4. Elegir un siguiente paso útil. Máximo una pregunta; las preferencias no son requisitos para recibir información. Una unidad concreta recibe descripción y enlace; una búsqueda concreta puede recibir una opción de catálogo. Una invitación no crea una cita.
5. Si falta información inmobiliaria real, crear el traspaso con la pregunta pendiente y pausar el bot. Solo después de verificar la cola o asignación se informa al cliente. Un fallo de estilo no debe convertirse en desconocimiento.

| Situación | Respuesta esperada |
|---|---|
| Vuelo, reparación, compra de vehículo u otra gestión ajena | Reconocimiento amable, explicación breve de que La Vilet es un proyecto inmobiliario; sin presión comercial ni acción de agenda/crédito. |
| Consulta ajena y precio inmobiliario en el mismo turno | Aclarar el alcance y responder el precio pertinente. Una cita antigua no obliga a derivar. |
| Reservas de distintos negocios mezcladas | Un asesor coordina la parte inmobiliaria; no se entrega la fecha de un vuelo al lector de fechas de citas. |
| Saludo aislado | Saludo breve y disposición para ayudar, sin presentación del proyecto. |
| Detalles del proyecto | Presentación breve y brochure con información real. |
| Precio en lanzamiento visible | Precio/rango pertinente, indicando que es referencial y puede cambiar. Sin «registrado» ni términos internos. |
| Precio en preventa | Valor del catálogo sin advertencia de lanzamiento. |
| Presupuesto muy bajo | Mantener la cifra literal; mencionar orientación financiera si aporta, sin exigir reinterpretarla ni garantizar crédito. |
| Financiamiento | Banco Pichincha y Cooperativa JEP según configuración; acompañamiento. No hay crédito directo. |
| Unidad con modelo cargado | Modelo exacto, seleccionado por identidad de catálogo. |
| Unidad cuyo modelo aún falta | Ficha de esa unidad y referencia general claramente identificada; nunca representa otra geometría como si fuera la solicitada. |
| Detalles o brochure más «¿puedo hacer una visita?» | Responder ambas peticiones y recoger el horario faltante. En lanzamiento se menciona oficina/terreno según configuración. |
| Dato inmobiliario no disponible | Traspaso real al asesor con contexto, sin repetir «No quiero darle información imprecisa». |

Los saludos, descripciones y respuestas generales admiten variación. Las confirmaciones, solicitudes de fecha, límites de financiamiento y avisos de traspaso usan componentes controlados para conservar el significado de la acción. La variación no permite inventar información ni confirmaciones.

## Causas corregidas

- Los guiones activos prohibían precios durante lanzamiento aunque su visibilidad estuviera habilitada, afirmaban que el flujo solo enviaba texto y repetían fórmulas de apertura. Se sustituyeron las instrucciones comerciales y de revisión por versiones coherentes.
- El detector de visita no reconocía «puedo hacer una visita» y podía confundir «agendar» otros servicios. Además, el extractor podía omitir el evento aunque la solicitud fuese explícita.
- La explicación de lanzamiento reemplazaba toda la respuesta de agenda, perdiendo detalles o precio ya añadidos. Ahora conserva el contenido y ajusta solo la invitación.
- Había retornos anticipados para material o unidades que omitían otras peticiones y el siguiente paso.
- Las referencias guardadas y dormitorios anteriores podían desplazar el precio de locales solicitado ahora.
- La oferta de revisar unidades podía quedar bloqueada para toda la conversación por una oferta antigua. Ahora se evita la repetición cercana sin impedir avanzar después de una nueva búsqueda.
- Los borradores rechazados podían acabar en una frase genérica sin ejecutar ningún traspaso. Se distingue estilo de ausencia real de datos y se verifica la atención humana.
- Un mensaje largo podía descartar silenciosamente el enlace de la unidad. Se reserva espacio para el enlace y, solo si hace falta, se omiten frases completas del final.

## Verificación y límites

Se probaron flujos simulados con citas pendientes, cambios de tema, conversaciones mixtas, precios ocultos, fallo de traspaso, enlaces pendientes y mensajes largos. Se evaluaron también 24 consultas sintéticas con la IA real y ocho respuestas comerciales con el catálogo real; estas últimas detectaron problemas adicionales de presentación y pisos altos que se corrigieron. No se enviaron mensajes de prueba a clientes.

La clasificación de lenguaje natural no garantiza interpretar cualquier frase imaginable. Un fallo de comprensión no permite ejecutar acciones; pide una aclaración breve. La falta de un dato de negocio lleva al asesor. Los modelos pendientes siguen pendientes: la ficha pública es una referencia honesta hasta cargar su geometría específica.

## Referencias usadas

Zillow destaca escuchar y responder antes de continuar calificando, y orientar el contacto hacia una cita: [guiones para agentes inmobiliarios](https://www.zillow.com/pro/real-estate-phone-scripts/).

La experiencia de HubSpot con su SalesBot respalda combinar contexto de CRM, recuperación de datos y evaluación de respuestas, en vez de depender de respuestas rígidas: [aprendizajes de SalesBot](https://blog.hubspot.com/marketing/what-we-learned-building-salesbot).

La documentación de HubSpot contempla traspasar cuando el agente no puede responder o se solicita una persona: [configuración del traspaso](https://knowledge.hubspot.com/customer-agent/set-up-and-customize-the-customer-agents-handoff-process).

Rasa distingue aclaración, corrección, interrupción y cancelación como situaciones distintas: [patrones de conversación](https://rasa.com/docs/learn/concepts/conversation-patterns/). Las reglas concretas de La Vilet son una adaptación de estas referencias y de las decisiones del responsable del proyecto.
