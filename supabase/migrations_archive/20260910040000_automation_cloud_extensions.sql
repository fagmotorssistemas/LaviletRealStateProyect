-- Infraestructura del disparador. No programa envíos ni modifica tablas de negocio.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
-- La cola HTTP contiene temporalmente la cabecera de autorización.
REVOKE ALL ON TABLE net.http_request_queue, net._http_response FROM PUBLIC, anon, authenticated;

