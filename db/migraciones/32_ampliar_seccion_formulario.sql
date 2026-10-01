-- ============================================================================
-- 32_ampliar_seccion_formulario.sql
--
-- PROBLEMA
--
-- La 31 creó formulario_campo.seccion como varchar(100). Alcanza para las
-- secciones actuales (la más larga, «Hoja 2 · Formulario de aptitud para
-- silla de ruedas», tiene 52 caracteres), pero queda por debajo de la
-- etiqueta del campo (200) y del nombre del formulario (150), y el título de
-- una sección se copia del papel tal como viene.
--
-- CORRECCION
--
-- Se amplía a varchar(200), igual que la etiqueta. Va en una migración aparte
-- y no editando la 31 porque esa ya se aplicó: ADD COLUMN IF NOT EXISTS no
-- toca una columna que ya existe, así que cambiarla allí no tendría efecto en
-- las bases donde corrió.
--
-- Ampliar un varchar no reescribe la tabla ni toca los datos. Idempotente:
-- volver a fijar el mismo tipo no hace nada.
-- ============================================================================

BEGIN;

ALTER TABLE public.formulario_campo
    ALTER COLUMN seccion TYPE character varying(200);

COMMIT;
