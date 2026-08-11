-- ============================================================================
-- 12_rol_aplicacion_minimo_privilegio.sql
--
-- PROBLEMA
-- El backend se conecta a Postgres como superusuario. Eso significa que quien
-- obtenga el DATABASE_URL (un .env filtrado, un backup del VPS, un commit por
-- accidente) puede hacer cosas que el sistema por diseño NUNCA hace:
--
--   - Borrar filas fisicamente. Verificado: no existe un solo DELETE en toda
--     la base ni en todo el backend; cada "eliminar" es UPDATE activo = false.
--   - Desactivar o borrar los triggers de auditoria y operar sin dejar rastro.
--   - Escribir directamente en auditoria_log: inventar entradas o borrarlas.
--   - Alterar o eliminar tablas.
--
-- Nada de eso es necesario para que la aplicacion funcione. Esta migracion
-- crea un rol de conexion sin esos privilegios.
--
-- QUE **NO** HACE ESTA MIGRACION
-- No mapea los 4 roles de negocio (EMPLEADO_DMM, DIRECTORA, ALCALDE,
-- ADMINISTRADOR) a roles de Postgres. Esa autorizacion vive en el backend
-- (requireRole) y debe vivir en un solo lugar: duplicarla aqui crearia dos
-- fuentes de verdad que se desincronizan, que es exactamente el problema que
-- produjo el acceso indebido de ALCALDE.
--
-- Esto es defensa en profundidad sobre el motor, no autorizacion de negocio.
--
-- OJO: cambia el usuario del DATABASE_URL. Ver el paso 8 al final.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Rol de conexion de la aplicacion
--    NOLOGIN heredado: se le da LOGIN abajo. NOSUPERUSER, NOCREATEDB,
--    NOCREATEROLE y NOINHERIT son los defaults, se dejan explicitos para
--    que la intencion quede escrita.
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dmm_app') THEN
        CREATE ROLE dmm_app LOGIN
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
            PASSWORD 'CAMBIAR_ESTA_CLAVE';
        RAISE NOTICE 'Rol dmm_app creado. CAMBIE LA CLAVE antes de usarlo.';
    ELSE
        RAISE NOTICE 'Rol dmm_app ya existia; no se toca su clave.';
    END IF;
END
$$;

-- ---------------------------------------------------------------------
-- 2. Nadie por defecto. PUBLIC es todo rol existente y futuro.
-- ---------------------------------------------------------------------
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL PROCEDURES IN SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE "DMM" TO dmm_app;
GRANT USAGE ON SCHEMA public TO dmm_app;

-- ---------------------------------------------------------------------
-- 3. Datos de negocio: leer, insertar y actualizar. SIN DELETE.
--
--    Como el sistema usa borrado logico en todas partes, revocar DELETE no
--    rompe nada y convierte un borrado accidental o inyectado en un error de
--    privilegios en vez de una perdida de datos. Es la restriccion con mejor
--    relacion beneficio/costo de todo el script.
--
--    Tampoco se otorga TRUNCATE ni REFERENCES.
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO dmm_app;

-- Las columnas serial necesitan avanzar sus secuencias.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dmm_app;

-- Funciones auxiliares y los 7 stored procedures de negocio.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO dmm_app;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA public TO dmm_app;

-- ---------------------------------------------------------------------
-- 4. auditoria_log en SOLO LECTURA para la aplicacion.
--
--    GET /api/auditoria solo lee, y los triggers son los unicos que deben
--    escribir. Sin esto, cualquiera con la cadena de conexion puede fabricar
--    entradas falsas o borrar las que le incriminen — y una bitacora que el
--    propio sistema puede reescribir no prueba nada.
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.auditoria_log FROM dmm_app;
GRANT  SELECT ON public.auditoria_log TO dmm_app;

-- La secuencia del id de auditoria la usa la funcion, que corre como el
-- propietario (paso 5), no la aplicacion.
REVOKE ALL ON SEQUENCE public.auditoria_log_id_seq FROM dmm_app;

-- ---------------------------------------------------------------------
-- 5. fn_auditoria pasa a SECURITY DEFINER.
--
--    Un trigger corre con los privilegios de quien dispara la sentencia. Si
--    dmm_app no puede escribir en auditoria_log (paso 4), el trigger tampoco
--    podria y TODA escritura del sistema fallaria. SECURITY DEFINER hace que
--    la funcion corra con los privilegios de su propietario.
--
--    Resultado: auditoria_log solo se puede escribir a traves del trigger.
--    Ni la aplicacion ni nadie con el DATABASE_URL puede forjar ni borrar
--    entradas.
--
--    El `SET search_path` es OBLIGATORIO en toda funcion SECURITY DEFINER:
--    sin el, quien pueda crear objetos en un esquema que preceda a public en
--    el search_path del invocador podria secuestrar la resolucion de nombres
--    y ejecutar codigo con los privilegios del propietario. pg_temp va al
--    final por el mismo motivo.
--
--    El cuerpo es identico al vigente (el del fix de clave compuesta): lo
--    unico que cambia son los atributos de la funcion.
-- ---------------------------------------------------------------------
ALTER FUNCTION public.fn_auditoria()
    SECURITY DEFINER
    SET search_path = public, pg_temp;

-- Que nadie mas pueda invocarla directamente; los triggers no pasan por aqui.
REVOKE ALL ON FUNCTION public.fn_auditoria() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_auditoria() FROM dmm_app;

-- ---------------------------------------------------------------------
-- 6. sesion: sin DELETE.
--    Coherente con la decision de diseno de que las filas de sesion nunca se
--    eliminan, porque son evidencia de acceso. Ya cubierto por el paso 3
--    (que no otorga DELETE a ninguna tabla); se deja explicito por su valor
--    para auditoria y seguridad.
-- ---------------------------------------------------------------------
REVOKE DELETE, TRUNCATE ON public.sesion FROM dmm_app;

-- ---------------------------------------------------------------------
-- 7. Objetos futuros.
--    Sin esto, la proxima tabla que se cree quedaria inaccesible para dmm_app
--    y alguien lo "arreglaria" devolviendole privilegios de mas.
--    OJO: los DEFAULT PRIVILEGES aplican al rol que CREA el objeto. Ejecute
--    esto como el mismo rol con el que vaya a correr las migraciones futuras.
-- ---------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE ON TABLES TO dmm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO dmm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO dmm_app;

COMMIT;

-- ============================================================================
-- 8. DESPUES DE APLICAR
--
--   a) Cambiar la clave:
--        ALTER ROLE dmm_app PASSWORD 'una-clave-larga-y-aleatoria';
--
--   b) Apuntar el backend al rol nuevo, en el .env:
--        DATABASE_URL="postgresql://dmm_app:CLAVE@localhost:5432/DMM"
--
--   c) `prisma db pull` y las migraciones futuras se siguen corriendo con el
--      usuario PROPIETARIO, no con dmm_app: la introspeccion y el DDL
--      necesitan privilegios que dmm_app no tiene, y esa es la idea. Conviene
--      una segunda variable, p.ej. DATABASE_URL_OWNER, solo para eso.
--
--   d) Verificaciones (conectado como dmm_app):
--        -- debe FALLAR con "permiso denegado"
--        DELETE FROM public.persona WHERE id = -1;
--        INSERT INTO public.auditoria_log (tabla_afectada, registro_id, tipo_accion_id)
--            VALUES ('x', 1, 1);
--        DROP TABLE public.sesion;
--        ALTER TABLE public.persona DISABLE TRIGGER ALL;
--
--        -- debe FUNCIONAR
--        SELECT count(*) FROM public.auditoria_log;
--        INSERT INTO public.discapacidad (nombre) VALUES ('ZZ prueba permisos');
--        UPDATE public.discapacidad SET activo = false WHERE nombre = 'ZZ prueba permisos';
--        -- y esa escritura debe haber dejado su fila en auditoria_log
--
--   e) Correr la suite de pruebas con dmm_app, no con el propietario: cualquier
--      GRANT que falte debe aparecer como test roto y no como error en
--      produccion.
-- ============================================================================
