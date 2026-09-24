-- ============================================================================
-- 29_tipos_documento_legibles.sql
--
-- PROBLEMA
--
-- La pantalla de documentos del beneficiario muestra `tipo_documento_persona.
-- nombre` tal cual. Convivían dos estilos: "DPI anverso" y "DPI reverso"
-- (agregados a mano el 3 de septiembre de 2026, cuando se borró el tipo "DPI"
-- para subir cada cara por separado) junto a "PARTIDA_NACIMIENTO",
-- "DPI_ENCARGADO" y "OTRO", que el personal veía en mayúsculas y con guion
-- bajo.
--
-- Además el DPI del encargado seguía siendo un solo tipo, aunque es la misma
-- tarjeta de dos caras que el del beneficiario.
--
-- CORRECCION
--
--   PARTIDA_NACIMIENTO  ->  Partida de nacimiento
--   OTRO                ->  Otro
--   DPI_ENCARGADO       ->  DPI del encargado anverso
--   (nuevo)                 DPI del encargado reverso
--
-- Ningún código busca estos tipos por nombre (se eligen de la lista que
-- devuelve GET /api/tipos-documento-persona), así que renombrarlos no rompe
-- nada. Se renombra en vez de crear y desactivar para conservar el id y los
-- documentos ya subidos.
--
-- LIMITES
--
-- Los documentos que ya estuvieran subidos como DPI_ENCARGADO quedan como
-- "DPI del encargado anverso": el tipo anterior no decía qué cara era. Si
-- alguno es en realidad el reverso, corríjalo a mano:
--
--     SELECT d.id, d.persona_id, d.ruta_archivo
--     FROM public.documento_persona d
--     JOIN public.tipo_documento_persona t ON t.id = d.tipo_documento_id
--     WHERE t.nombre = 'DPI del encargado anverso';
--
-- Si el nombre nuevo ya existiera (por ejemplo, sembrado por los tests), los
-- documentos se pasan a ese tipo y el viejo se desactiva en vez de renombrarse.
--
-- Idempotente: se puede correr más de una vez.
-- ============================================================================

BEGIN;

-- Si el nombre nuevo ya existe (por ejemplo, porque las semillas de los tests
-- lo crearon antes de aplicar esta migración), no se puede renombrar sin
-- chocar con el UNIQUE: los documentos pasan al tipo nuevo y el viejo se
-- desactiva, para que no aparezca dos veces en la lista.
DO $renombrar$
DECLARE
    par      text[];
    id_viejo integer;
    id_nuevo integer;
BEGIN
    FOREACH par SLICE 1 IN ARRAY ARRAY[
        ARRAY['PARTIDA_NACIMIENTO', 'Partida de nacimiento'],
        ARRAY['OTRO',               'Otro'],
        ARRAY['DPI_ENCARGADO',      'DPI del encargado anverso']
    ] LOOP
        SELECT id INTO id_viejo FROM public.tipo_documento_persona WHERE nombre = par[1];
        CONTINUE WHEN id_viejo IS NULL;

        SELECT id INTO id_nuevo FROM public.tipo_documento_persona WHERE nombre = par[2];
        IF id_nuevo IS NULL THEN
            UPDATE public.tipo_documento_persona SET nombre = par[2] WHERE id = id_viejo;
        ELSE
            UPDATE public.documento_persona
            SET tipo_documento_id = id_nuevo
            WHERE tipo_documento_id = id_viejo;
            UPDATE public.tipo_documento_persona SET activo = false WHERE id = id_viejo;
        END IF;
    END LOOP;
END
$renombrar$;

INSERT INTO public.tipo_documento_persona (nombre)
SELECT 'DPI del encargado reverso'
WHERE NOT EXISTS (
    SELECT 1 FROM public.tipo_documento_persona
    WHERE nombre = 'DPI del encargado reverso'
);

COMMIT;
