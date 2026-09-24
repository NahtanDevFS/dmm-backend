-- ============================================================================
-- 28_formato_cui_dpi.sql
--
-- PROBLEMA (hallazgo QA-12 del informe de QA)
--
-- `persona.cui_dpi` es varchar(13) sin ninguna otra regla. La API solo
-- recortaba espacios y limitaba el largo, así que aceptaba "abc", "1" o "" que
-- el formulario del frontend rechaza.
--
-- El vacío era el caso más dañino:
--   - UNIQUE (cui_dpi) trata "" como un valor más: la segunda persona
--     registrada con "" chocaba con la primera (409) aunque ninguna tuviera DPI.
--   - El trigger de menores busca `cui_dpi IS NULL` para exigir un encargado:
--     un "" lo esquivaba.
--
-- CORRECCION
--
-- La API ya valida (persona.schema.ts: 13 dígitos o nada, y "" se guarda como
-- NULL). Esta migración pone la misma regla en la base, para que ningún otro
-- camino (pgAdmin, un script, una función) pueda volver a meter un DPI mal
-- formado. NULL sigue permitido: el DPI es opcional.
--
-- LIMITES
--
-- Antes de agregar el CHECK se convierten a NULL los DPI vacíos o de puros
-- espacios. Si queda algún otro valor que no sean 13 dígitos, el ALTER falla
-- y NO se aplica nada (todo va en una transacción): corrija esos registros a
-- mano con la consulta de abajo y vuelva a correr la migración.
--
--     SELECT id, nombres, apellidos, cui_dpi
--     FROM public.persona
--     WHERE cui_dpi IS NOT NULL AND cui_dpi !~ '^[0-9]{13}$';
--
-- Convertir "" en NULL puede disparar el trigger de menores si un menor tenía
-- "" y ningún encargado: la migración se detiene con ese mensaje, que es
-- justamente el caso que el trigger debió atrapar desde el principio.
--
-- Idempotente: se puede correr más de una vez.
-- ============================================================================

BEGIN;

UPDATE public.persona
SET cui_dpi = NULL
WHERE cui_dpi IS NOT NULL AND btrim(cui_dpi) = '';

DO $dpi$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'persona_cui_dpi_formato_check'
          AND conrelid = 'public.persona'::regclass
    ) THEN
        ALTER TABLE public.persona
            ADD CONSTRAINT persona_cui_dpi_formato_check
            CHECK (cui_dpi ~ '^[0-9]{13}$');
    END IF;
END
$dpi$;

COMMIT;
