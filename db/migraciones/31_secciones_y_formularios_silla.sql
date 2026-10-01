-- ============================================================================
-- 31_secciones_y_formularios_silla.sql
--
-- PROBLEMA (revisión de los formularios contra el papel, con la DMM)
--
-- 1. El «Formulario de aptitud para silla de ruedas» no es un formulario
--    aparte: en papel es la HOJA 2 de la «Solicitud de silla de ruedas». En el
--    sistema eran dos formularios, así que se llenaban, se completaban y se
--    exigían por separado (el equipo médico pedía 3 formularios en vez de 2).
--
-- 2. Un formulario era una lista corrida de campos, sin títulos. El papel está
--    dividido en secciones (Información general, Estado físico, Escaras…; en
--    el estudio socioeconómico, I a IV) y, al unir las dos hojas, no se vería
--    dónde termina la primera y empieza la segunda.
--
-- 3. Detalles de redacción y de datos:
--    - «Cuál es su experiencia con el uso de una silla de ruedas» le habla a
--      la persona, no a quien llena el formulario, a diferencia del resto.
--    - El papel tiene un recuadro «Notas» que el sistema no tenía.
--    - En el estudio socioeconómico, los ingresos no decían que son quetzales
--      y en «Ingresos» no se registraba el parentesco de quien aporta.
--    - Las opciones de «Parentesco (familiar)» estaban en minúscula y sin
--      tildes («conyuge», «tio(a)»).
--    - El orden no seguía el papel: los egresos salían antes que los ingresos.
--
-- CORRECCION
--
-- Estructura:
--   - formulario_campo.seccion: título de la sección a la que pertenece el
--     campo. El formulario muestra el título cada vez que la sección cambia,
--     siguiendo el orden de los campos. NULL = sin título (como hasta ahora).
--
-- Datos (por NOMBRE de formulario y etiqueta de campo, no por id: los id
-- cambian entre desarrollo y producción). Si un formulario no existe, su
-- parte no hace nada:
--   - Los campos de aptitud pasan a la Solicitud de silla de ruedas, como su
--     sección «Hoja 2». Las respuestas ya guardadas se mueven al formulario
--     unido, que queda completo solo si los dos lo estaban. Los documentos
--     adjuntos que correspondían a aptitud pasan al formulario unido. El
--     formulario de aptitud y su exigencia por categoría se DESACTIVAN (no se
--     borran: la auditoría y el historial siguen apuntando a ellos).
--   - Se agregan «Notas» (solicitud) y «Parentesco con la persona»
--     (ingresos), se corrigen etiquetas y opciones, y se actualizan las
--     respuestas que usaban las opciones viejas.
--   - Se fija el orden y las secciones de los dos formularios según el papel.
--     Un campo que no esté en la lista conserva su orden relativo, al final.
--
-- Idempotente: se puede correr dos veces. La unión solo ocurre mientras el
-- formulario de aptitud siga activo; las etiquetas, opciones, orden y
-- secciones se fijan a su valor final.
-- ============================================================================

-- El script trae tildes en etiquetas y secciones. psql en Windows lee el
-- archivo en la codificación de la consola (WIN1252) cuando la salida no va a
-- una terminal, y guardaba «InformaciÃ³n»: se fija aquí para no depender de
-- cómo se invoque.
SET client_encoding = 'UTF8';

BEGIN;

-- ── 1. Estructura ──────────────────────────────────────────────────────────

ALTER TABLE public.formulario_campo
    ADD COLUMN IF NOT EXISTS seccion character varying(200);

COMMENT ON COLUMN public.formulario_campo.seccion IS
    'Título de la sección del formulario a la que pertenece el campo. El formulario muestra el título cuando cambia respecto del campo anterior (por orden). NULL: sin título.';

-- ── 2. Datos ───────────────────────────────────────────────────────────────

DO $migracion$
DECLARE
    v_sol        integer;  -- Solicitud de silla de ruedas
    v_apt        integer;  -- Formulario de aptitud para silla de ruedas
    v_soc        integer;  -- Estudio socioeconómico
    v_dsf        RECORD;
    v_destino    integer;
    v_texto_largo  integer;
    v_seleccion    integer;
    v_campo      integer;
BEGIN
    SELECT id INTO v_sol FROM public.formulario WHERE nombre = 'Solicitud de silla de ruedas';
    SELECT id INTO v_apt FROM public.formulario WHERE nombre = 'Formulario de aptitud para silla de ruedas' AND activo = true;
    SELECT id INTO v_soc FROM public.formulario WHERE nombre = 'Estudio socioeconómico';
    SELECT id INTO v_texto_largo FROM public.tipo_dato_campo_formulario WHERE nombre = 'TEXTO_LARGO';
    SELECT id INTO v_seleccion   FROM public.tipo_dato_campo_formulario WHERE nombre = 'SELECCION_UNICA';

    -- ── 2.1 Unir aptitud dentro de la solicitud de silla ────────────────────
    IF v_sol IS NOT NULL AND v_apt IS NOT NULL THEN
        FOR v_dsf IN
            SELECT id, detalle_solicitud_id, completado
            FROM public.detalle_solicitud_formulario
            WHERE formulario_id = v_apt AND activo = true
        LOOP
            SELECT id INTO v_destino
            FROM public.detalle_solicitud_formulario
            WHERE detalle_solicitud_id = v_dsf.detalle_solicitud_id AND formulario_id = v_sol;

            IF v_destino IS NULL THEN
                -- La hoja 1 nunca se empezó: el formulario unido queda incompleto
                INSERT INTO public.detalle_solicitud_formulario
                    (detalle_solicitud_id, formulario_id, completado)
                VALUES (v_dsf.detalle_solicitud_id, v_sol, false)
                RETURNING id INTO v_destino;
            ELSE
                -- Completo solo si las dos hojas lo estaban
                UPDATE public.detalle_solicitud_formulario
                SET completado = completado AND v_dsf.completado,
                    activo = true
                WHERE id = v_destino;
            END IF;

            UPDATE public.detalle_solicitud_formulario_respuesta
            SET detalle_solicitud_formulario_id = v_destino
            WHERE detalle_solicitud_formulario_id = v_dsf.id;

            UPDATE public.detalle_solicitud_formulario
            SET activo = false
            WHERE id = v_dsf.id;
        END LOOP;

        -- Los campos pasan a la solicitud, después de los suyos (el orden
        -- definitivo se fija en 2.3). orden es único por formulario.
        UPDATE public.formulario_campo
        SET formulario_id = v_sol,
            orden = orden + 20000
        WHERE formulario_id = v_apt;

        UPDATE public.documento_solicitud
        SET formulario_id = v_sol
        WHERE formulario_id = v_apt;

        UPDATE public.categoria_insumo_formulario
        SET activo = false
        WHERE formulario_id = v_apt;

        UPDATE public.formulario
        SET activo = false,
            descripcion = 'Unido a «Solicitud de silla de ruedas» como su hoja 2 (migración 31).'
        WHERE id = v_apt;
    END IF;

    -- ── 2.2 Solicitud de silla de ruedas: redacción y «Notas» ───────────────
    IF v_sol IS NOT NULL THEN
        UPDATE public.formulario
        SET descripcion = 'Hoja 1: datos, estado físico y escaras. Hoja 2: aptitud (medidas y talla de la silla). Free Wheelchair Mission.'
        WHERE id = v_sol;

        UPDATE public.formulario_campo SET etiqueta = 'Experiencia de la persona con el uso de una silla de ruedas'
        WHERE formulario_id = v_sol AND etiqueta = 'Cuál es su experiencia con el uso de una silla de ruedas';

        UPDATE public.formulario_campo SET etiqueta = 'Dónde usará la persona la silla de ruedas'
        WHERE formulario_id = v_sol AND etiqueta = 'Dónde usará o a dónde irá con la silla de ruedas';

        IF NOT EXISTS (SELECT 1 FROM public.formulario_campo WHERE formulario_id = v_sol AND etiqueta = 'Notas') THEN
            INSERT INTO public.formulario_campo
                (formulario_id, etiqueta, tipo_dato_id, obligatorio, orden, ayuda)
            VALUES (v_sol, 'Notas', v_texto_largo, false,
                    (SELECT COALESCE(MAX(orden), 0) + 1 FROM public.formulario_campo WHERE formulario_id = v_sol),
                    'Lo que se observó al evaluar y no cabe en las preguntas anteriores.');
        END IF;
    END IF;

    -- ── 2.3 Estudio socioeconómico: quetzales, parentesco y opciones ────────
    IF v_soc IS NOT NULL THEN
        UPDATE public.formulario_campo SET etiqueta = 'Ingreso mensual (Q) (familiar)'
        WHERE formulario_id = v_soc AND etiqueta = 'Ingresos (familiar)';

        -- Opciones de «Parentesco (familiar)» con mayúscula y tildes. Las
        -- respuestas guardan el texto de la opción: se actualizan también.
        SELECT id INTO v_campo FROM public.formulario_campo
        WHERE formulario_id = v_soc AND etiqueta = 'Parentesco (familiar)';
        IF v_campo IS NOT NULL THEN
            UPDATE public.formulario_campo_opcion o
            SET etiqueta = c.nueva
            FROM (VALUES ('madre', 'Madre'), ('padre', 'Padre'), ('hijo(a)', 'Hijo(a)'),
                         ('hermano(a)', 'Hermano(a)'), ('abuelo(a)', 'Abuelo(a)'),
                         ('tio(a)', 'Tío(a)'), ('conyuge', 'Cónyuge'), ('otro', 'Otro')) AS c(vieja, nueva)
            WHERE o.formulario_campo_id = v_campo AND o.etiqueta = c.vieja;

            UPDATE public.detalle_solicitud_formulario_respuesta r
            SET valor_texto = c.nueva
            FROM (VALUES ('madre', 'Madre'), ('padre', 'Padre'), ('hijo(a)', 'Hijo(a)'),
                         ('hermano(a)', 'Hermano(a)'), ('abuelo(a)', 'Abuelo(a)'),
                         ('tio(a)', 'Tío(a)'), ('conyuge', 'Cónyuge'), ('otro', 'Otro')) AS c(vieja, nueva)
            WHERE r.formulario_campo_id = v_campo AND r.valor_texto = c.vieja;
        END IF;

        -- Parentesco de quien aporta, en el grupo «ingresos»
        IF NOT EXISTS (SELECT 1 FROM public.formulario_campo WHERE formulario_id = v_soc AND etiqueta = 'Parentesco con la persona') THEN
            INSERT INTO public.formulario_campo
                (formulario_id, etiqueta, tipo_dato_id, obligatorio, orden, grupo_repetible, ayuda)
            VALUES (v_soc, 'Parentesco con la persona', v_seleccion, false,
                    (SELECT COALESCE(MAX(orden), 0) + 1 FROM public.formulario_campo WHERE formulario_id = v_soc),
                    'ingresos',
                    'Qué es de la persona beneficiaria quien aporta. Si aporta ella misma, «La persona beneficiaria».')
            RETURNING id INTO v_campo;

            INSERT INTO public.formulario_campo_opcion (formulario_campo_id, etiqueta, orden)
            SELECT v_campo, etiqueta, orden
            FROM (VALUES ('La persona beneficiaria', 1), ('Madre', 2), ('Padre', 3), ('Hijo(a)', 4),
                         ('Hermano(a)', 5), ('Abuelo(a)', 6), ('Tío(a)', 7), ('Cónyuge', 8),
                         ('Otro', 9)) AS o(etiqueta, orden);
        END IF;
    END IF;
END
$migracion$;

-- ── 3. Orden y secciones según el papel ────────────────────────────────────
-- Se recorre la lista de cada formulario: posición = orden, y su sección.
-- Primero se corre todo lo existente fuera de rango (orden es único por
-- formulario) y al final se renumera lo que no estaba en la lista.

CREATE OR REPLACE FUNCTION pg_temp.ordenar_formulario(p_nombre text, p_campos text[][])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_formulario integer;
    v_i          integer;
    v_total      integer := array_length(p_campos, 1);
BEGIN
    SELECT id INTO v_formulario FROM public.formulario WHERE nombre = p_nombre;
    IF v_formulario IS NULL THEN
        RETURN;
    END IF;

    UPDATE public.formulario_campo SET orden = orden + 100000
    WHERE formulario_id = v_formulario;

    FOR v_i IN 1 .. v_total LOOP
        UPDATE public.formulario_campo
        SET orden = v_i, seccion = p_campos[v_i][2]
        WHERE formulario_id = v_formulario AND etiqueta = p_campos[v_i][1];
    END LOOP;

    -- Lo que no estaba en la lista (campos agregados después desde la
    -- pantalla) queda al final, en su orden relativo y sin sección propia
    UPDATE public.formulario_campo fc
    SET orden = v_total + r.n
    FROM (
        SELECT id, row_number() OVER (ORDER BY orden) AS n
        FROM public.formulario_campo
        WHERE formulario_id = v_formulario AND orden > 100000
    ) r
    WHERE fc.id = r.id;
END;
$$;

SELECT pg_temp.ordenar_formulario('Solicitud de silla de ruedas', ARRAY[
    ['Nombre del cuidador (si corresponde)',                                 'Información general'],
    ['Diagnóstico',                                                          'Estado físico y consideraciones'],
    ['Por qué esta persona necesita una silla de ruedas',                    'Estado físico y consideraciones'],
    ['¿Actualmente tiene una silla de ruedas?',                              'Estado físico y consideraciones'],
    ['Dónde usará la persona la silla de ruedas',                            'Estado físico y consideraciones'],
    ['Experiencia de la persona con el uso de una silla de ruedas',          'Estado físico y consideraciones'],
    ['¿La persona puede mantener la cabeza?',                                'Estado físico y consideraciones'],
    ['¿La persona puede sentarse de manera segura?',                         'Estado físico y consideraciones'],
    ['Esta persona puede sentarse en una silla de ruedas y salir de esta',   'Estado físico y consideraciones'],
    ['Notas',                                                                'Estado físico y consideraciones'],
    ['¿La persona tiene una escara por presión?',                            'Escaras por presión / piel'],
    ['Si la respuesta anterior es sí, describa',                             'Escaras por presión / piel'],
    ['¿La persona tiene antecedentes de escaras por presión?',               'Escaras por presión / piel'],
    ['Referencia',                                                           'Recomendación'],
    ['Ancho de la cadera (cm)',                                              'Hoja 2 · Formulario de aptitud para silla de ruedas'],
    ['Talla de silla resultante',                                            'Hoja 2 · Formulario de aptitud para silla de ruedas'],
    ['Largo de la pierna (cm)',                                              'Hoja 2 · Formulario de aptitud para silla de ruedas'],
    ['Posición del reposapiés',                                              'Hoja 2 · Formulario de aptitud para silla de ruedas'],
    ['Altura de la espalda (cm)',                                            'Hoja 2 · Formulario de aptitud para silla de ruedas'],
    ['Posición del respaldo',                                                'Hoja 2 · Formulario de aptitud para silla de ruedas']
]);

SELECT pg_temp.ordenar_formulario('Estudio socioeconómico', ARRAY[
    ['Registro médico',                                    'I. Datos generales'],
    ['Registro social',                                    'I. Datos generales'],
    ['Fecha de aplicación',                                'I. Datos generales'],
    ['Ocupación del responsable',                          'I. Datos generales'],
    ['Lugar y dirección de trabajo del responsable',       'I. Datos generales'],
    ['Nombre completo (familiar)',                         'I. Datos generales'],
    ['Edad/fecha nacimiento (familiar)',                   'I. Datos generales'],
    ['Parentesco (familiar)',                              'I. Datos generales'],
    ['Grado académico (familiar)',                         'I. Datos generales'],
    ['Ocupación (familiar)',                               'I. Datos generales'],
    ['Ingreso mensual (Q) (familiar)',                     'I. Datos generales'],
    ['Problema social referido',                           'I. Datos generales'],
    ['Diagnóstico médico',                                 'I. Datos generales'],
    ['Antecedentes de salud del paciente y la familia',    'I. Datos generales'],
    ['Quién aporta',                                       'II. Ingresos y egresos de la familia'],
    ['Parentesco con la persona',                          'II. Ingresos y egresos de la familia'],
    ['Ingreso mensual (Q)',                                'II. Ingresos y egresos de la familia'],
    ['Tipo de gasto',                                      'II. Ingresos y egresos de la familia'],
    ['Monto (Q)',                                          'II. Ingresos y egresos de la familia'],
    ['Tenencia de la vivienda',                            'III. Vivienda'],
    ['Tipo de vivienda',                                   'III. Vivienda'],
    ['Ambientes de la vivienda',                           'III. Vivienda'],
    ['Número de dormitorios',                              'III. Vivienda'],
    ['Material de las paredes',                            'III. Vivienda'],
    ['Material del techo',                                 'III. Vivienda'],
    ['Material del piso',                                  'III. Vivienda'],
    ['Mobiliario',                                         'III. Vivienda'],
    ['Servicios',                                          'III. Vivienda'],
    ['Diagnóstico social',                                 'IV. Referencia de trabajo social'],
    ['Tratamiento social efectuado',                       'IV. Referencia de trabajo social'],
    ['Observaciones',                                      'IV. Referencia de trabajo social']
]);

-- La sección ya lo dice: la ayuda «Sección IV: …» sobraba
UPDATE public.formulario_campo SET ayuda = NULL
WHERE etiqueta = 'Diagnóstico social' AND ayuda = 'Sección IV: referencia de trabajo social.';

COMMIT;
