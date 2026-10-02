-- ============================================================================
-- 34_programa_en_entrega.sql
--
-- PROBLEMA
--
-- Una solicitud lleva su programa (solicitud_apoyo.programa_id), pero una
-- entrega no. Las entregas que despachan una solicitud podrian heredarlo de
-- ella, pero las entregas directas no tienen solicitud, asi que no habia donde
-- registrar a que programa se cargo lo entregado. La pantalla de entregas no
-- podia mostrarlo y los reportes por programa dejaban fuera las directas.
--
-- CORRECCION
--
--   - entrega.programa_id (nullable, FK a programa).
--   - fn_crear_entrega recibe p_programa_id como sexto parametro, opcional:
--     las llamadas de cinco argumentos (sp_registrar_entrega, el prestamo
--     directo) siguen funcionando y dejan la entrega sin programa.
--   - Indice por programa para el filtro del listado.
--
-- La regla de negocio (una entrega directa exige programa; un despacho toma el
-- de su solicitud) vive en el backend, igual que la validacion de que el
-- programa exista y este activo. No se impone NOT NULL aqui porque las
-- entregas directas anteriores a esta migracion no tienen programa y no hay
-- forma de saberlo.
--
-- Datos: las entregas que despachan una solicitud toman el programa de esa
-- solicitud. Las directas anteriores quedan en NULL (la pantalla las muestra
-- con un guion).
--
-- Limites: el prestamo directo crea su entrega con cinco argumentos, asi que
-- queda sin programa. No es una entrega directa de la pantalla de entregas
-- sino otro flujo, con su propio modal.
--
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE y el UPDATE solo toca filas
-- con programa_id NULL.
-- ============================================================================

SET client_encoding = 'UTF8';

BEGIN;

ALTER TABLE public.entrega
    ADD COLUMN IF NOT EXISTS programa_id integer;

DO $fk$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_entrega_programa'
    ) THEN
        ALTER TABLE public.entrega
            ADD CONSTRAINT fk_entrega_programa
            FOREIGN KEY (programa_id) REFERENCES public.programa(id)
            ON DELETE RESTRICT;
    END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS idx_entrega_programa
    ON public.entrega (programa_id) WHERE programa_id IS NOT NULL;

COMMENT ON COLUMN public.entrega.programa_id IS
    'Programa al que se carga la entrega. Un despacho hereda el de su solicitud; una entrega directa lo elige quien la registra. NULL en las directas anteriores a la migracion 34 y en los prestamos directos.';

-- La firma cambia (sexto parametro): con DROP + CREATE no queda una sobrecarga
-- de cinco argumentos que haga ambiguas las llamadas que los omiten.
DROP FUNCTION IF EXISTS public.fn_crear_entrega(integer, integer, text, integer, integer);

CREATE OR REPLACE FUNCTION public.fn_crear_entrega(
    p_persona_id integer,
    p_usuario_entrega_id integer,
    p_observaciones text DEFAULT NULL::text,
    p_persona_receptor_id integer DEFAULT NULL::integer,
    p_tipo_parentesco_receptor_id integer DEFAULT NULL::integer,
    p_programa_id integer DEFAULT NULL::integer
)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_entrega_id integer;
BEGIN
    IF p_persona_receptor_id IS NOT NULL AND p_tipo_parentesco_receptor_id IS NULL THEN
        RAISE EXCEPTION 'Si la entrega la recibe un tercero, debe indicar el parentesco con el beneficiario.';
    END IF;

    INSERT INTO public.entrega (
        persona_id, persona_receptor_id, tipo_parentesco_receptor_id,
        fecha_entrega, usuario_entrega_id, observaciones, programa_id
    ) VALUES (
        p_persona_id, p_persona_receptor_id, p_tipo_parentesco_receptor_id,
        CURRENT_DATE, p_usuario_entrega_id, p_observaciones, p_programa_id
    ) RETURNING id INTO v_entrega_id;

    RETURN v_entrega_id;
END;
$function$;

COMMENT ON FUNCTION public.fn_crear_entrega(integer, integer, text, integer, integer, integer) IS 'RF-ENT. Crea la cabecera de una entrega, sin insumos. Los renglones se agregan después con sp_agregar_insumo_entrega, uno por insumo. El programa es opcional: lo fija el backend (el de la solicitud en un despacho; el elegido en una entrega directa).';

REVOKE ALL ON FUNCTION public.fn_crear_entrega(integer, integer, text, integer, integer, integer) FROM PUBLIC;
DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dmm_app') THEN
        GRANT EXECUTE ON FUNCTION public.fn_crear_entrega(integer, integer, text, integer, integer, integer) TO dmm_app;
    END IF;
END
$grant$;

-- Despachos anteriores: toman el programa de su solicitud. Un MIN alcanza
-- porque la regla de origen unico hace que todos los renglones compartan
-- solicitud.
UPDATE public.entrega e
SET programa_id = origen.programa_id
FROM (
    SELECT de.entrega_id, MIN(sa.programa_id) AS programa_id
    FROM public.detalle_entrega de
    JOIN public.detalle_solicitud_apoyo dsa ON dsa.id = de.detalle_solicitud_id
    JOIN public.solicitud_apoyo sa ON sa.id = dsa.solicitud_id
    GROUP BY de.entrega_id
) origen
WHERE e.id = origen.entrega_id
  AND e.programa_id IS NULL;

COMMIT;
