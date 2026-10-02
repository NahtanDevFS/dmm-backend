-- ============================================================================
-- 33_cabecera_cancelada.sql
--
-- PROBLEMA (detectado al preparar la exposición del backend)
--
-- fn_recalcular_cabecera_solicitud cerraba la solicitud como ENTREGADA en
-- cuanto todas sus líneas estaban ENTREGADA o CANCELADA, sin mirar si se había
-- entregado algo. Una solicitud cuya única línea se canceló quedaba
-- «ENTREGADA», mientras la pantalla (que muestra el estado de la línea) decía
-- «Cancelada». En la base de desarrollo había 3 así.
--
-- Además, una línea cancelada contaba como avance: con una línea cancelada y
-- otra todavía sin stock, la cabecera pasaba a PENDIENTE_ENTREGA_PARCIAL, como
-- si ya se hubiera entregado una parte.
--
-- CORRECCION
--
-- La cabecera sigue a lo que de verdad pasó con las líneas:
--   - Todas cerradas y se entregó algo .......... ENTREGADA
--   - Todas cerradas y no se entregó nada ....... CANCELADA
--   - Quedan abiertas, y ya se entregó algo o hay
--     una línea cubierta en parte ............... PENDIENTE_ENTREGA_PARCIAL
--   - Quedan abiertas, todas sin stock .......... PENDIENTE_ADQUISICION
--   - Quedan abiertas, alguna con stock ......... PENDIENTE_ENTREGA
-- «Se entregó algo» es cantidad_entregada > 0, no el estado: una línea
-- entregada en parte y luego cancelada sí recibió algo. Las líneas canceladas
-- no cuentan para decidir entre los estados pendientes. RECHAZADA sigue sin
-- tocarse: es una decisión de la Dirección.
--
-- Datos: se recalculan las solicitudes activas que tienen alguna línea
-- cancelada, que son las únicas a las que la regla nueva les puede cambiar el
-- estado.
--
-- Idempotente: CREATE OR REPLACE, y recalcular dos veces da lo mismo.
-- ============================================================================

SET client_encoding = 'UTF8';

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_recalcular_cabecera_solicitud(p_solicitud_id integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_total_lineas      integer;
    v_lineas_abiertas   integer;  -- ni ENTREGADA ni CANCELADA
    v_lineas_con_entrega integer; -- recibieron algo (cantidad_entregada > 0)
    v_lineas_parciales  integer;  -- PENDIENTE_ENTREGA_PARCIAL (entrega o donacion parcial)
    v_abiertas_sin_stock integer; -- abiertas en PENDIENTE_ADQUISICION
    v_estado_actual     character varying;
    v_estado_nuevo      character varying;
BEGIN
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE esa.nombre NOT IN ('ENTREGADA', 'CANCELADA')),
        COUNT(*) FILTER (WHERE dsa.cantidad_entregada > 0),
        COUNT(*) FILTER (WHERE esa.nombre = 'PENDIENTE_ENTREGA_PARCIAL'),
        COUNT(*) FILTER (WHERE esa.nombre = 'PENDIENTE_ADQUISICION')
    INTO v_total_lineas, v_lineas_abiertas, v_lineas_con_entrega, v_lineas_parciales,
         v_abiertas_sin_stock
    FROM public.detalle_solicitud_apoyo dsa
    JOIN public.estado_solicitud_apoyo esa ON esa.id = dsa.estado_id
    WHERE dsa.solicitud_id = p_solicitud_id
      AND dsa.activo = true;

    IF v_total_lineas = 0 THEN
        RETURN;
    END IF;

    SELECT esa.nombre INTO v_estado_actual
    FROM public.solicitud_apoyo sa
    JOIN public.estado_solicitud_apoyo esa ON esa.id = sa.estado_id
    WHERE sa.id = p_solicitud_id;

    -- RECHAZADA es una decision de direccion: no se deriva de las lineas.
    IF v_estado_actual = 'RECHAZADA' THEN
        RETURN;
    END IF;

    IF v_lineas_abiertas = 0 THEN
        -- Todas cerradas. Antes siempre ENTREGADA, aunque solo hubiera
        -- lineas canceladas.
        v_estado_nuevo := CASE WHEN v_lineas_con_entrega > 0
                               THEN 'ENTREGADA' ELSE 'CANCELADA' END;
    ELSIF v_lineas_con_entrega > 0 OR v_lineas_parciales > 0 THEN
        -- Una linea queda PARCIAL tambien cuando la donacion la cubrio solo
        -- en parte, aunque todavia no se haya entregado nada
        v_estado_nuevo := 'PENDIENTE_ENTREGA_PARCIAL';
    ELSIF v_abiertas_sin_stock = v_lineas_abiertas THEN
        -- Las canceladas no cuentan: lo que queda por resolver es lo abierto
        v_estado_nuevo := 'PENDIENTE_ADQUISICION';
    ELSE
        v_estado_nuevo := 'PENDIENTE_ENTREGA';
    END IF;

    -- Solo se escribe si cambia: cada UPDATE deja una fila en la auditoria
    IF v_estado_nuevo IS DISTINCT FROM v_estado_actual THEN
        UPDATE public.solicitud_apoyo
        SET estado_id = (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = v_estado_nuevo)
        WHERE id = p_solicitud_id;
    END IF;
END;
$function$;

-- Solicitudes ya afectadas: las que tienen alguna linea cancelada
DO $datos$
DECLARE
    v_solicitud integer;
BEGIN
    FOR v_solicitud IN
        SELECT DISTINCT dsa.solicitud_id
        FROM public.detalle_solicitud_apoyo dsa
        JOIN public.estado_solicitud_apoyo esa ON esa.id = dsa.estado_id
        JOIN public.solicitud_apoyo sa ON sa.id = dsa.solicitud_id
        WHERE esa.nombre = 'CANCELADA'
          AND dsa.activo = true
          AND sa.activo = true
    LOOP
        PERFORM public.fn_recalcular_cabecera_solicitud(v_solicitud);
    END LOOP;
END
$datos$;

COMMIT;
