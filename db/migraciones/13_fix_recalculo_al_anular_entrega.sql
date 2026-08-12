-- ============================================================================
-- 13_fix_recalculo_al_anular_entrega.sql
--
-- PROBLEMA (detectado por tests/negocio/lista-espera.test.ts)
--
-- Al anular una entrega, `cantidad_entregada` de la linea vuelve a 0
-- correctamente, pero el `estado_id` se queda en ENTREGADA.
--
-- La causa esta en el CASE de `fn_recalcular_linea_solicitud`: cuando el total
-- entregado es 0, la rama ELSE conserva el estado actual. El comentario
-- original lo explica -- "conserva el estado actual (PENDIENTE_ENTREGA o
-- PENDIENTE_ADQUISICION) si no hay nada entregado" -- y para una linea que
-- nunca recibio nada eso es correcto. Lo que no se contemplo es la REGRESION:
-- si la linea estaba ENTREGADA y la entrega se anula, el estado previo que se
-- conserva es justamente ENTREGADA.
--
-- CONSECUENCIA
--
-- La linea queda marcada como entregada con 0 unidades entregadas. Como
-- `v_lista_espera` solo muestra PENDIENTE_ADQUISICION y
-- PENDIENTE_ENTREGA_PARCIAL, esa persona desaparece de toda lista de
-- pendientes; y como `fn_recalcular_cabecera_solicitud` cuenta ENTREGADA como
-- linea cerrada, la solicitud completa se marca como entregada.
--
-- Es decir: se registra una entrega por error, se anula, y el beneficiario
-- queda fuera del sistema como si ya hubiera recibido su insumo. En silencio.
--
-- La cabecera tiene el mismo hueco: si todas sus lineas vuelven a un estado
-- pendiente, ninguna rama del IF se cumple y la solicitud conserva ENTREGADA.
--
-- CORRECCION
--
-- Ambas funciones pasan a recalcular tambien "hacia atras". Los estados
-- terminales por decision humana (CANCELADA, RECHAZADA, APROBADA) NO se tocan:
-- una linea cancelada no debe resucitar porque se anule una entrega.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Linea de solicitud
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_linea_solicitud(
    p_detalle_solicitud_id integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_cantidad_requerida integer;
    v_solicitud_id        integer;
    v_total_entregado     integer;
    v_insumo_id           integer;
    v_estado_actual       character varying;
    v_estado_nuevo_id     integer;
BEGIN
    SELECT dsa.cantidad_requerida, dsa.solicitud_id, dsa.insumo_id, esa.nombre
    INTO v_cantidad_requerida, v_solicitud_id, v_insumo_id, v_estado_actual
    FROM public.detalle_solicitud_apoyo dsa
    JOIN public.estado_solicitud_apoyo esa ON esa.id = dsa.estado_id
    WHERE dsa.id = p_detalle_solicitud_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT COALESCE(SUM(de.cantidad_entregada), 0) INTO v_total_entregado
    FROM public.detalle_entrega de
    JOIN public.entrega e ON e.id = de.entrega_id
    WHERE e.detalle_solicitud_id = p_detalle_solicitud_id
      AND de.activo = true
      AND e.activo = true;

    IF v_total_entregado >= v_cantidad_requerida THEN
        SELECT id INTO v_estado_nuevo_id
        FROM public.estado_solicitud_apoyo WHERE nombre = 'ENTREGADA';

    ELSIF v_total_entregado > 0 THEN
        SELECT id INTO v_estado_nuevo_id
        FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ENTREGA_PARCIAL';

    ELSE
        -- Nada entregado. Dos situaciones distintas:
        --
        --   a) La linea nunca recibio nada: conserva el estado que le fijo
        --      fn_estado_inicial_linea_solicitud, o el terminal que le haya
        --      dado una decision humana (CANCELADA, RECHAZADA, APROBADA).
        --
        --   b) La linea SI tenia entregas y se anularon: hay que devolverla a
        --      pendiente, o desaparece de la lista de espera. Este es el caso
        --      que faltaba.
        IF v_estado_actual IN ('ENTREGADA', 'PENDIENTE_ENTREGA_PARCIAL') THEN
            -- Se recalcula por stock, igual que al crear la linea, porque el
            -- inventario pudo cambiar desde entonces.
            IF public.fn_stock_disponible(v_insumo_id) > 0 THEN
                SELECT id INTO v_estado_nuevo_id
                FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ENTREGA';
            ELSE
                SELECT id INTO v_estado_nuevo_id
                FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ADQUISICION';
            END IF;
        ELSE
            v_estado_nuevo_id := NULL;  -- sin cambio
        END IF;
    END IF;

    UPDATE public.detalle_solicitud_apoyo
    SET cantidad_entregada = v_total_entregado,
        estado_id = COALESCE(v_estado_nuevo_id, estado_id)
    WHERE id = p_detalle_solicitud_id;

    PERFORM public.fn_recalcular_cabecera_solicitud(v_solicitud_id);
END;
$function$;

COMMENT ON FUNCTION public.fn_recalcular_linea_solicitud(integer) IS
    'RF-PRO/RF-ENT. Recalcula cantidad_entregada y estado de una LINEA a partir de sus entregas activas. Soporta la REGRESION: si se anulan las entregas, la linea vuelve a PENDIENTE_ENTREGA/PENDIENTE_ADQUISICION segun stock, en vez de quedarse en ENTREGADA con 0 unidades. Los estados terminales por decision humana (CANCELADA, RECHAZADA, APROBADA) no se alteran.';

-- ---------------------------------------------------------------------
-- 2. Cabecera de solicitud
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_cabecera_solicitud(
    p_solicitud_id integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_total_lineas       integer;
    v_lineas_cerradas    integer;  -- ENTREGADA o CANCELADA
    v_lineas_con_avance  integer;  -- alguna entrega parcial
    v_lineas_sin_stock   integer;  -- PENDIENTE_ADQUISICION
    v_estado_actual      character varying;
BEGIN
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE esa.nombre IN ('ENTREGADA', 'CANCELADA')),
        COUNT(*) FILTER (WHERE esa.nombre = 'PENDIENTE_ENTREGA_PARCIAL'),
        COUNT(*) FILTER (WHERE esa.nombre = 'PENDIENTE_ADQUISICION')
    INTO v_total_lineas, v_lineas_cerradas, v_lineas_con_avance, v_lineas_sin_stock
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

    IF v_total_lineas = v_lineas_cerradas THEN
        UPDATE public.solicitud_apoyo
        SET estado_id = (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'ENTREGADA')
        WHERE id = p_solicitud_id;

    ELSIF v_lineas_con_avance > 0 OR v_lineas_cerradas > 0 THEN
        UPDATE public.solicitud_apoyo
        SET estado_id = (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ENTREGA_PARCIAL')
        WHERE id = p_solicitud_id;

    ELSE
        -- Ninguna linea tiene avance. Antes esta rama no existia y la cabecera
        -- conservaba su estado, lo que dejaba solicitudes marcadas ENTREGADA
        -- despues de anular todas sus entregas.
        IF v_lineas_sin_stock = v_total_lineas THEN
            UPDATE public.solicitud_apoyo
            SET estado_id = (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ADQUISICION')
            WHERE id = p_solicitud_id;
        ELSE
            UPDATE public.solicitud_apoyo
            SET estado_id = (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ENTREGA')
            WHERE id = p_solicitud_id;
        END IF;
    END IF;
END;
$function$;

COMMENT ON FUNCTION public.fn_recalcular_cabecera_solicitud(integer) IS
    'RF-PRO/RF-ENT. Deriva el estado de la cabecera agregando el de todas sus lineas: ENTREGADA cuando todas estan ENTREGADA/CANCELADA; PENDIENTE_ENTREGA_PARCIAL si hay avance; y PENDIENTE_ENTREGA/PENDIENTE_ADQUISICION cuando ninguna linea tiene avance (caso de anulacion). RECHAZADA no se deriva: es decision de direccion.';

COMMIT;

-- ============================================================================
-- DATOS YA AFECTADOS
--
-- Si en la base real se anulo alguna entrega antes de aplicar esto, quedaron
-- lineas ENTREGADA con cantidad_entregada = 0, invisibles en la lista de
-- espera. Para encontrarlas:
--
--   SELECT dsa.id, dsa.solicitud_id, p.nombres || ' ' || p.apellidos AS persona,
--          i.nombre AS insumo, dsa.cantidad_requerida
--   FROM public.detalle_solicitud_apoyo dsa
--   JOIN public.estado_solicitud_apoyo esa ON esa.id = dsa.estado_id
--   JOIN public.solicitud_apoyo sa ON sa.id = dsa.solicitud_id
--   JOIN public.persona p ON p.id = sa.persona_id
--   JOIN public.insumo i ON i.id = dsa.insumo_id
--   WHERE esa.nombre = 'ENTREGADA'
--     AND dsa.cantidad_entregada = 0
--     AND dsa.activo = true;
--
-- Para repararlas, basta con forzar el recalculo ya corregido:
--
--   SELECT public.fn_recalcular_linea_solicitud(id)
--   FROM public.detalle_solicitud_apoyo dsa
--   WHERE dsa.activo = true
--     AND dsa.cantidad_entregada = 0
--     AND dsa.estado_id = (SELECT id FROM public.estado_solicitud_apoyo
--                          WHERE nombre = 'ENTREGADA');
--
-- Revise el listado antes de ejecutar la reparacion.
-- ============================================================================
