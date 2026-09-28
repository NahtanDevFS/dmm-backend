-- ============================================================================
-- 30_recalcular_cabecera_al_asignar_donacion.sql
--
-- PROBLEMA (detectado al preparar la exposición del backend)
--
-- Cuando llega una donación, sp_procesar_donacion_pendientes recorre la lista
-- de espera del insumo y pasa cada línea de PENDIENTE_ADQUISICION a
-- PENDIENTE_ENTREGA (o PENDIENTE_ENTREGA_PARCIAL si el stock no alcanza para
-- todo lo pedido). Pero solo actualiza la LÍNEA: la cabecera de la solicitud
-- se quedaba en PENDIENTE_ADQUISICION.
--
-- CONSECUENCIA
--
-- Una solicitud cuya única línea ya estaba lista para entregar seguía
-- apareciendo como "pendiente de adquisición" en el listado de solicitudes y
-- en los filtros por estado, hasta que alguna entrega la recalculara. Quien
-- buscaba "qué hay para entregar" filtrando por estado no la encontraba.
--
-- CORRECCION
--
-- Después de actualizar cada línea, el procedimiento llama a
-- fn_recalcular_cabecera_solicitud, la misma función que ya usan las
-- entregas y las anulaciones. Así la cabecera se deriva de sus líneas con una
-- sola regla, sea cual sea la operación que las cambió.
--
-- El resto del procedimiento no cambia: mismo orden de atención (quien lleva
-- más tiempo esperando), mismo bloqueo FOR UPDATE ... SKIP LOCKED, y sigue
-- sin descontar inventario (eso ocurre al registrar la entrega).
--
-- Idempotente: CREATE OR REPLACE conserva dueño y permisos.
-- ============================================================================

BEGIN;

CREATE OR REPLACE PROCEDURE public.sp_procesar_donacion_pendientes(
    IN p_insumo_id integer,
    IN p_recepcion_lote_id integer
)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_linea                                RECORD;
    v_stock_restante                        integer;
    v_asignar                               integer;
    v_estado_pendiente_adquisicion_id       integer;
    v_estado_pendiente_entrega_id           integer;
    v_estado_pendiente_entrega_parcial_id   integer;
BEGIN
    v_stock_restante := public.fn_stock_disponible(p_insumo_id);

    IF v_stock_restante = 0 THEN
        RETURN;
    END IF;

    SELECT id INTO v_estado_pendiente_adquisicion_id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ADQUISICION';
    SELECT id INTO v_estado_pendiente_entrega_id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ENTREGA';
    SELECT id INTO v_estado_pendiente_entrega_parcial_id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ENTREGA_PARCIAL';

    FOR v_linea IN
        SELECT dsa.id, dsa.solicitud_id, dsa.cantidad_requerida, dsa.cantidad_entregada
        FROM public.detalle_solicitud_apoyo dsa
        WHERE dsa.insumo_id = p_insumo_id
          AND dsa.estado_id = v_estado_pendiente_adquisicion_id
          AND dsa.activo = true
        ORDER BY dsa.created_at ASC
        FOR UPDATE OF dsa SKIP LOCKED
    LOOP
        EXIT WHEN v_stock_restante = 0;

        v_asignar := LEAST(
            v_stock_restante,
            v_linea.cantidad_requerida - v_linea.cantidad_entregada
        );

        -- No se descuenta inventario real aqui: eso ocurre al registrar la
        -- entrega (fn_crear_entrega + sp_agregar_insumo_entrega). Este SP solo
        -- marca la linea como lista para entregar.
        UPDATE public.detalle_solicitud_apoyo
        SET estado_id = CASE
                WHEN v_asignar >= (v_linea.cantidad_requerida - v_linea.cantidad_entregada)
                    THEN v_estado_pendiente_entrega_id
                ELSE v_estado_pendiente_entrega_parcial_id
            END,
            fecha_asignacion = CURRENT_DATE
        WHERE id = v_linea.id;

        -- Migracion 30: la cabecera se deriva de sus lineas con la misma regla
        -- que usan las entregas y las anulaciones.
        PERFORM public.fn_recalcular_cabecera_solicitud(v_linea.solicitud_id);

        v_stock_restante := v_stock_restante - v_asignar;
    END LOOP;
END;
$$;

COMMIT;
