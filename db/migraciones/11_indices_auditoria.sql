-- ============================================================================
-- 11_indices_auditoria.sql
--
-- PROBLEMA
-- auditoria_log solo tiene dos indices: la clave primaria y uno por
-- tipo_accion_id, que es justo el filtro MENOS selectivo (solo 3 valores
-- posibles: INSERT, UPDATE, DELETE). No hay indice por tabla_afectada,
-- fecha_hora ni usuario_id, que es exactamente por lo que filtra
-- GET /api/auditoria.
--
-- Con 2000 filas da igual; con 500.000 el listado se degrada a un seq scan.
--
-- OJO EN PRODUCCION: usar CREATE INDEX CONCURRENTLY cuando la tabla ya sea
-- grande, para no bloquear las escrituras mientras se construye el indice.
-- CONCURRENTLY no puede ir dentro de una transaccion, asi que en ese caso hay
-- que ejecutar cada sentencia por separado.
-- ============================================================================

-- El caso mas usado: historial de una ficha concreta
-- (GET /api/auditoria/:tabla/:registroId) y el filtro por tabla.
CREATE INDEX IF NOT EXISTS idx_auditoria_tabla_registro
  ON public.auditoria_log (tabla_afectada, registro_id);

-- El listado ordena por fecha_hora DESC y filtra por rango de fechas.
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha
  ON public.auditoria_log (fecha_hora DESC);

-- Filtro por autor. Parcial: las filas sin usuario (inserciones por SQL directo
-- sin app.usuario_id) no se buscan nunca por este camino.
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario
  ON public.auditoria_log (usuario_id)
  WHERE usuario_id IS NOT NULL;

-- Verificacion:
--   SELECT indexname FROM pg_indexes
--   WHERE schemaname='public' AND tablename='auditoria_log';
