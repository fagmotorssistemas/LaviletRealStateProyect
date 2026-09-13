# Variedad de aperturas

Se retiró el prefijo automático «Claro, con mucho gusto» de las explicaciones del proyecto y del respaldo de consultas comerciales. Las instrucciones usan las seis respuestas recientes del bot o del asesor de la conversación para variar estructura y evitar muletillas equivalentes.

El texto generado se revisa con esas instrucciones y pasa por una corrección acotada de cortesías repetidas. La misma corrección se aplica antes de enviar respuestas operativas. Solo se retiran cláusulas introductorias genéricas completas; se conservan sí/no, condiciones, disculpas, saludos, datos, enlaces y cortesías que constituyen toda la respuesta. No se seleccionan saludos al azar ni se modifica la decisión de financiamiento o cita.

También se alineó el límite de beneficios de las instrucciones con el filtro: hasta tres pertinentes, sin obligación de enumerarlos. Un rechazo de estilo en la presentación del proyecto dispone de una respuesta de respaldo basada en el contexto del proyecto.

`scripts/evaluate-opening-variety.cjs --live` realiza una conversación ficticia usando datos y prompts vigentes. Consume llamadas al modelo; no envía WhatsApp ni escribe datos comerciales. `--debug` imprime únicamente borradores y revisiones de esos ejemplos ficticios. Las pruebas automáticas verifican conservación de decisiones y enlaces, aislamiento del historial y ausencia del prefijo forzado.

La documentación de OpenAI recomienda definir el estilo y las instrucciones de forma explícita y usar ejemplos variados para orientar los resultados. La evaluación con conversaciones representativas complementa las comprobaciones deterministas; no demuestra que cada respuesta futura será perfecta. [OpenAI Docs: prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering).
