-- ============================================================================
-- 36_reportes_programa_edad_y_unidad.sql
--
-- PROBLEMA (hallazgos de QA del 13/10/2026)
--
--   DEF-07. v_reporte_personas_atendidas y v_reporte_poblacion_beneficiada
--     tomaban el programa solo de la solicitud. Desde la migración 34 la
--     entrega guarda su propio programa (entrega.programa_id), pero las vistas
--     no lo leían: una entrega directa registrada con programa salía «sin
--     programa», no entraba en el filtro por programa ni en la gráfica de
--     Inicio «Personas beneficiadas por programa».
--
--   DEF-12. v_reporte_poblacion_beneficiada calculaba el grupo etario con
--     fn_es_adulto_mayor / fn_es_menor, que usan la edad de HOY. Una persona
--     que tenía 64 años en marzo y cumplió 65 en mayo aparecía como adulta
--     mayor en el corte de marzo, y los reportes de meses pasados cambiaban
--     solos con el tiempo.
--
--   DEF-11. v_reporte_stock_por_categoria sumaba en «unidades disponibles» las
--     existencias de todos los insumos de la categoría, aunque se midan en
--     unidades distintas: 10 Litro + 5 Unidad = 15, sin decir 15 qué.
--
-- CORRECCION
--
--   1. Programa: el de la entrega y, si no tiene, el de la solicitud que
--      despacha (COALESCE). Un despacho ya hereda el programa de su solicitud
--      desde la 34, así que para ellos no cambia nada; las entregas directas
--      con programa pasan a contar.
--   2. Grupo etario con fn_edad_en_fecha(fecha_nacimiento, fecha_entrega):
--      mismos umbrales (menor de 18, 65 o más), la misma edad que ya mostraba
--      v_reporte_personas_atendidas en edad_a_la_entrega.
--   3. Stock: una fila por categoría Y unidad base del insumo, con la columna
--      unidad_nombre agregada al final. Nunca se suman unidades distintas.
--      Una categoría con insumos en dos unidades ocupa dos filas; una sin
--      insumos sigue apareciendo una vez, con unidad NULL.
--
-- LIMITES
--
--   - Las entregas directas anteriores a la migración 34 no tienen programa y
--     siguen saliendo sin él: no hay de dónde sacarlo.
--   - En población beneficiada, una persona que cumple 18 o 65 entre dos
--     entregas del mismo mes aparece en los dos grupos de ese mes. Es correcto
--     (cada entrega la recibió con una edad distinta) pero hay que tenerlo en
--     cuenta si alguien suma personas únicas entre filas.
--
-- Mismas columnas en las tres vistas (la de stock agrega una al final), así
-- que CREATE OR REPLACE conserva dueño y permisos y no requiere prisma:pull:
-- Prisma no modela estas vistas. Si la base de destino tuviera otra versión de
-- alguna vista, CREATE OR REPLACE VIEW falla y la transacción se deshace
-- completa.
--
-- Requisitos: migraciones hasta la 35 aplicadas (la 35 cambió la vista de
-- stock y esta parte de esa versión). Correr como el dueño de la base.
--
-- Idempotente: todo es CREATE OR REPLACE.
-- ============================================================================

SET client_encoding = 'UTF8';

BEGIN;

-- 1. Personas atendidas: programa de la entrega ----------------------------

CREATE OR REPLACE VIEW public.v_reporte_personas_atendidas AS
 SELECT e.id AS entrega_id,
    de.id AS detalle_entrega_id,
    e.fecha_entrega,
    p.id AS persona_id,
    (((p.nombres)::text || ' '::text) || (p.apellidos)::text) AS persona_nombre_completo,
    public.fn_edad_en_fecha(p.fecha_nacimiento, e.fecha_entrega) AS edad_a_la_entrega,
    tg.nombre AS genero,
    c.nombre AS comunidad_nombre,
    m.nombre AS municipio_nombre,
    depto.nombre AS departamento_nombre,
    pr.nombre AS programa_nombre,
    i.nombre AS insumo_nombre,
    de.cantidad_entregada,
    um.nombre AS unidad_despacho,
    ( SELECT string_agg((disc.nombre)::text, ', '::text ORDER BY (disc.nombre)::text) AS string_agg
           FROM (public.persona_discapacidad pd
             JOIN public.discapacidad disc ON ((disc.id = pd.discapacidad_id)))
          WHERE ((pd.persona_id = p.id) AND (pd.activo = true))) AS discapacidades,
    u.username AS usuario_entrega
   FROM ((((((((((((public.entrega e
     JOIN public.persona p ON ((p.id = e.persona_id)))
     JOIN public.detalle_entrega de ON (((de.entrega_id = e.id) AND (de.activo = true))))
     JOIN public.insumo i ON ((i.id = de.insumo_id)))
     JOIN public.unidad_medida um ON ((um.id = i.unidad_medida_base_id)))
     JOIN public.usuario u ON ((u.id = e.usuario_entrega_id)))
     LEFT JOIN public.tipo_genero tg ON ((tg.id = p.genero_id)))
     LEFT JOIN public.comunidad c ON ((c.id = p.comunidad_id)))
     LEFT JOIN public.municipio m ON ((m.id = c.municipio_id)))
     LEFT JOIN public.departamento depto ON ((depto.id = m.departamento_id)))
     LEFT JOIN public.detalle_solicitud_apoyo dsa ON ((dsa.id = de.detalle_solicitud_id)))
     LEFT JOIN public.solicitud_apoyo sa ON ((sa.id = dsa.solicitud_id)))
     LEFT JOIN public.programa pr ON ((pr.id = COALESCE(e.programa_id, sa.programa_id))))
  WHERE (e.activo = true);

COMMENT ON VIEW public.v_reporte_personas_atendidas IS 'Grupo E / RF-REP. Un renglon por insumo entregado (entregas y renglones activos), con la edad a la fecha de la entrega. Desde la migracion 36 el programa es el de la entrega y, si no tiene, el de la solicitud que despacha.';

-- 2. Población beneficiada: programa de la entrega y edad a la entrega -----

CREATE OR REPLACE VIEW public.v_reporte_poblacion_beneficiada AS
 SELECT depto.nombre AS departamento_nombre,
    m.nombre AS municipio_nombre,
    c.nombre AS comunidad_nombre,
    pr.nombre AS programa_nombre,
    tg.nombre AS genero,
        CASE
            WHEN (public.fn_edad_en_fecha(p.fecha_nacimiento, e.fecha_entrega) >= 65) THEN 'ADULTO_MAYOR'::text
            WHEN (public.fn_edad_en_fecha(p.fecha_nacimiento, e.fecha_entrega) < 18) THEN 'MENOR'::text
            ELSE 'ADULTO'::text
        END AS grupo_etario,
    (EXISTS ( SELECT 1
           FROM public.persona_discapacidad pd
          WHERE ((pd.persona_id = p.id) AND (pd.activo = true)))) AS tiene_discapacidad,
    count(DISTINCT p.id) AS personas_unicas_beneficiadas,
    count(DISTINCT e.id) AS total_entregas,
    (date_trunc('month'::text, (e.fecha_entrega)::timestamp with time zone))::date AS mes
   FROM (((((((((public.entrega e
     JOIN public.persona p ON ((p.id = e.persona_id)))
     LEFT JOIN public.detalle_entrega de ON (((de.entrega_id = e.id) AND (de.activo = true))))
     LEFT JOIN public.tipo_genero tg ON ((tg.id = p.genero_id)))
     LEFT JOIN public.comunidad c ON ((c.id = p.comunidad_id)))
     LEFT JOIN public.municipio m ON ((m.id = c.municipio_id)))
     LEFT JOIN public.departamento depto ON ((depto.id = m.departamento_id)))
     LEFT JOIN public.detalle_solicitud_apoyo dsa ON ((dsa.id = de.detalle_solicitud_id)))
     LEFT JOIN public.solicitud_apoyo sa ON ((sa.id = dsa.solicitud_id)))
     LEFT JOIN public.programa pr ON ((pr.id = COALESCE(e.programa_id, sa.programa_id))))
  WHERE (e.activo = true)
  GROUP BY depto.nombre, m.nombre, c.nombre, pr.nombre, tg.nombre,
        CASE
            WHEN (public.fn_edad_en_fecha(p.fecha_nacimiento, e.fecha_entrega) >= 65) THEN 'ADULTO_MAYOR'::text
            WHEN (public.fn_edad_en_fecha(p.fecha_nacimiento, e.fecha_entrega) < 18) THEN 'MENOR'::text
            ELSE 'ADULTO'::text
        END, (EXISTS ( SELECT 1
           FROM public.persona_discapacidad pd
          WHERE ((pd.persona_id = p.id) AND (pd.activo = true)))), (date_trunc('month'::text, (e.fecha_entrega)::timestamp with time zone));

COMMENT ON VIEW public.v_reporte_poblacion_beneficiada IS 'Grupo E / RF-REP. Poblacion beneficiada agregada por ubicacion, programa, genero, grupo etario y discapacidad, con corte mensual. Desde la migracion 36: el programa es el de la entrega (o el de su solicitud) y el grupo etario usa la edad a la fecha de la entrega, no la de hoy.';

-- 3. Stock por categoría y unidad -------------------------------------------

CREATE OR REPLACE VIEW public.v_reporte_stock_por_categoria AS
 SELECT ci.id AS categoria_id,
    ci.nombre AS categoria_nombre,
    count(DISTINCT i.id) AS cantidad_tipos_insumo,
    (COALESCE(sum(dl.cantidad_disponible) FILTER (WHERE ((dl.activo = true) AND ((dl.fecha_caducidad IS NULL) OR (dl.fecha_caducidad >= CURRENT_DATE)))), (0)::bigint))::integer AS unidades_totales_disponibles,
    count(DISTINCT dl.id) FILTER (WHERE ((dl.activo = true) AND (dl.cantidad_disponible > 0) AND ((public.fn_semaforo_caducidad(dl.fecha_caducidad))::text = ANY (ARRAY[('ROJO'::character varying)::text, ('VENCIDO'::character varying)::text])))) AS lotes_urgentes_o_vencidos,
    um.nombre AS unidad_nombre
   FROM (((public.categoria_insumo ci
     LEFT JOIN public.insumo i ON (((i.categoria_id = ci.id) AND (i.activo = true))))
     LEFT JOIN public.unidad_medida um ON ((um.id = i.unidad_medida_base_id)))
     LEFT JOIN public.detalle_inventario_lote dl ON ((dl.insumo_id = i.id)))
  WHERE (ci.activo = true)
  GROUP BY ci.id, ci.nombre, um.nombre
  ORDER BY ci.nombre, um.nombre;

COMMENT ON VIEW public.v_reporte_stock_por_categoria IS 'Grupo E / RF-REP. Por categoria y unidad base: tipos de insumo, unidades disponibles (no vencidas) y lotes en estado urgente o vencido. Desde la migracion 36 una fila por categoria y unidad, para no sumar unidades de medida distintas.';

COMMIT;
