# Despliegue de selección semanal

1. Ejecutar pruebas y build antes del commit.
2. Aplicar solo `20260925120000_weekly_objective_qualification_selection.sql` con
   `operations/install-weekly-objective-selection.ps1 -Apply`.
3. Desplegar el frontend candidato. El cron diario queda instalado, pero la fila
   `crm_weekly_objective_selection_activation.enabled=false` impide escrituras.
4. Validar el panel: propios, incorporados, elegibles, enviados, Meta aceptó y faltante.
5. En una autorización posterior, activar únicamente la selección interna. Esto no
   activa `QualifiedLead`, CAPI ni otro consumidor.

Reversión operativa: establecer `enabled=false`, conservar las selecciones como
evidencia y revertir el despliegue frontend. No borrar filas ni revertir reglas de
puntuación. Si la migración falla, su transacción no deja objetos parciales. Si falla
el registro de historial, detenerse y conciliar la versión; no repetir a ciegas.

Relaciones justificadas: interés comercial (precio, entrega, ubicación/características,
propósito y tipo de unidad), financiamiento, visita, reserva y tour. `first_response`,
`nutrition_response` y los dos `decay` permanecen sin objetivo porque su significado
no identifica un destino comercial. Ninguna selección crea Purchase, Schedule ni
otro hecho; QualifiedLead conserva su productor, controles e identidad existentes.
