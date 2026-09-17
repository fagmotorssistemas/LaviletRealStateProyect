-- EMERGENCIA MANUAL — no es rollback operativo.
-- Rollback predeterminado: apagar flags Schedule + restaurar código; conservar datos.
-- Este archivo solo documenta que 17180000 no debe revertirse con DROP de consent RPCs.
-- Para deshacer el cambio de cancelación de review_hold, reaplicar las firmas
-- de 20260915160000 (revoke) y 20260915171000 (record) desde esos archivos.

SELECT 1;
