-- ============================================================================
-- 10_auditoria_sesion_sin_latido.sql
--
-- PROBLEMA
-- requireAuth refresca sesion.ultima_actividad y `sesion` esta auditada, asi que
-- cada peticion autenticada escribia una fila en auditoria_log. Medido en la
-- base local:
--
--   UPDATE de sesion en el log        : 1174
--   de esos, solo ultima_actividad    : 1166  (99%)
--   proporcion del log completo       : 56%
--   peso por fila                     : ~1 KB
--
-- Mas de la mitad de la bitacora era ruido.
--
-- SOLUCION
-- El trigger se separa por evento y el de UPDATE solo dispara si cambio algo
-- MAS que el latido. Se conserva la intencion de la seccion 8.2 del documento
-- maestro: una modificacion no autorizada a una fila de `sesion` sigue quedando
-- registrada, porque tocaria revocada_en, expira_en, token_hash o usuario_id.
--
-- LIMITE CONOCIDO
-- Un atacante con acceso de escritura a la base que UNICAMENTE empuje
-- ultima_actividad, para mantener viva una sesion mas alla de los 30 minutos de
-- inactividad, ya no quedaria auditado. Con ese nivel de acceso tambien podria
-- desactivar el trigger, asi que la proteccion era ilusoria de todos modos.
--
-- Complementa al freno del lado del backend (LATIDO_MINIMO_MS en
-- auth.middleware.ts), que ademas reduce las escrituras a la base.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_auditoria_sesion ON public.sesion;

-- El alta de sesion (login) se audita siempre: es el registro de acceso.
CREATE TRIGGER trg_auditoria_sesion_insert
AFTER INSERT ON public.sesion
FOR EACH ROW
EXECUTE FUNCTION public.fn_auditoria();

-- El UPDATE solo se audita si cambio algo distinto del latido. Se comparan las
-- filas como jsonb quitando las tres columnas que el latido mueve:
-- ultima_actividad, y updated_at/updated_by que arrastran el trigger de
-- updated_at y el propio backend.
CREATE TRIGGER trg_auditoria_sesion_update
AFTER UPDATE ON public.sesion
FOR EACH ROW
WHEN (
  to_jsonb(OLD) - 'ultima_actividad' - 'updated_at' - 'updated_by'
  IS DISTINCT FROM
  to_jsonb(NEW) - 'ultima_actividad' - 'updated_at' - 'updated_by'
)
EXECUTE FUNCTION public.fn_auditoria();

-- Verificacion:
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--   WHERE tgrelid = 'public.sesion'::regclass AND NOT tgisinternal;
