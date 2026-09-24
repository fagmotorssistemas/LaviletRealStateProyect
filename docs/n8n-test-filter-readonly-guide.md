# Localizar la persona permitida sin ejecutar ni modificar n8n

Estado: WhatsApp Business confirmado por el responsable. lavilet-chat está activo y restringido a una persona. La persona/filtro de n8n aún no se han verificado. El CRM mantiene test_only=true para Carlos Fabián (ficha 4454162, contacto 9432278), pero esa configuración no prueba cuál usa n8n. No se escoge Pablo ni Carlos por deducción.

1. Abrir n8n con la sesión habitual. Entrar en **Workflows** y abrir el flujo que contiene el Webhook con path **lavilet-chat**. Ese path puede ser distinto del nombre del flujo. No mostrar la URL completa si contiene claves.
2. En **Editor**, localizar el nodo Webhook y seguir sus conexiones. Buscar antes del agente/bot o del nodo de envío un **If**, **Filter**, **Switch** o **Code**. Puede llamarse “Solo pruebas”, “Contacto permitido” u otro nombre.
3. Abrir el candidato sin pulsar **Execute workflow**, **Execute step**, **Test workflow**, **Retry**, **Publish**, ni cambiar el interruptor activo. En If/Filter mirar **Parameters → Conditions**. En Switch, las reglas. En Code, solo leer el fragmento de comparación.
4. Primera pantalla útil: captura recortada del diagrama desde Webhook hasta el filtro, con nombres y flechas, sin paneles de credenciales. Esto permite identificar qué nodo necesitamos abrir si no se reconoce el filtro.
5. Segunda pantalla útil: condiciones del nodo, mostrando nombre del campo/expresión (por ejemplo entity_id, lead_id o contact_id), operador, valor ID y cómo se combinan AND/OR. Ocultar teléfonos, claves, cabeceras Authorization, mensajes y URLs con parámetros. Si compara un teléfono, ocultar el número; indicar únicamente que se compara un teléfono. No cambiarlo por un ID.
6. Si la condición usa una variable, basta mostrar su nombre y la expresión; no abrir almacenes de credenciales. Será necesario identificar su procedencia y el ID de la ficha que pasa el filtro mediante una ejecución ya existente, no generando una nueva.
7. Si hace falta confirmar la configuración usada realmente, abrir **Executions**, elegir una ejecución pasada y consultar el filtro y su resultado. No reintentar ni copiar al editor para ejecutar. Mostrar únicamente IDs de ficha/contacto, condición y rama tomada. Un borrador actual puede diferir de la versión publicada: conservar fecha de ejecución y versión si se muestra.

Con estas pantallas se contrastará la ficha con Kommo y la clasificación interna. Si la persona elegida está permitida por n8n, n8n podría responderle; el observador no impide esos envíos. Hasta confirmar la condición y acordar esa situación, la prueba con mensajes queda pendiente. La restricción existente y los clientes de Casa De Tarqui no se modifican.

Documentación: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.if/ y https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.filter/.
