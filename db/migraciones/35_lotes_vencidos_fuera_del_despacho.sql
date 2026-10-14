-- ============================================================================
-- 35_lotes_vencidos_fuera_del_despacho.sql
--
-- PROBLEMA
--
-- Un lote con fecha de caducidad pasada seguía contando como existencia
-- disponible hasta que alguien lo diera de baja a mano con
-- sp_dar_baja_insumo_vencido:
--
--   - fn_stock_disponible lo sumaba, así que una línea nueva entraba en
--     PENDIENTE_ENTREGA aunque solo hubiera medicamento vencido, y un insumo
--     con bloquea_solicitud_sin_stock dejaba registrar la solicitud.
--   - v_inventario_lote_fifo lo ponía PRIMERO: el orden FEFO va por fecha de
--     caducidad ascendente, y la fecha más antigua es justamente la vencida.
--     El despacho automático entregaba el lote vencido antes que ninguno.
--   - v_stock_insumo (inventario, entrega directa, préstamo, solicitud) lo
--     mostraba como disponible.
--
-- Medido en desarrollo el 13/10/2026: un lote de Paracetamol 500 mg vencido
-- el 09/10/2026 con 470 unidades, primero en la cola FEFO.
--
-- Aparte, v_lista_espera solo mostraba PENDIENTE_ADQUISICION y
-- PENDIENTE_ENTREGA_PARCIAL. Una línea en PENDIENTE_ENTREGA (había existencias
-- al asignarla) cuyo insumo se quedó sin existencias después —otra entrega se
-- las llevó, se dieron de baja o vencieron— no aparecía en ningún lado como
-- "esperando". PENDIENTE_ENTREGA no aparta unidades: dice que había, no que
-- estén reservadas.
--
-- CORRECCION
--
--   1. fn_stock_disponible no cuenta los lotes vencidos (caducidad < hoy). Lo
--      heredan el estado inicial de la línea, el bloqueo de solicitud sin
--      stock, la validación de sp_agregar_insumo_entrega, el recálculo de la
--      línea y la asignación de donaciones.
--   2. v_inventario_lote_fifo deja fuera los lotes vencidos: el reparto FEFO
--      de sp_agregar_insumo_entrega y la vista previa de lotes del backend los
--      saltan. Mismas columnas: no requiere prisma:pull.
--   3. fn_descontar_inventario rechaza descontar de un lote vencido. Es el
--      único punto por el que pasa todo despacho (FEFO, unidad elegida a mano,
--      préstamo), así que la regla no depende de que cada camino la recuerde.
--   4. v_stock_insumo: stock_total pasa a ser lo que se puede entregar, y se
--      agrega al final la columna stock_vencido (unidades en lotes vencidos
--      que siguen activos, pendientes de baja). El semáforo y la próxima
--      caducidad siguen considerando los vencidos: son la alerta para darlos
--      de baja.
--   5. v_reporte_stock_por_categoria: unidades_totales_disponibles deja de
--      contar las vencidas, igual que el inventario. El conteo de lotes
--      urgentes o vencidos no cambia.
--   6. v_lista_espera incluye también las líneas PENDIENTE_ENTREGA cuyo insumo
--      hoy no tiene ninguna existencia entregable, y agrega al final la
--      columna sin_existencias para distinguirlas.
--
-- LIMITES
--
--   - Los lotes vencidos NO se dan de baja solos: siguen activos y con su
--     cantidad, visibles en el semáforo, hasta que alguien registre la baja
--     con su motivo. Darlos de baja automáticamente borraría la constancia de
--     quién decidió desecharlos.
--   - El estado de las líneas no se reescribe: una línea PENDIENTE_ENTREGA sin
--     existencias sigue en ese estado (la caducidad llega con el calendario,
--     sin ninguna escritura que dispare un trigger). La lista de espera la
--     calcula al consultarla.
--   - Un lote vence al terminar el día de su caducidad: el mismo día de la
--     fecha todavía se puede entregar, igual que en fn_semaforo_caducidad.
--
-- Requisitos: correr como el dueño de la base (no dmm_app). CREATE OR REPLACE
-- conserva dueño y permisos. Si la base de destino tuviera una versión
-- distinta de alguna de estas vistas, CREATE OR REPLACE VIEW falla y la
-- transacción completa se deshace sin dejar nada a medias.
--
-- Idempotente: todo es CREATE OR REPLACE.
-- ============================================================================

SET client_encoding = 'UTF8';

BEGIN;

-- 1. Stock entregable ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_stock_disponible(p_insumo_id integer) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
    SELECT COALESCE(SUM(cantidad_disponible), 0)::integer
    FROM public.detalle_inventario_lote
    WHERE insumo_id = p_insumo_id
      AND activo = true
      AND (fecha_caducidad IS NULL OR fecha_caducidad >= CURRENT_DATE);
$$;

COMMENT ON FUNCTION public.fn_stock_disponible(p_insumo_id integer) IS 'Stock entregable de un insumo: suma de sus lotes activos que no han vencido (caducidad NULL o >= hoy). Fuente unica de verdad para validaciones de stock. Migracion 35: antes contaba tambien los vencidos.';

-- 2. Cola FEFO sin vencidos -------------------------------------------------

CREATE OR REPLACE VIEW public.v_inventario_lote_fifo AS
 SELECT dl.id AS detalle_inventario_lote_id,
    dl.insumo_id,
    dl.recepcion_lote_id,
    rl.codigo_lote,
    dl.fecha_caducidad,
    rl.fecha_recepcion,
    dl.cantidad_inicial,
    dl.cantidad_disponible,
    dl.activo,
    COALESCE((dl.fecha_caducidad)::timestamp without time zone, (rl.fecha_recepcion + '100 years'::interval)) AS orden_fifo
   FROM (public.detalle_inventario_lote dl
     JOIN public.recepcion_donacion_lote rl ON ((rl.id = dl.recepcion_lote_id)))
  WHERE ((dl.fecha_caducidad IS NULL) OR (dl.fecha_caducidad >= CURRENT_DATE));

COMMENT ON VIEW public.v_inventario_lote_fifo IS 'RF-ENT. Detalle de inventario por producto, con codigo_lote y fecha_recepcion resueltos via JOIN al lote padre (3FN), y columna orden_fifo lista para ORDER BY en el despacho de entregas. Desde la migracion 35 excluye los lotes vencidos: no se despachan.';

-- 3. Ningún despacho sale de un lote vencido --------------------------------

CREATE OR REPLACE FUNCTION public.fn_descontar_inventario() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_disponible integer;
    v_caducidad  date;
BEGIN
    SELECT cantidad_disponible, fecha_caducidad INTO v_disponible, v_caducidad
    FROM public.detalle_inventario_lote
    WHERE id = NEW.detalle_inventario_lote_id
      AND activo = true
    FOR UPDATE;

    IF v_disponible IS NULL THEN
        RAISE EXCEPTION 'El detalle de lote % no existe o está inactivo.', NEW.detalle_inventario_lote_id;
    END IF;

    IF v_caducidad IS NOT NULL AND v_caducidad < CURRENT_DATE THEN
        RAISE EXCEPTION 'El lote % venció el %: no se puede entregar. Dele de baja desde Inventario.',
            NEW.detalle_inventario_lote_id, to_char(v_caducidad, 'DD/MM/YYYY');
    END IF;

    IF v_disponible < NEW.cantidad_entregada THEN
        RAISE EXCEPTION 'Stock insuficiente en detalle de lote %. Disponible: %, Solicitado: %.',
            NEW.detalle_inventario_lote_id, v_disponible, NEW.cantidad_entregada;
    END IF;

    UPDATE public.detalle_inventario_lote
    SET cantidad_disponible = cantidad_disponible - NEW.cantidad_entregada
    WHERE id = NEW.detalle_inventario_lote_id;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_descontar_inventario() IS 'RF-ENT. Descuenta stock del lote al registrar un detalle_entrega. Usa FOR UPDATE para evitar condiciones de carrera entre entregas concurrentes del mismo lote. Desde la migracion 35 rechaza los lotes vencidos.';

-- 4. Inventario: entregable y vencido por separado --------------------------

CREATE OR REPLACE VIEW public.v_stock_insumo AS
 SELECT i.id AS insumo_id,
    i.nombre AS insumo_nombre,
    ci.nombre AS categoria_nombre,
    i.requiere_fecha_caducidad,
    i.requiere_codigo_fabricante,
    i.bloquea_solicitud_sin_stock,
    um.nombre AS unidad_base_nombre,
    (COALESCE(sum(dl.cantidad_disponible) FILTER (WHERE ((dl.activo = true) AND ((dl.fecha_caducidad IS NULL) OR (dl.fecha_caducidad >= CURRENT_DATE)))), (0)::bigint))::integer AS stock_total,
    min(dl.fecha_caducidad) FILTER (WHERE ((dl.activo = true) AND (dl.cantidad_disponible > 0))) AS proxima_caducidad,
    public.fn_semaforo_caducidad(min(dl.fecha_caducidad) FILTER (WHERE ((dl.activo = true) AND (dl.cantidad_disponible > 0)))) AS semaforo,
    (COALESCE(sum(dl.cantidad_disponible) FILTER (WHERE ((dl.activo = true) AND (dl.fecha_caducidad < CURRENT_DATE))), (0)::bigint))::integer AS stock_vencido
   FROM (((public.insumo i
     JOIN public.categoria_insumo ci ON ((ci.id = i.categoria_id)))
     JOIN public.unidad_medida um ON ((um.id = i.unidad_medida_base_id)))
     LEFT JOIN public.detalle_inventario_lote dl ON ((dl.insumo_id = i.id)))
  WHERE (i.activo = true)
  GROUP BY i.id, i.nombre, ci.nombre, i.requiere_fecha_caducidad, i.requiere_codigo_fabricante, i.bloquea_solicitud_sin_stock, um.nombre;

COMMENT ON VIEW public.v_stock_insumo IS 'RF-INV. Stock entregable por insumo (lotes activos no vencidos, en unidad base), unidades vencidas pendientes de baja (stock_vencido), semaforo del detalle mas proximo a vencer -incluidos los vencidos, que son la alerta- y reglas de negocio propias del insumo. Migracion 35: stock_total ya no cuenta los vencidos.';

-- 5. Reporte de stock, con el mismo criterio --------------------------------

CREATE OR REPLACE VIEW public.v_reporte_stock_por_categoria AS
 SELECT ci.id AS categoria_id,
    ci.nombre AS categoria_nombre,
    count(DISTINCT i.id) AS cantidad_tipos_insumo,
    (COALESCE(sum(dl.cantidad_disponible) FILTER (WHERE ((dl.activo = true) AND ((dl.fecha_caducidad IS NULL) OR (dl.fecha_caducidad >= CURRENT_DATE)))), (0)::bigint))::integer AS unidades_totales_disponibles,
    count(DISTINCT dl.id) FILTER (WHERE ((dl.activo = true) AND (dl.cantidad_disponible > 0) AND ((public.fn_semaforo_caducidad(dl.fecha_caducidad))::text = ANY (ARRAY[('ROJO'::character varying)::text, ('VENCIDO'::character varying)::text])))) AS lotes_urgentes_o_vencidos
   FROM ((public.categoria_insumo ci
     LEFT JOIN public.insumo i ON (((i.categoria_id = ci.id) AND (i.activo = true))))
     LEFT JOIN public.detalle_inventario_lote dl ON ((dl.insumo_id = i.id)))
  WHERE (ci.activo = true)
  GROUP BY ci.id, ci.nombre
  ORDER BY ci.nombre;

COMMENT ON VIEW public.v_reporte_stock_por_categoria IS 'Grupo E / RF-REP. Cantidad de tipos de insumo y unidades disponibles (no vencidas, desde la migracion 35) por categoria, mas conteo de lotes en estado urgente o vencido.';

-- 6. Lista de espera: también lo asignado que se quedó sin existencias ------

CREATE OR REPLACE VIEW public.v_lista_espera AS
 SELECT dsa.id AS detalle_solicitud_id,
    dsa.solicitud_id,
    p.id AS persona_id,
    (((p.nombres)::text || ' '::text) || (p.apellidos)::text) AS persona_nombre_completo,
    i.nombre AS insumo_nombre,
    dsa.cantidad_requerida,
    dsa.cantidad_entregada,
    esa.nombre AS estado,
    dsa.created_at AS fecha_ingreso_espera,
    (CURRENT_DATE - (dsa.created_at)::date) AS dias_esperando,
    (((esa.nombre)::text = 'PENDIENTE_ENTREGA'::text) AND (public.fn_stock_disponible(dsa.insumo_id) = 0)) AS sin_existencias
   FROM ((((public.detalle_solicitud_apoyo dsa
     JOIN public.solicitud_apoyo sa ON ((sa.id = dsa.solicitud_id)))
     JOIN public.persona p ON ((p.id = sa.persona_id)))
     JOIN public.insumo i ON ((i.id = dsa.insumo_id)))
     JOIN public.estado_solicitud_apoyo esa ON ((esa.id = dsa.estado_id)))
  WHERE ((dsa.activo = true) AND (((esa.nombre)::text = ANY (ARRAY[('PENDIENTE_ADQUISICION'::character varying)::text, ('PENDIENTE_ENTREGA_PARCIAL'::character varying)::text])) OR (((esa.nombre)::text = 'PENDIENTE_ENTREGA'::text) AND (public.fn_stock_disponible(dsa.insumo_id) = 0))))
  ORDER BY dsa.created_at;

COMMENT ON VIEW public.v_lista_espera IS 'RF-INV. Lista de espera legible por LINEA de solicitud, ordenada FIFO por fecha de creacion de la linea: PENDIENTE_ADQUISICION, PENDIENTE_ENTREGA_PARCIAL y, desde la migracion 35, PENDIENTE_ENTREGA cuyo insumo no tiene hoy existencias entregables (sin_existencias = true).';

COMMIT;
