-- ============================================================================
-- SISTEMA DMM USUMATLAN — ESQUEMA COMPLETO (v4)
--
-- Reconstruye la base de datos desde cero, igual a la vigente: tablas,
-- funciones, procedimientos, vistas, triggers, permisos de dmm_app, catalogos
-- y las migraciones hasta la 28.
--
-- POR QUE EXISTE (hallazgo QA-15 del informe de QA)
--
-- El v3 dejo de reflejar la base real: despues de la migracion 13 se aplicaron
-- a mano las 14 a 27, que nunca se versionaron (17 tablas nuevas -formularios,
-- catalogos, detalle_entrega_lote, evidencias de contrato...-, la entrega
-- reestructurada con fn_crear_entrega y sp_agregar_insumo_entrega, el estado
-- NO_DEVUELTO, motivo_cierre, y permisos mas finos para dmm_app). Una base
-- creada con el v3 no puede registrar una entrega. Ademas el v3 sembraba el
-- tipo de multa RETRASO_DEVOLUCION, pero el codigo busca ATRASO: la multa
-- automatica por atraso nunca se aplicaba en un entorno nuevo.
--
-- El v3 se conserva como historico. Para montar un entorno, use ESTE archivo.
--
-- ----------------------------------------------------------------------------
-- ANTES DE EJECUTAR
--
--  1. Cree la base CONECTADO COMO EL USUARIO DUEÑO (normalmente `postgres`),
--     nunca como `dmm_app`. El que crea un objeto es su dueño, y un dueño
--     puede hacer DROP y ALTER sin importar los REVOKE: montar la base con
--     `dmm_app` anularia el modelo de permisos.
--
--         CREATE DATABASE dmm_usumatlan_db;
--
--     El nombre es libre: el script usa current_database() donde lo necesita.
--
--  2. Ejecutelo conectado a esa base, como el dueño:
--
--         psql -U postgres -d dmm_usumatlan_db -f scripts_bd_v4.sql
--
--     o pegado en el Query Tool de pgAdmin.
--
-- ----------------------------------------------------------------------------
-- DESPUES DE EJECUTAR
--
--  1. RECONECTE (reinicie el backend, cierre y reabra pgAdmin): la zona
--     horaria America/Guatemala solo aplica a sesiones nuevas.
--
--  2. Si el rol dmm_app se creo ahora, CAMBIE SU CLAVE:
--
--         ALTER ROLE dmm_app PASSWORD 'una-clave-larga-y-aleatoria';
--
--     y use en el .env:
--
--         DATABASE_URL="postgresql://dmm_app:CLAVE@localhost:5432/NOMBRE_BASE"
--         DATABASE_URL_OWNER="postgresql://postgres:CLAVE@localhost:5432/NOMBRE_BASE"
--
--  3. Cree el PRIMER ADMINISTRADOR. El script no trae ningun usuario: el v3
--     traia el hash de la contraseña de una cuenta real dentro del
--     repositorio. Reemplace usuario, nombre y clave (minimo 8 caracteres, con
--     una letra y un numero) y ejecute como el dueño:
--
--         INSERT INTO public.usuario
--             (username, password_hash, rol_id, nombre_completo, activo)
--         SELECT 'admin', public.crypt('CLAVE-INICIAL1', public.gen_salt('bf', 12)),
--                id, 'Administrador del sistema', true
--         FROM public.rol WHERE nombre = 'ADMINISTRADOR';
--
--     crypt() genera un hash bcrypt compatible con el backend. Entre y cambie
--     la clave desde "Cambiar contraseña" de inmediato: la inicial queda en el
--     historial de comandos de psql/pgAdmin.
--
-- ----------------------------------------------------------------------------
-- PARA LA BASE DE PRUEBAS (dmm_test)
--
-- Mismos pasos, misma propiedad, y el nombre debe contener "test": los tests
-- del backend se niegan a vaciar cualquier otra base. Una base de pruebas con
-- mas privilegios que produccion produce pruebas que mienten.
--
-- ----------------------------------------------------------------------------
-- MIGRACIONES INCORPORADAS
--
--   09 a 13                  (ver README-MIGRACIONES.md)
--   14 a 27 (sin versionar) entrega por lotes, formularios, catalogos,
--                            NO_DEVUELTO, permisos finos de dmm_app
--   28_formato_cui_dpi       CUI/DPI de 13 digitos o NULL
--
-- No hace falta aplicarlas por separado sobre una base creada con este script.
-- ============================================================================

-- ============================================================================
-- 1. ROL DE APLICACION
--
-- Va antes de la estructura porque los GRANT del final lo mencionan. Si ya
-- existe (otra base del mismo servidor) no se toca: ni su clave ni sus
-- atributos.
-- ============================================================================
DO $rol$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dmm_app') THEN
        CREATE ROLE dmm_app LOGIN
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
            PASSWORD 'dmm2026';
        RAISE NOTICE 'Rol dmm_app creado. CAMBIE LA CLAVE antes de usarlo.';
    ELSE
        RAISE NOTICE 'Rol dmm_app ya existia; no se toca su clave.';
    END IF;
END
$rol$;

-- ============================================================================
-- 2. ESTRUCTURA Y PERMISOS
--
-- Generado con pg_dump --schema-only --no-owner a partir de la base vigente
-- (dmm_test, identica en esquema y permisos a la de desarrollo). Incluye
-- extensiones, tablas, constraints, indices, funciones, procedimientos,
-- triggers, vistas y los GRANT de dmm_app tal como estan hoy: catalogos de
-- sistema y vistas en solo lectura, auditoria_log inalterable y fn_auditoria
-- como SECURITY DEFINER.
--
-- No editar a mano: si el esquema cambia, se escribe una migracion nueva y se
-- regenera este archivo (ver README-MIGRACIONES.md).
-- ============================================================================
--
-- PostgreSQL database dump
--


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: fn_actualizar_linea_al_anular_renglon(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_actualizar_linea_al_anular_renglon() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.activo IS DISTINCT FROM NEW.activo
       AND NEW.detalle_solicitud_id IS NOT NULL THEN
        PERFORM public.fn_recalcular_linea_solicitud(NEW.detalle_solicitud_id);
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: fn_actualizar_linea_desde_entrega(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_actualizar_linea_desde_entrega() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.detalle_solicitud_id IS NOT NULL THEN
        PERFORM public.fn_recalcular_linea_solicitud(NEW.detalle_solicitud_id);
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_actualizar_linea_desde_entrega(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_actualizar_linea_desde_entrega() IS 'RF-ENT. Recalcula la línea de solicitud (y en cascada la cabecera) cuando se inserta un renglón asociado a ella. Desde la migración 19 la línea la conoce el propio renglón.';


--
-- Name: fn_auditoria(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_auditoria() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
    v_usuario_id       integer;
    v_tipo_accion_id   integer;
    v_valores_antiguos jsonb;
    v_valores_nuevos   jsonb;
    v_registro_id      integer;
BEGIN
    BEGIN
        v_usuario_id := current_setting('app.usuario_id')::integer;
    EXCEPTION WHEN OTHERS THEN
        v_usuario_id := NULL;
    END;

    SELECT id INTO v_tipo_accion_id
    FROM public.tipo_accion_auditoria
    WHERE nombre = TG_OP;

    IF TG_OP = 'INSERT' THEN
        v_valores_antiguos := NULL;
        v_valores_nuevos   := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_valores_antiguos := to_jsonb(OLD);
        v_valores_nuevos   := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        v_valores_antiguos := to_jsonb(OLD);
        v_valores_nuevos   := NULL;
    END IF;

    -- Tablas con clave primaria compuesta (sin columna "id"): se
    -- extrae un identificador representativo del JSON ya calculado.
    -- Cualquier tabla nueva que se agregue en el futuro con clave
    -- compuesta debe sumarse aqui explicitamente, o volvera a
    -- fallar con el mismo error que este fix corrige.
    IF TG_TABLE_NAME = 'encargado_menor' THEN
        v_registro_id := COALESCE(
            (v_valores_nuevos->>'menor_id')::integer,
            (v_valores_antiguos->>'menor_id')::integer
        );
    ELSIF TG_TABLE_NAME = 'persona_discapacidad' THEN
        v_registro_id := COALESCE(
            (v_valores_nuevos->>'persona_id')::integer,
            (v_valores_antiguos->>'persona_id')::integer
        );
    ELSE
        v_registro_id := COALESCE(NEW.id, OLD.id);
    END IF;

    INSERT INTO public.auditoria_log (
        tabla_afectada, registro_id, tipo_accion_id, usuario_id,
        valores_antiguos, valores_nuevos
    ) VALUES (
        TG_TABLE_NAME, v_registro_id, v_tipo_accion_id, v_usuario_id,
        v_valores_antiguos, v_valores_nuevos
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: FUNCTION fn_auditoria(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_auditoria() IS 'Trigger AFTER I/U/D generico: registra el cambio en auditoria_log. Lee app.usuario_id inyectado por el backend via SET LOCAL. Para tablas con clave primaria compuesta (encargado_menor, persona_discapacidad) usa un campo representativo en vez de "id" (ver migracion 08_fix_fn_auditoria_clave_compuesta.sql).';


--
-- Name: fn_calcular_cantidad_entregada(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_calcular_cantidad_entregada() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_insumo_lote               integer;
    v_unidad_medida_lote         integer;
    v_insumo_presentacion        integer;
    v_unidad_medida_despacho     integer;
    v_es_default_despacho        boolean;
    v_unidades_por_presentacion  numeric(12,4);
BEGIN
    SELECT dl.insumo_id, dl.unidades_por_presentacion_lote, pi_recepcion.unidad_medida_id
    INTO v_insumo_lote, v_unidades_por_presentacion, v_unidad_medida_lote
    FROM public.detalle_inventario_lote dl
    JOIN public.presentacion_insumo pi_recepcion ON pi_recepcion.id = dl.presentacion_recepcion_id
    WHERE dl.id = NEW.detalle_inventario_lote_id;

    SELECT insumo_id, unidad_medida_id, es_default
    INTO v_insumo_presentacion, v_unidad_medida_despacho, v_es_default_despacho
    FROM public.presentacion_insumo
    WHERE id = NEW.presentacion_despacho_id;

    IF v_insumo_presentacion IS DISTINCT FROM v_insumo_lote THEN
        RAISE EXCEPTION
            'La presentación de despacho (%) no corresponde al insumo del lote (%).',
            NEW.presentacion_despacho_id, v_insumo_lote;
    END IF;

    IF v_es_default_despacho THEN
        NEW.cantidad_entregada := FLOOR(NEW.cantidad_despacho_original)::integer;
    ELSE
        IF v_unidad_medida_despacho IS DISTINCT FROM v_unidad_medida_lote THEN
            RAISE EXCEPTION
                'La unidad de despacho no coincide con la unidad en que se recibió el lote %; seleccione la unidad base o la misma presentación con la que se recibió este lote específico.',
                NEW.detalle_inventario_lote_id;
        END IF;

        NEW.cantidad_entregada := FLOOR(NEW.cantidad_despacho_original * v_unidades_por_presentacion)::integer;
    END IF;

    IF NEW.cantidad_entregada IS NULL OR NEW.cantidad_entregada <= 0 THEN
        RAISE EXCEPTION 'La cantidad a entregar resultante es inválida (revise presentación y cantidad).';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_calcular_cantidad_entregada(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_calcular_cantidad_entregada() IS 'Grupo A. Calcula cantidad_entregada (unidad base). Si el despacho es en la presentacion default, la conversion es directa (factor 1). Si es en una presentacion no default, usa unidades_por_presentacion_lote del LOTE DE ORIGEN especifico, porque el mismo insumo puede tener lotes con contenido de presentacion distinto.';


--
-- Name: fn_calcular_edad(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_calcular_edad(p_fecha_nacimiento date) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
    SELECT DATE_PART('year', AGE(CURRENT_DATE, p_fecha_nacimiento))::integer;
$$;


--
-- Name: FUNCTION fn_calcular_edad(p_fecha_nacimiento date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_calcular_edad(p_fecha_nacimiento date) IS 'Edad en anios completos a la fecha actual. Usar fn_edad_en_fecha para calculos historicos (reportes).';


--
-- Name: fn_calcular_recepcion_lote(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_calcular_recepcion_lote() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_insumo_presentacion       integer;
    v_requiere_fecha_caducidad   boolean;
    v_requiere_codigo_fabricante boolean;
BEGIN
    SELECT insumo_id INTO v_insumo_presentacion
    FROM public.presentacion_insumo
    WHERE id = NEW.presentacion_recepcion_id;

    IF v_insumo_presentacion IS DISTINCT FROM NEW.insumo_id THEN
        RAISE EXCEPTION
            'La presentación de recepción (%) no corresponde al insumo declarado (%).',
            NEW.presentacion_recepcion_id, NEW.insumo_id;
    END IF;

    SELECT i.requiere_fecha_caducidad, i.requiere_codigo_fabricante
    INTO v_requiere_fecha_caducidad, v_requiere_codigo_fabricante
    FROM public.insumo i
    WHERE i.id = NEW.insumo_id;

    IF v_requiere_fecha_caducidad AND NEW.fecha_caducidad IS NULL THEN
        RAISE EXCEPTION
            'El insumo % exige fecha de caducidad.',
            NEW.insumo_id;
    END IF;

    IF v_requiere_codigo_fabricante AND (NEW.codigo_lote_fabricante IS NULL OR length(trim(NEW.codigo_lote_fabricante)) = 0) THEN
        RAISE EXCEPTION
            'El insumo % exige código de lote del fabricante.',
            NEW.insumo_id;
    END IF;

    NEW.cantidad_inicial := FLOOR(NEW.cantidad_recepcion_original * NEW.unidades_por_presentacion_lote)::integer;
    NEW.cantidad_disponible := NEW.cantidad_inicial;

    IF NEW.cantidad_inicial IS NULL OR NEW.cantidad_inicial <= 0 THEN
        RAISE EXCEPTION 'La cantidad recibida resultante es inválida (revise presentación, cantidad y factor de conversión del lote).';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_calcular_recepcion_lote(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_calcular_recepcion_lote() IS 'Grupo A/D. Calcula cantidad_inicial/cantidad_disponible usando unidades_por_presentacion_lote propio de este lote, valida coherencia insumo-presentacion, y exige fecha_caducidad/codigo_lote_fabricante segun la configuracion propia del insumo.';


--
-- Name: fn_crear_entrega(integer, integer, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_crear_entrega(p_persona_id integer, p_usuario_entrega_id integer, p_observaciones text DEFAULT NULL::text, p_persona_receptor_id integer DEFAULT NULL::integer, p_tipo_parentesco_receptor_id integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_entrega_id integer;
BEGIN
    IF p_persona_receptor_id IS NOT NULL AND p_tipo_parentesco_receptor_id IS NULL THEN
        RAISE EXCEPTION 'Si la entrega la recibe un tercero, debe indicar el parentesco con el beneficiario.';
    END IF;

    INSERT INTO public.entrega (
        persona_id, persona_receptor_id, tipo_parentesco_receptor_id,
        fecha_entrega, usuario_entrega_id, observaciones
    ) VALUES (
        p_persona_id, p_persona_receptor_id, p_tipo_parentesco_receptor_id,
        CURRENT_DATE, p_usuario_entrega_id, p_observaciones
    ) RETURNING id INTO v_entrega_id;

    RETURN v_entrega_id;
END;
$$;


--
-- Name: FUNCTION fn_crear_entrega(p_persona_id integer, p_usuario_entrega_id integer, p_observaciones text, p_persona_receptor_id integer, p_tipo_parentesco_receptor_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_crear_entrega(p_persona_id integer, p_usuario_entrega_id integer, p_observaciones text, p_persona_receptor_id integer, p_tipo_parentesco_receptor_id integer) IS 'RF-ENT. Crea la cabecera de una entrega, sin insumos. Los renglones se agregan después con sp_agregar_insumo_entrega, uno por insumo.';


--
-- Name: fn_descontar_inventario(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_descontar_inventario() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_disponible integer;
BEGIN
    SELECT cantidad_disponible INTO v_disponible
    FROM public.detalle_inventario_lote
    WHERE id = NEW.detalle_inventario_lote_id
      AND activo = true
    FOR UPDATE;

    IF v_disponible IS NULL THEN
        RAISE EXCEPTION 'El detalle de lote % no existe o está inactivo.', NEW.detalle_inventario_lote_id;
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


--
-- Name: FUNCTION fn_descontar_inventario(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_descontar_inventario() IS 'RF-ENT. Descuenta stock del lote al registrar un detalle_entrega. Usa FOR UPDATE para evitar condiciones de carrera entre entregas concurrentes del mismo lote.';


--
-- Name: fn_edad_en_fecha(date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_edad_en_fecha(p_fecha_nacimiento date, p_fecha_referencia date) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
    SELECT DATE_PART('year', AGE(p_fecha_referencia, p_fecha_nacimiento))::integer;
$$;


--
-- Name: FUNCTION fn_edad_en_fecha(p_fecha_nacimiento date, p_fecha_referencia date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_edad_en_fecha(p_fecha_nacimiento date, p_fecha_referencia date) IS 'Edad en anios completos que tenia una persona en una fecha de referencia dada. Uso: reportes historicos (RF-REP).';


--
-- Name: fn_es_adulto_mayor(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_es_adulto_mayor(p_fecha_nacimiento date) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    SELECT public.fn_calcular_edad(p_fecha_nacimiento) >= 65;
$$;


--
-- Name: FUNCTION fn_es_adulto_mayor(p_fecha_nacimiento date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_es_adulto_mayor(p_fecha_nacimiento date) IS 'true si la persona tiene 65 anios o mas a la fecha actual (definicion confirmada por el cliente, PREGUNTAS_DMM P26).';


--
-- Name: fn_es_menor(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_es_menor(p_fecha_nacimiento date) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    SELECT public.fn_calcular_edad(p_fecha_nacimiento) < 18;
$$;


--
-- Name: FUNCTION fn_es_menor(p_fecha_nacimiento date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_es_menor(p_fecha_nacimiento date) IS 'true si la persona es menor de 18 anios a la fecha actual.';


--
-- Name: fn_estado_inicial_linea_solicitud(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_estado_inicial_linea_solicitud() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_stock integer;
BEGIN
    v_stock := public.fn_stock_disponible(NEW.insumo_id);
    IF v_stock > 0 THEN
        NEW.estado_id := (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ENTREGA');
    ELSE
        NEW.estado_id := (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ADQUISICION');
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_estado_inicial_linea_solicitud(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_estado_inicial_linea_solicitud() IS 'RF-PRO/RF-INV. Fija el estado inicial de cada LINEA de la solicitud segun disponibilidad de stock de su insumo especifico.';


--
-- Name: fn_modalidad_inmutable(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_modalidad_inmutable() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.modalidad_solicitud_id IS DISTINCT FROM OLD.modalidad_solicitud_id THEN
        RAISE EXCEPTION
          'La modalidad de una línea no se puede cambiar una vez registrada. Si la figura cambia, registre una solicitud nueva.';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_modalidad_inmutable(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_modalidad_inmutable() IS 'RF-SOL. Impide cambiar donación por préstamo o al revés después de creada la línea: evita que queden formularios exigidos o exentos según un estado que ya no es el que se decidió.';


--
-- Name: fn_recalcular_cabecera_solicitud(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_recalcular_cabecera_solicitud(p_solicitud_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: FUNCTION fn_recalcular_cabecera_solicitud(p_solicitud_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_recalcular_cabecera_solicitud(p_solicitud_id integer) IS 'RF-PRO/RF-ENT. Deriva el estado de la cabecera agregando el de todas sus lineas: ENTREGADA cuando todas estan ENTREGADA/CANCELADA; PENDIENTE_ENTREGA_PARCIAL si hay avance; y PENDIENTE_ENTREGA/PENDIENTE_ADQUISICION cuando ninguna linea tiene avance (caso de anulacion). RECHAZADA no se deriva: es decision de direccion.';


--
-- Name: fn_recalcular_linea_solicitud(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_recalcular_linea_solicitud(p_detalle_solicitud_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
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
    WHERE de.detalle_solicitud_id = p_detalle_solicitud_id
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
        --      pendiente, o desaparece de la lista de espera.
        IF v_estado_actual IN ('ENTREGADA', 'PENDIENTE_ENTREGA_PARCIAL') THEN
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
$$;


--
-- Name: FUNCTION fn_recalcular_linea_solicitud(p_detalle_solicitud_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_recalcular_linea_solicitud(p_detalle_solicitud_id integer) IS 'RF-PRO/RF-ENT. Recalcula cantidad_entregada y estado de una LINEA a partir de sus entregas activas. Soporta la REGRESION: si se anulan las entregas, la linea vuelve a PENDIENTE_ENTREGA/PENDIENTE_ADQUISICION segun stock, en vez de quedarse en ENTREGADA con 0 unidades. Los estados terminales por decision humana (CANCELADA, RECHAZADA, APROBADA) no se alteran.';


--
-- Name: fn_restaurar_inventario(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_restaurar_inventario() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_lote        RECORD;
    v_lote_activo boolean;
    v_huerfanos   integer := 0;
BEGIN
    IF OLD.activo = true AND NEW.activo = false THEN
        FOR v_lote IN
            SELECT id, detalle_inventario_lote_id, cantidad_entregada
            FROM public.detalle_entrega_lote
            WHERE detalle_entrega_id = OLD.id
              AND activo = true
        LOOP
            SELECT activo INTO v_lote_activo
            FROM public.detalle_inventario_lote
            WHERE id = v_lote.detalle_inventario_lote_id
            FOR UPDATE;

            IF v_lote_activo IS TRUE THEN
                UPDATE public.detalle_inventario_lote
                SET cantidad_disponible = cantidad_disponible + v_lote.cantidad_entregada
                WHERE id = v_lote.detalle_inventario_lote_id;
            ELSE
                v_huerfanos := v_huerfanos + 1;
                RAISE WARNING
                    'Renglón %: el detalle de lote % está inactivo; % unidades NO se restauraron y requieren revisión manual.',
                    OLD.id, v_lote.detalle_inventario_lote_id, v_lote.cantidad_entregada;
            END IF;
        END LOOP;

        UPDATE public.detalle_entrega_lote
        SET activo = false
        WHERE detalle_entrega_id = OLD.id AND activo = true;

        IF v_huerfanos > 0 THEN
            NEW.motivo_anulacion := COALESCE(NEW.motivo_anulacion, '') ||
                format(' | ADVERTENCIA: %s lote(s) inactivo(s) no se restauraron, requiere revisión manual de inventario.', v_huerfanos);
        END IF;

        IF NEW.fecha_anulacion IS NULL THEN
            NEW.fecha_anulacion := CURRENT_TIMESTAMP;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_restaurar_inventario(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_restaurar_inventario() IS 'RF-ENT. Al anular un renglón de entrega devuelve el stock a sus lotes de origen y apaga sus filas de reparto. Si un lote está inactivo, no restaura y deja constancia en el motivo de anulación.';


--
-- Name: fn_semaforo_caducidad(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_semaforo_caducidad(p_fecha_caducidad date) RETURNS character varying
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    IF p_fecha_caducidad IS NULL THEN
        RETURN 'GRIS';  -- no perecedero / sin fecha de caducidad aplicable
    END IF;

    IF p_fecha_caducidad < CURRENT_DATE THEN
        RETURN 'VENCIDO';
    ELSIF p_fecha_caducidad < (CURRENT_DATE + INTERVAL '3 months')::date THEN
        RETURN 'ROJO';
    ELSIF p_fecha_caducidad < (CURRENT_DATE + INTERVAL '6 months')::date THEN
        RETURN 'AMARILLO';
    ELSE
        RETURN 'VERDE';
    END IF;
END;
$$;


--
-- Name: FUNCTION fn_semaforo_caducidad(p_fecha_caducidad date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_semaforo_caducidad(p_fecha_caducidad date) IS 'RF-INV-02. Semaforo de caducidad: GRIS (sin fecha) / VENCIDO / ROJO (<3 meses) / AMARILLO (3-6 meses) / VERDE (>6 meses).';


--
-- Name: fn_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_set_updated_at(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_set_updated_at() IS 'Trigger BEFORE UPDATE generico: fija updated_at = NOW() en cada UPDATE. Reutilizable en cualquier tabla con esa columna.';


--
-- Name: fn_stock_disponible(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_stock_disponible(p_insumo_id integer) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
    SELECT COALESCE(SUM(cantidad_disponible), 0)::integer
    FROM public.detalle_inventario_lote
    WHERE insumo_id = p_insumo_id
      AND activo = true;
$$;


--
-- Name: FUNCTION fn_stock_disponible(p_insumo_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_stock_disponible(p_insumo_id integer) IS 'Stock total disponible de un insumo, sumando todos sus lotes activos. Fuente unica de verdad para validaciones de stock.';


--
-- Name: fn_validar_catalogo_campo_formulario(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_catalogo_campo_formulario() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_tiene_opciones_propias boolean;
BEGIN
    IF NEW.catalogo_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.formulario_campo_opcion
            WHERE formulario_campo_id = NEW.id
        ) INTO v_tiene_opciones_propias;

        IF v_tiene_opciones_propias THEN
            RAISE EXCEPTION
                'El campo % ya tiene opciones propias en formulario_campo_opcion; no puede ademas apuntar a un catalogo reutilizable.',
                NEW.id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_validar_modalidad_categoria(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_modalidad_categoria() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_modalidad text;
    v_permite   boolean;
    v_categoria text;
BEGIN
    SELECT nombre INTO v_modalidad
    FROM public.modalidad_solicitud WHERE id = NEW.modalidad_solicitud_id;

    IF v_modalidad <> 'PRESTAMO' THEN
        RETURN NEW;
    END IF;

    SELECT ci.permite_prestamo, ci.nombre INTO v_permite, v_categoria
    FROM public.insumo i
    JOIN public.categoria_insumo ci ON ci.id = i.categoria_id
    WHERE i.id = NEW.insumo_id;

    IF NOT v_permite THEN
        RAISE EXCEPTION
          'Los insumos de la categoría % no se pueden entregar en préstamo: solo se presta lo que se devuelve. Use donación.',
          v_categoria;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_validar_modalidad_categoria(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_validar_modalidad_categoria() IS 'RF-SOL. Impide registrar en préstamo un insumo de una categoría que no lo admite. Va en la base y no solo en la pantalla porque la API acepta lo que se le mande.';


--
-- Name: fn_validar_opciones_campo_formulario(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_opciones_campo_formulario() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_catalogo_id integer;
BEGIN
    SELECT catalogo_id INTO v_catalogo_id
    FROM public.formulario_campo
    WHERE id = NEW.formulario_campo_id;

    IF v_catalogo_id IS NOT NULL THEN
        RAISE EXCEPTION
            'El campo % ya usa un catalogo reutilizable (catalogo_id = %); no puede tener ademas opciones propias.',
            NEW.formulario_campo_id, v_catalogo_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_validar_origen_unico_entrega(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_origen_unico_entrega() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_solicitud_nueva   integer;
    v_solicitud_previa  integer;
    v_hay_previos       boolean;
    v_previo_directo    boolean;
BEGIN
    IF NEW.detalle_solicitud_id IS NOT NULL THEN
        SELECT solicitud_id INTO v_solicitud_nueva
        FROM public.detalle_solicitud_apoyo WHERE id = NEW.detalle_solicitud_id;
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.detalle_entrega
                    WHERE entrega_id = NEW.entrega_id AND id <> NEW.id)
      INTO v_hay_previos;

    IF NOT v_hay_previos THEN
        RETURN NEW;
    END IF;

    SELECT bool_or(detalle_solicitud_id IS NULL) INTO v_previo_directo
    FROM public.detalle_entrega
    WHERE entrega_id = NEW.entrega_id AND id <> NEW.id;

    IF v_previo_directo AND NEW.detalle_solicitud_id IS NOT NULL THEN
        RAISE EXCEPTION
          'No se puede mezclar en una misma entrega insumos de una solicitud con insumos de entrega directa. Registre entregas separadas.';
    END IF;

    IF NOT v_previo_directo AND NEW.detalle_solicitud_id IS NULL THEN
        RAISE EXCEPTION
          'Esta entrega despacha una solicitud; no admite además insumos de entrega directa. Registre entregas separadas.';
    END IF;

    IF NEW.detalle_solicitud_id IS NOT NULL THEN
        SELECT DISTINCT dsa.solicitud_id INTO v_solicitud_previa
        FROM public.detalle_entrega de
        JOIN public.detalle_solicitud_apoyo dsa ON dsa.id = de.detalle_solicitud_id
        WHERE de.entrega_id = NEW.entrega_id AND de.id <> NEW.id
        LIMIT 1;

        IF v_solicitud_previa IS DISTINCT FROM v_solicitud_nueva THEN
            RAISE EXCEPTION
              'Una entrega no puede despachar líneas de dos solicitudes distintas (% y %).',
              v_solicitud_previa, v_solicitud_nueva;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_validar_origen_unico_entrega(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_validar_origen_unico_entrega() IS 'RF-ENT. Una entrega es toda directa o toda de una misma solicitud. El motivo es la evidencia: receta médica para medicina, contrato firmado para equipo; mezclarlas dejaría documentos que cubren solo parte de la entrega.';


--
-- Name: fn_validar_presentacion_linea_solicitud(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_presentacion_linea_solicitud() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_insumo_presentacion integer;
BEGIN
    IF NEW.presentacion_solicitud_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT insumo_id INTO v_insumo_presentacion
    FROM public.presentacion_insumo
    WHERE id = NEW.presentacion_solicitud_id AND activo = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La presentación % no existe o está inactiva.',
            NEW.presentacion_solicitud_id;
    END IF;

    IF v_insumo_presentacion <> NEW.insumo_id THEN
        RAISE EXCEPTION
          'La presentación % pertenece al insumo %, no al insumo % de esta línea.',
          NEW.presentacion_solicitud_id, v_insumo_presentacion, NEW.insumo_id;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_validar_presentacion_linea_solicitud(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_validar_presentacion_linea_solicitud() IS 'RF-SOL. Impide que una línea declare una presentación de otro insumo. La FK sola no lo cubre: apunta a la tabla correcta pero podría apuntar a la fila equivocada.';


--
-- Name: fn_validar_serie_por_unidad(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_serie_por_unidad() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_serie_por_unidad boolean;
    v_insumo_nombre    text;
BEGIN
    SELECT i.serie_por_unidad, i.nombre
    INTO v_serie_por_unidad, v_insumo_nombre
    FROM public.insumo i WHERE i.id = NEW.insumo_id;

    IF NOT v_serie_por_unidad THEN
        RETURN NEW;
    END IF;

    IF NEW.codigo_lote_fabricante IS NULL
       OR length(trim(NEW.codigo_lote_fabricante)) = 0 THEN
        RAISE EXCEPTION
          'Cada unidad de % lleva su propio número de serie: indíquelo.',
          v_insumo_nombre;
    END IF;

    -- Una fila por unidad. Es lo que permite distinguirlas: un lote de tres
    -- con una sola serie no dice nada de las otras dos.
    IF NEW.cantidad_inicial <> 1 THEN
        RAISE EXCEPTION
          'Cada unidad de % se registra por separado, con su serie. Registre % unidades, una por número de serie.',
          v_insumo_nombre, NEW.cantidad_inicial;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.detalle_inventario_lote dl
        WHERE dl.insumo_id = NEW.insumo_id
          AND dl.activo = true
          AND dl.id <> COALESCE(NEW.id, -1)
          AND upper(trim(dl.codigo_lote_fabricante)) =
              upper(trim(NEW.codigo_lote_fabricante))
    ) THEN
        RAISE EXCEPTION
          'Ya existe una unidad activa de % con el número de serie %.',
          v_insumo_nombre, trim(NEW.codigo_lote_fabricante);
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_validar_serie_por_unidad(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_validar_serie_por_unidad() IS 'Grupo A. Para insumos con serie_por_unidad: exige un lote por unidad, con su número de serie, y sin repetir entre las unidades vivas del mismo insumo. No es un índice único porque la regla depende del insumo y un índice parcial no puede consultarlo.';


--
-- Name: fn_validar_stock_linea_solicitud(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_validar_stock_linea_solicitud() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_stock             integer;
    v_bloquea_sin_stock  boolean;
    v_nombre             character varying;
BEGIN
    SELECT i.bloquea_solicitud_sin_stock, i.nombre
    INTO v_bloquea_sin_stock, v_nombre
    FROM public.insumo i
    WHERE i.id = NEW.insumo_id;

    IF v_bloquea_sin_stock THEN
        v_stock := public.fn_stock_disponible(NEW.insumo_id);

        IF v_stock = 0 THEN
            RAISE EXCEPTION
                'No hay stock disponible para "%". No se puede agregar este insumo a la solicitud; registrelo manualmente en la lista de espera cuando llegue una nueva donación.',
                v_nombre
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION fn_validar_stock_linea_solicitud(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fn_validar_stock_linea_solicitud() IS 'RF-PRO. Bloquea la creacion de una LINEA de solicitud cuyo insumo tiene bloquea_solicitud_sin_stock=true y stock 0 (tipicamente medicamentos). Equipos/alimentos sin stock SI se permiten (quedan PENDIENTE_ADQUISICION).';


--
-- Name: sp_agregar_insumo_entrega(integer, integer, integer, integer, integer); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_agregar_insumo_entrega(IN p_entrega_id integer, IN p_insumo_id integer, IN p_cantidad integer, IN p_detalle_solicitud_id integer DEFAULT NULL::integer, IN p_lote_elegido_id integer DEFAULT NULL::integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_detalle_entrega_id   integer;
    v_lote                 RECORD;
    v_cantidad_resta       integer;
    v_tomar                integer;
    v_stock_total          integer;
    v_insumo_linea         integer;
    v_presentacion_base_id integer;
    v_disponible_lote      integer;
BEGIN
    IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad a entregar debe ser mayor a cero.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.entrega WHERE id = p_entrega_id AND activo = true) THEN
        RAISE EXCEPTION 'La entrega % no existe o está anulada.', p_entrega_id;
    END IF;

    IF p_detalle_solicitud_id IS NOT NULL THEN
        SELECT insumo_id INTO v_insumo_linea
        FROM public.detalle_solicitud_apoyo
        WHERE id = p_detalle_solicitud_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'La línea de solicitud % no existe.', p_detalle_solicitud_id;
        END IF;

        IF v_insumo_linea <> p_insumo_id THEN
            RAISE EXCEPTION
                'El insumo a entregar (%) no coincide con el insumo de la línea de solicitud (%) %.',
                p_insumo_id, v_insumo_linea, p_detalle_solicitud_id;
        END IF;
    END IF;

    v_stock_total := public.fn_stock_disponible(p_insumo_id);
    IF v_stock_total < p_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente. Disponible: %, Requerido: %.',
            v_stock_total, p_cantidad;
    END IF;

    SELECT id INTO v_presentacion_base_id
    FROM public.presentacion_insumo
    WHERE insumo_id = p_insumo_id AND es_default = true;

    IF v_presentacion_base_id IS NULL THEN
        RAISE EXCEPTION 'El insumo % no tiene una presentación default configurada en presentacion_insumo.', p_insumo_id;
    END IF;

    INSERT INTO public.detalle_entrega (
        entrega_id, insumo_id, detalle_solicitud_id, cantidad_entregada
    ) VALUES (
        p_entrega_id, p_insumo_id, p_detalle_solicitud_id, p_cantidad
    ) RETURNING id INTO v_detalle_entrega_id;

    -- Camino A: la unidad la eligió una persona. Se toma de ese lote y de
    -- ningún otro; si no alcanza, se avisa en vez de completar por FEFO, que
    -- entregaría en silencio una unidad distinta de la que se señaló.
    IF p_lote_elegido_id IS NOT NULL THEN
        SELECT cantidad_disponible INTO v_disponible_lote
        FROM public.detalle_inventario_lote
        WHERE id = p_lote_elegido_id
          AND insumo_id = p_insumo_id
          AND activo = true;

        IF NOT FOUND THEN
            RAISE EXCEPTION
              'La unidad elegida no existe, está inactiva o no pertenece a este insumo.';
        END IF;

        IF v_disponible_lote < p_cantidad THEN
            RAISE EXCEPTION
              'La unidad elegida solo tiene % disponible(s) y se piden %.',
              v_disponible_lote, p_cantidad;
        END IF;

        INSERT INTO public.detalle_entrega_lote (
            detalle_entrega_id, detalle_inventario_lote_id,
            presentacion_despacho_id, cantidad_despacho_original
        ) VALUES (
            v_detalle_entrega_id, p_lote_elegido_id,
            v_presentacion_base_id, p_cantidad
        );

        RETURN;
    END IF;

    -- Camino B: reparto automático FEFO/FIFO, como siempre.
    v_cantidad_resta := p_cantidad;

    FOR v_lote IN
        SELECT detalle_inventario_lote_id, cantidad_disponible
        FROM public.v_inventario_lote_fifo
        WHERE insumo_id = p_insumo_id
          AND activo = true
          AND cantidad_disponible > 0
        -- El id desempata: sin él, varias unidades del mismo envío y sin
        -- caducidad comparten el mismo orden_fifo y el resultado podría
        -- cambiar entre ejecuciones.
        ORDER BY orden_fifo ASC, detalle_inventario_lote_id ASC
    LOOP
        EXIT WHEN v_cantidad_resta = 0;

        v_tomar := LEAST(v_lote.cantidad_disponible, v_cantidad_resta);

        INSERT INTO public.detalle_entrega_lote (
            detalle_entrega_id, detalle_inventario_lote_id,
            presentacion_despacho_id, cantidad_despacho_original
        ) VALUES (
            v_detalle_entrega_id, v_lote.detalle_inventario_lote_id,
            v_presentacion_base_id, v_tomar
        );

        v_cantidad_resta := v_cantidad_resta - v_tomar;
    END LOOP;

    IF v_cantidad_resta > 0 THEN
        RAISE EXCEPTION 'No se pudo cubrir la cantidad completa. Faltaron: % unidades.',
            v_cantidad_resta;
    END IF;
END;
$$;


--
-- Name: PROCEDURE sp_agregar_insumo_entrega(IN p_entrega_id integer, IN p_insumo_id integer, IN p_cantidad integer, IN p_detalle_solicitud_id integer, IN p_lote_elegido_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON PROCEDURE public.sp_agregar_insumo_entrega(IN p_entrega_id integer, IN p_insumo_id integer, IN p_cantidad integer, IN p_detalle_solicitud_id integer, IN p_lote_elegido_id integer) IS 'RF-ENT. Agrega un insumo a una entrega. Sin p_lote_elegido_id reparte por FEFO/FIFO; con él despacha de esa unidad concreta, que es lo que necesita el equipo con número de serie.';


--
-- Name: sp_cancelar_linea_solicitud(integer, integer, text); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_cancelar_linea_solicitud(IN p_detalle_solicitud_id integer, IN p_usuario_id integer, IN p_motivo text DEFAULT NULL::text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_estado_actual  character varying;
    v_solicitud_id    integer;
BEGIN
    SELECT esa.nombre, dsa.solicitud_id INTO v_estado_actual, v_solicitud_id
    FROM public.detalle_solicitud_apoyo dsa
    JOIN public.estado_solicitud_apoyo esa ON esa.id = dsa.estado_id
    WHERE dsa.id = p_detalle_solicitud_id AND dsa.activo = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'La línea de solicitud % no existe o ya está inactiva.', p_detalle_solicitud_id;
    END IF;

    IF v_estado_actual = 'ENTREGADA' THEN
        RAISE EXCEPTION 'La línea % ya fue entregada; no se puede cancelar.', p_detalle_solicitud_id;
    END IF;

    IF v_estado_actual = 'CANCELADA' THEN
        RAISE EXCEPTION 'La línea % ya está cancelada.', p_detalle_solicitud_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = p_usuario_id) THEN
        RAISE EXCEPTION 'El usuario % no existe.', p_usuario_id;
    END IF;

    PERFORM set_config('app.usuario_id', p_usuario_id::text, true);

    UPDATE public.detalle_solicitud_apoyo
    SET estado_id = (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'CANCELADA')
    WHERE id = p_detalle_solicitud_id;

    -- El motivo se registra en la cabecera (observaciones_trabajo_social
    -- vive ahi, no en la linea) para mantener un solo lugar de bitacora
    -- textual del tramite.
    UPDATE public.solicitud_apoyo
    SET observaciones_trabajo_social = COALESCE(observaciones_trabajo_social || ' | ', '') ||
        format('Línea %s (insumo) CANCELADA: %s', p_detalle_solicitud_id, COALESCE(p_motivo, 'Sin motivo especificado'))
    WHERE id = v_solicitud_id;

    -- Recalcula la cabecera: si esta era la ultima linea pendiente, el
    -- tramite completo puede pasar a ENTREGADA (regla confirmada: todas
    -- las lineas en ENTREGADA o CANCELADA cierra la cabecera).
    PERFORM public.fn_recalcular_cabecera_solicitud(v_solicitud_id);
END;
$$;


--
-- Name: PROCEDURE sp_cancelar_linea_solicitud(IN p_detalle_solicitud_id integer, IN p_usuario_id integer, IN p_motivo text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON PROCEDURE public.sp_cancelar_linea_solicitud(IN p_detalle_solicitud_id integer, IN p_usuario_id integer, IN p_motivo text) IS 'Grupo D. Cancela UNA LINEA especifica de una solicitud (un insumo dentro del tramite), sin afectar las demas lineas. Dispara el recalculo de la cabecera.';


--
-- Name: sp_cancelar_solicitud_completa(integer, integer, text); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_cancelar_solicitud_completa(IN p_solicitud_id integer, IN p_usuario_id integer, IN p_motivo text DEFAULT NULL::text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_linea RECORD;
    v_alguna_cancelada boolean := false;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.solicitud_apoyo WHERE id = p_solicitud_id AND activo = true) THEN
        RAISE EXCEPTION 'La solicitud % no existe o ya está inactiva.', p_solicitud_id;
    END IF;

    FOR v_linea IN
        SELECT dsa.id
        FROM public.detalle_solicitud_apoyo dsa
        JOIN public.estado_solicitud_apoyo esa ON esa.id = dsa.estado_id
        WHERE dsa.solicitud_id = p_solicitud_id
          AND dsa.activo = true
          AND esa.nombre NOT IN ('ENTREGADA', 'CANCELADA')
    LOOP
        CALL public.sp_cancelar_linea_solicitud(v_linea.id, p_usuario_id, p_motivo);
        v_alguna_cancelada := true;
    END LOOP;

    IF NOT v_alguna_cancelada THEN
        RAISE EXCEPTION 'La solicitud % no tiene líneas pendientes de cancelar (todas ya están entregadas o canceladas).', p_solicitud_id;
    END IF;
END;
$$;


--
-- Name: PROCEDURE sp_cancelar_solicitud_completa(IN p_solicitud_id integer, IN p_usuario_id integer, IN p_motivo text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON PROCEDURE public.sp_cancelar_solicitud_completa(IN p_solicitud_id integer, IN p_usuario_id integer, IN p_motivo text) IS 'Grupo D. Cancela todas las lineas activas (no entregadas ni ya canceladas) de una solicitud de una sola vez, reutilizando sp_cancelar_linea_solicitud por cada una.';


--
-- Name: sp_dar_baja_insumo_vencido(integer, integer, text); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_dar_baja_insumo_vencido(IN p_detalle_inventario_lote_id integer, IN p_usuario_id integer, IN p_motivo text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_lote RECORD;
BEGIN
    IF p_motivo IS NULL OR length(trim(p_motivo)) = 0 THEN
        RAISE EXCEPTION 'Debe indicar el motivo de la baja (ej. "vencido", "dañado").';
    END IF;

    SELECT * INTO v_lote
    FROM public.detalle_inventario_lote
    WHERE id = p_detalle_inventario_lote_id
      AND activo = true
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El detalle de lote % no existe o ya está inactivo.', p_detalle_inventario_lote_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = p_usuario_id) THEN
        RAISE EXCEPTION 'El usuario % no existe.', p_usuario_id;
    END IF;

    IF v_lote.fecha_caducidad IS NOT NULL AND v_lote.fecha_caducidad >= CURRENT_DATE THEN
        RAISE WARNING
            'El detalle de lote % aún no está vencido (vence %); se dará de baja igual por el motivo indicado.',
            p_detalle_inventario_lote_id, v_lote.fecha_caducidad;
    END IF;

    PERFORM set_config('app.usuario_id', p_usuario_id::text, true);

    UPDATE public.detalle_inventario_lote
    SET activo = false,
        cantidad_disponible = 0,
        observaciones = COALESCE(observaciones || ' | ', '') ||
            format('BAJA (%s unidades descartadas): %s', v_lote.cantidad_disponible, p_motivo)
    WHERE id = p_detalle_inventario_lote_id;
END;
$$;


--
-- Name: PROCEDURE sp_dar_baja_insumo_vencido(IN p_detalle_inventario_lote_id integer, IN p_usuario_id integer, IN p_motivo text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON PROCEDURE public.sp_dar_baja_insumo_vencido(IN p_detalle_inventario_lote_id integer, IN p_usuario_id integer, IN p_motivo text) IS 'Grupo D. Da de baja un detalle_inventario_lote completo (vencido o dañado, se desecha). Pone cantidad_disponible en 0 y desactiva el lote, dejando motivo en observaciones.';


--
-- Name: sp_desactivar_detalle_entrega(integer, integer, text); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_desactivar_detalle_entrega(IN p_detalle_entrega_id integer, IN p_usuario_id integer, IN p_motivo text DEFAULT NULL::text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_renglon RECORD;
BEGIN
    SELECT * INTO v_renglon
    FROM public.detalle_entrega
    WHERE id = p_detalle_entrega_id AND activo = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El renglón de entrega % no existe o ya está anulado.', p_detalle_entrega_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = p_usuario_id) THEN
        RAISE EXCEPTION 'El usuario % no existe; no se puede registrar la anulación.', p_usuario_id;
    END IF;

    -- Un equipo con contrato de préstamo vigente no se puede anular sin
    -- resolver antes el contrato: quedaría un préstamo apuntando a algo que
    -- el sistema dice que nunca se entregó.
    IF EXISTS (
        SELECT 1 FROM public.contrato_prestamo
        WHERE detalle_entrega_id = p_detalle_entrega_id AND activo = true
    ) THEN
        RAISE EXCEPTION
          'El renglón % tiene un contrato de préstamo vigente. Cierre o anule el contrato antes de anular la entrega.',
          p_detalle_entrega_id;
    END IF;

    -- Si el préstamo ya se devolvió, el stock volvió al lote en ese momento
    -- (sp_registrar_devolucion_prestamo). Anular ahora lo devolvería una
    -- segunda vez y el inventario quedaría por encima de lo que se recibió.
    IF EXISTS (
        SELECT 1 FROM public.contrato_prestamo
        WHERE detalle_entrega_id = p_detalle_entrega_id
          AND fecha_devolucion_real IS NOT NULL
    ) THEN
        RAISE EXCEPTION
          'El renglón % corresponde a un préstamo ya devuelto: su stock volvió al inventario con la devolución. Anularlo ahora lo contaría dos veces.',
          p_detalle_entrega_id;
    END IF;

    PERFORM set_config('app.usuario_id', p_usuario_id::text, true);

    UPDATE public.detalle_entrega
    SET activo           = false,
        motivo_anulacion = 'ANULADO: ' || COALESCE(p_motivo, 'Sin motivo'),
        fecha_anulacion  = CURRENT_TIMESTAMP
    WHERE id = p_detalle_entrega_id;
END;
$$;


--
-- Name: PROCEDURE sp_desactivar_detalle_entrega(IN p_detalle_entrega_id integer, IN p_usuario_id integer, IN p_motivo text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON PROCEDURE public.sp_desactivar_detalle_entrega(IN p_detalle_entrega_id integer, IN p_usuario_id integer, IN p_motivo text) IS 'RF-ENT. Anula un solo insumo de una entrega, dejando el resto en pie. La restauración de inventario y el recálculo de la línea los hacen los triggers del renglón.';


--
-- Name: sp_desactivar_entrega(integer, integer, text); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_desactivar_entrega(IN p_entrega_id integer, IN p_usuario_id integer, IN p_motivo text DEFAULT NULL::text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_renglon RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.entrega WHERE id = p_entrega_id AND activo = true) THEN
        RAISE EXCEPTION 'La entrega % no existe o ya está desactivada.', p_entrega_id;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = p_usuario_id) THEN
        RAISE EXCEPTION 'El usuario % no existe; no se puede registrar la anulación.', p_usuario_id;
    END IF;

    PERFORM set_config('app.usuario_id', p_usuario_id::text, true);

    UPDATE public.entrega
    SET activo        = false,
        observaciones = COALESCE(observaciones || ' | ', '') ||
                        'ANULADA: ' || COALESCE(p_motivo, 'Sin motivo')
    WHERE id = p_entrega_id;

    -- Cada renglón restaura su propio inventario y recalcula su propia línea.
    FOR v_renglon IN
        SELECT id FROM public.detalle_entrega
        WHERE entrega_id = p_entrega_id AND activo = true
    LOOP
        UPDATE public.detalle_entrega
        SET activo           = false,
            motivo_anulacion = 'ANULADA LA ENTREGA COMPLETA: ' || COALESCE(p_motivo, 'Sin motivo'),
            fecha_anulacion  = CURRENT_TIMESTAMP
        WHERE id = v_renglon.id;
    END LOOP;
END;
$$;


--
-- Name: PROCEDURE sp_desactivar_entrega(IN p_entrega_id integer, IN p_usuario_id integer, IN p_motivo text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON PROCEDURE public.sp_desactivar_entrega(IN p_entrega_id integer, IN p_usuario_id integer, IN p_motivo text) IS 'RF-ENT. Anula una entrega completa apagando todos sus renglones; cada uno restaura su inventario y recalcula su línea de solicitud.';


--
-- Name: sp_procesar_donacion_pendientes(integer, integer); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_procesar_donacion_pendientes(IN p_insumo_id integer, IN p_recepcion_lote_id integer)
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
        SELECT dsa.id, dsa.cantidad_requerida, dsa.cantidad_entregada
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

        -- No se descuenta inventario real aqui (eso solo ocurre al
        -- registrar la entrega, via sp_registrar_entrega). Este SP solo
        -- "reserva" la disponibilidad marcando la linea como lista para
        -- entrega -- el descuento fisico ocurre cuando el empleado
        -- efectivamente despacha.
        UPDATE public.detalle_solicitud_apoyo
        SET estado_id = CASE
                WHEN v_asignar >= (v_linea.cantidad_requerida - v_linea.cantidad_entregada)
                    THEN v_estado_pendiente_entrega_id
                ELSE v_estado_pendiente_entrega_parcial_id
            END,
            fecha_asignacion = CURRENT_DATE
        WHERE id = v_linea.id;

        v_stock_restante := v_stock_restante - v_asignar;
    END LOOP;
END;
$$;


--
-- Name: PROCEDURE sp_procesar_donacion_pendientes(IN p_insumo_id integer, IN p_recepcion_lote_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON PROCEDURE public.sp_procesar_donacion_pendientes(IN p_insumo_id integer, IN p_recepcion_lote_id integer) IS 'RF-INV. Resuelve la lista de espera de un insumo en orden FIFO de creacion de linea, cuando llega stock nuevo. Ya no depende de asignacion_pendiente (tabla eliminada) -- opera directo sobre detalle_solicitud_apoyo.';


--
-- Name: sp_registrar_devolucion_prestamo(integer, integer); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_registrar_devolucion_prestamo(IN p_contrato_id integer, IN p_usuario_id integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_contrato      RECORD;
    v_lote          RECORD;
    v_lote_activo   boolean;
    v_huerfanos     integer := 0;
BEGIN
    SELECT cp.* INTO v_contrato
    FROM public.contrato_prestamo cp
    WHERE cp.id = p_contrato_id
      AND cp.activo = true
      AND cp.detalle_entrega_id IS NOT NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'El contrato de préstamo % no existe, ya está inactivo, o es una renovación sin entrega física propia (no aplica devolución directa sobre este registro).', p_contrato_id;
    END IF;

    IF v_contrato.fecha_devolucion_real IS NOT NULL THEN
        RAISE EXCEPTION 'El contrato % ya tiene registrada una devolución (%).', p_contrato_id, v_contrato.fecha_devolucion_real;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.usuario WHERE id = p_usuario_id) THEN
        RAISE EXCEPTION 'El usuario % no existe.', p_usuario_id;
    END IF;

    PERFORM set_config('app.usuario_id', p_usuario_id::text, true);

    FOR v_lote IN
        SELECT detalle_inventario_lote_id, cantidad_entregada
        FROM public.detalle_entrega_lote
        WHERE detalle_entrega_id = v_contrato.detalle_entrega_id
          AND activo = true
    LOOP
        SELECT activo INTO v_lote_activo
        FROM public.detalle_inventario_lote
        WHERE id = v_lote.detalle_inventario_lote_id
        FOR UPDATE;

        IF v_lote_activo IS TRUE THEN
            UPDATE public.detalle_inventario_lote
            SET cantidad_disponible = cantidad_disponible + v_lote.cantidad_entregada
            WHERE id = v_lote.detalle_inventario_lote_id;
        ELSE
            v_huerfanos := v_huerfanos + 1;
            RAISE WARNING
                'Devolución de contrato %: el lote % está inactivo; % unidades requieren revisión manual.',
                p_contrato_id, v_lote.detalle_inventario_lote_id, v_lote.cantidad_entregada;
        END IF;
    END LOOP;

    UPDATE public.contrato_prestamo
    SET fecha_devolucion_real = CURRENT_DATE,
        estado_id = (SELECT id FROM public.estado_contrato_prestamo WHERE nombre = 'DEVUELTO')
    WHERE id = p_contrato_id;

    IF v_huerfanos > 0 THEN
        RAISE NOTICE 'Contrato % marcado como devuelto, pero % lote(s) requieren revision manual de inventario.', p_contrato_id, v_huerfanos;
    END IF;
END;
$$;


--
-- Name: PROCEDURE sp_registrar_devolucion_prestamo(IN p_contrato_id integer, IN p_usuario_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON PROCEDURE public.sp_registrar_devolucion_prestamo(IN p_contrato_id integer, IN p_usuario_id integer) IS 'Grupo B. Registra la devolucion de un equipo prestado: devuelve stock al lote de origen (via detalle_entrega_id) y cierra el contrato como DEVUELTO. No desactiva la entrega (se conserva el historial). No aplica a contratos de renovacion (detalle_entrega_id NULL).';


--
-- Name: sp_registrar_entrega(integer, integer, integer, integer, integer, text, integer, integer); Type: PROCEDURE; Schema: public; Owner: -
--

CREATE PROCEDURE public.sp_registrar_entrega(IN p_detalle_solicitud_id integer, IN p_persona_id integer, IN p_insumo_id integer, IN p_cantidad integer, IN p_usuario_entrega_id integer, IN p_observaciones text DEFAULT NULL::text, IN p_persona_receptor_id integer DEFAULT NULL::integer, IN p_tipo_parentesco_receptor_id integer DEFAULT NULL::integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_entrega_id integer;
BEGIN
    v_entrega_id := public.fn_crear_entrega(
        p_persona_id, p_usuario_entrega_id, p_observaciones,
        p_persona_receptor_id, p_tipo_parentesco_receptor_id
    );

    CALL public.sp_agregar_insumo_entrega(
        v_entrega_id, p_insumo_id, p_cantidad, p_detalle_solicitud_id
    );
END;
$$;


--
-- Name: PROCEDURE sp_registrar_entrega(IN p_detalle_solicitud_id integer, IN p_persona_id integer, IN p_insumo_id integer, IN p_cantidad integer, IN p_usuario_entrega_id integer, IN p_observaciones text, IN p_persona_receptor_id integer, IN p_tipo_parentesco_receptor_id integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON PROCEDURE public.sp_registrar_entrega(IN p_detalle_solicitud_id integer, IN p_persona_id integer, IN p_insumo_id integer, IN p_cantidad integer, IN p_usuario_entrega_id integer, IN p_observaciones text, IN p_persona_receptor_id integer, IN p_tipo_parentesco_receptor_id integer) IS 'RF-ENT. Entrega de un solo insumo. Desde la migración 19 es un envoltorio sobre fn_crear_entrega + sp_agregar_insumo_entrega; se conserva la firma para no romper a quien ya lo llama.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auditoria_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auditoria_log (
    id bigint NOT NULL,
    tabla_afectada character varying(50) NOT NULL,
    registro_id integer NOT NULL,
    tipo_accion_id integer NOT NULL,
    usuario_id integer,
    fecha_hora timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    valores_antiguos jsonb,
    valores_nuevos jsonb
);


--
-- Name: auditoria_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auditoria_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auditoria_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auditoria_log_id_seq OWNED BY public.auditoria_log.id;


--
-- Name: catalogo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalogo (
    id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: TABLE catalogo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.catalogo IS 'Catalogos de opciones reutilizables entre distintos formularios (Tenencia de vivienda, Material de construccion). No confundir con categoria_insumo u otros catalogos fijos del sistema: este es especifico para listas de opciones de formulario_campo.';


--
-- Name: catalogo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.catalogo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: catalogo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.catalogo_id_seq OWNED BY public.catalogo.id;


--
-- Name: catalogo_valor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalogo_valor (
    id integer NOT NULL,
    catalogo_id integer NOT NULL,
    etiqueta character varying(150) NOT NULL,
    orden integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: catalogo_valor_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.catalogo_valor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: catalogo_valor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.catalogo_valor_id_seq OWNED BY public.catalogo_valor.id;


--
-- Name: categoria_insumo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categoria_insumo (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    permite_prestamo boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN categoria_insumo.permite_prestamo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.categoria_insumo.permite_prestamo IS 'Si los insumos de esta categoría se pueden entregar en préstamo. Falso por omisión: prestar solo tiene sentido con lo que se devuelve.';


--
-- Name: categoria_insumo_formulario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categoria_insumo_formulario (
    id integer NOT NULL,
    categoria_insumo_id integer NOT NULL,
    formulario_id integer NOT NULL,
    orden integer DEFAULT 0 NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    modalidad_solicitud_id integer
);


--
-- Name: TABLE categoria_insumo_formulario; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.categoria_insumo_formulario IS 'Que formularios exige una categoria de insumo antes de aprobar una linea de solicitud. Tabla puente: permite que un formulario se comparta entre varias categorias sin duplicarlo.';


--
-- Name: COLUMN categoria_insumo_formulario.modalidad_solicitud_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.categoria_insumo_formulario.modalidad_solicitud_id IS 'A qué modalidad aplica este formulario. NULL = a todas. Permite que el estudio socioeconómico se exija en donación y no en préstamo sin duplicar filas.';


--
-- Name: categoria_insumo_formulario_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categoria_insumo_formulario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categoria_insumo_formulario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categoria_insumo_formulario_id_seq OWNED BY public.categoria_insumo_formulario.id;


--
-- Name: categoria_insumo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.categoria_insumo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: categoria_insumo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.categoria_insumo_id_seq OWNED BY public.categoria_insumo.id;


--
-- Name: comunidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comunidad (
    id integer NOT NULL,
    municipio_id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    ubicacion character varying(255),
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: comunidad_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.comunidad_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: comunidad_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.comunidad_id_seq OWNED BY public.comunidad.id;


--
-- Name: contacto_referencia_persona; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacto_referencia_persona (
    id integer NOT NULL,
    persona_id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    telefono character varying(20),
    observaciones text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT contacto_referencia_nombre_no_vacio_check CHECK ((length(TRIM(BOTH FROM nombre)) > 0))
);


--
-- Name: contacto_referencia_persona_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contacto_referencia_persona_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contacto_referencia_persona_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contacto_referencia_persona_id_seq OWNED BY public.contacto_referencia_persona.id;


--
-- Name: contrato_prestamo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contrato_prestamo (
    id integer NOT NULL,
    detalle_entrega_id integer,
    contrato_anterior_id integer,
    fecha_inicio date DEFAULT CURRENT_DATE NOT NULL,
    fecha_devolucion_pactada date NOT NULL,
    fecha_devolucion_real date,
    estado_id integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    motivo_cierre text,
    CONSTRAINT contrato_origen_check CHECK ((((detalle_entrega_id IS NOT NULL) AND (contrato_anterior_id IS NULL)) OR ((detalle_entrega_id IS NULL) AND (contrato_anterior_id IS NOT NULL)))),
    CONSTRAINT contrato_prestamo_devolucion_real_check CHECK (((fecha_devolucion_real IS NULL) OR (fecha_devolucion_real >= fecha_inicio))),
    CONSTRAINT contrato_prestamo_fechas_check CHECK ((fecha_devolucion_pactada >= fecha_inicio))
);


--
-- Name: COLUMN contrato_prestamo.motivo_cierre; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.contrato_prestamo.motivo_cierre IS 'Por qué se anuló el contrato o por qué se dio el equipo por no devuelto. Vacío mientras el préstamo sigue su curso normal.';


--
-- Name: contrato_prestamo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contrato_prestamo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contrato_prestamo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contrato_prestamo_id_seq OWNED BY public.contrato_prestamo.id;


--
-- Name: departamento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.departamento (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: departamento_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.departamento_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: departamento_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.departamento_id_seq OWNED BY public.departamento.id;


--
-- Name: detalle_entrega; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_entrega (
    id integer NOT NULL,
    entrega_id integer NOT NULL,
    insumo_id integer NOT NULL,
    detalle_solicitud_id integer,
    cantidad_entregada integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    motivo_anulacion text,
    fecha_anulacion timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT detalle_entrega_anulacion_coherente_check CHECK ((((activo = true) AND (motivo_anulacion IS NULL) AND (fecha_anulacion IS NULL)) OR ((activo = false) AND (motivo_anulacion IS NOT NULL)))),
    CONSTRAINT detalle_entrega_cantidad_check CHECK ((cantidad_entregada > 0))
);


--
-- Name: TABLE detalle_entrega; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.detalle_entrega IS 'RF-ENT. Un renglón por insumo entregado dentro de una entrega. El reparto por lotes vive en detalle_entrega_lote.';


--
-- Name: detalle_entrega_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.detalle_entrega_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: detalle_entrega_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.detalle_entrega_id_seq OWNED BY public.detalle_entrega.id;


--
-- Name: detalle_entrega_lote; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_entrega_lote (
    id integer NOT NULL,
    detalle_inventario_lote_id integer NOT NULL,
    presentacion_despacho_id integer NOT NULL,
    cantidad_despacho_original numeric(12,4) NOT NULL,
    cantidad_entregada integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    detalle_entrega_id integer NOT NULL,
    CONSTRAINT detalle_entrega_lote_cantidad_despacho_check CHECK ((cantidad_despacho_original > (0)::numeric)),
    CONSTRAINT detalle_entrega_lote_cantidad_entregada_check CHECK ((cantidad_entregada > 0))
);


--
-- Name: detalle_entrega_lote_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.detalle_entrega_lote_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: detalle_entrega_lote_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.detalle_entrega_lote_id_seq OWNED BY public.detalle_entrega_lote.id;


--
-- Name: detalle_inventario_lote; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_inventario_lote (
    id integer NOT NULL,
    insumo_id integer NOT NULL,
    recepcion_lote_id integer NOT NULL,
    presentacion_recepcion_id integer NOT NULL,
    cantidad_recepcion_original numeric(12,4) NOT NULL,
    codigo_lote_fabricante character varying(50),
    fecha_caducidad date,
    cantidad_inicial integer NOT NULL,
    cantidad_disponible integer NOT NULL,
    observaciones text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    unidades_por_presentacion_lote numeric(12,4) NOT NULL,
    marca_id integer,
    CONSTRAINT detalle_inventario_lote_cantidad_coherente_check CHECK ((cantidad_disponible <= cantidad_inicial)),
    CONSTRAINT detalle_inventario_lote_cantidad_disponible_check CHECK ((cantidad_disponible >= 0)),
    CONSTRAINT detalle_inventario_lote_cantidad_inicial_check CHECK ((cantidad_inicial > 0)),
    CONSTRAINT detalle_inventario_lote_cantidad_recepcion_check CHECK ((cantidad_recepcion_original > (0)::numeric)),
    CONSTRAINT detalle_inventario_lote_unidades_presentacion_check CHECK ((unidades_por_presentacion_lote > (0)::numeric))
);


--
-- Name: detalle_inventario_lote_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.detalle_inventario_lote_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: detalle_inventario_lote_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.detalle_inventario_lote_id_seq OWNED BY public.detalle_inventario_lote.id;


--
-- Name: detalle_solicitud_apoyo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_solicitud_apoyo (
    id integer NOT NULL,
    solicitud_id integer NOT NULL,
    insumo_id integer NOT NULL,
    cantidad_requerida integer NOT NULL,
    cantidad_entregada integer DEFAULT 0 NOT NULL,
    estado_id integer NOT NULL,
    fecha_asignacion date,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    receta_medica_id integer,
    modalidad_solicitud_id integer NOT NULL,
    presentacion_solicitud_id integer,
    cantidad_presentacion numeric(12,4),
    CONSTRAINT detalle_solicitud_cantidad_entregada_check CHECK (((cantidad_entregada >= 0) AND (cantidad_entregada <= cantidad_requerida))),
    CONSTRAINT detalle_solicitud_cantidad_requerida_check CHECK ((cantidad_requerida > 0)),
    CONSTRAINT dsa_presentacion_coherente_check CHECK ((((presentacion_solicitud_id IS NULL) AND (cantidad_presentacion IS NULL)) OR ((presentacion_solicitud_id IS NOT NULL) AND (cantidad_presentacion IS NOT NULL) AND (cantidad_presentacion > (0)::numeric))))
);


--
-- Name: COLUMN detalle_solicitud_apoyo.modalidad_solicitud_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.detalle_solicitud_apoyo.modalidad_solicitud_id IS 'Bajo qué figura se entrega este insumo. Se fija al crear la línea y no cambia: un cambio de figura es una solicitud nueva.';


--
-- Name: COLUMN detalle_solicitud_apoyo.presentacion_solicitud_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.detalle_solicitud_apoyo.presentacion_solicitud_id IS 'En qué presentación se expresó el pedido ("2 cajas"). Solo para mostrar y dejar rastro: cantidad_requerida, en unidad base, sigue siendo la fuente de verdad.';


--
-- Name: COLUMN detalle_solicitud_apoyo.cantidad_presentacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.detalle_solicitud_apoyo.cantidad_presentacion IS 'Cuántas unidades de esa presentación se pidieron. Numérica porque media caja es un pedido posible.';


--
-- Name: detalle_solicitud_apoyo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.detalle_solicitud_apoyo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: detalle_solicitud_apoyo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.detalle_solicitud_apoyo_id_seq OWNED BY public.detalle_solicitud_apoyo.id;


--
-- Name: detalle_solicitud_formulario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_solicitud_formulario (
    id integer NOT NULL,
    detalle_solicitud_id integer NOT NULL,
    formulario_id integer NOT NULL,
    completado boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: TABLE detalle_solicitud_formulario; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.detalle_solicitud_formulario IS 'Un formulario exigido por la categoria del insumo, lleno (o pendiente de llenar) para una LINEA de solicitud concreta.';


--
-- Name: detalle_solicitud_formulario_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.detalle_solicitud_formulario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: detalle_solicitud_formulario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.detalle_solicitud_formulario_id_seq OWNED BY public.detalle_solicitud_formulario.id;


--
-- Name: detalle_solicitud_formulario_respuesta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.detalle_solicitud_formulario_respuesta (
    id integer NOT NULL,
    detalle_solicitud_formulario_id integer NOT NULL,
    formulario_campo_id integer NOT NULL,
    numero_fila integer DEFAULT 1 NOT NULL,
    valor_texto text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT dsfr_numero_fila_check CHECK ((numero_fila > 0))
);


--
-- Name: TABLE detalle_solicitud_formulario_respuesta; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.detalle_solicitud_formulario_respuesta IS 'Valor capturado para un campo de un formulario lleno. numero_fila > 1 solo aplica a campos de un grupo_repetible.';


--
-- Name: detalle_solicitud_formulario_respuesta_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.detalle_solicitud_formulario_respuesta_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: detalle_solicitud_formulario_respuesta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.detalle_solicitud_formulario_respuesta_id_seq OWNED BY public.detalle_solicitud_formulario_respuesta.id;


--
-- Name: discapacidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discapacidad (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: discapacidad_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.discapacidad_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: discapacidad_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.discapacidad_id_seq OWNED BY public.discapacidad.id;


--
-- Name: documento_persona; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documento_persona (
    id integer NOT NULL,
    persona_id integer NOT NULL,
    tipo_documento_id integer NOT NULL,
    numero_documento character varying(100),
    ruta_archivo character varying(500),
    observaciones text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: documento_persona_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documento_persona_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documento_persona_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documento_persona_id_seq OWNED BY public.documento_persona.id;


--
-- Name: documento_recepcion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documento_recepcion (
    id integer NOT NULL,
    recepcion_lote_id integer NOT NULL,
    ruta_archivo character varying(500) NOT NULL,
    descripcion character varying(255),
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: documento_recepcion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documento_recepcion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documento_recepcion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documento_recepcion_id_seq OWNED BY public.documento_recepcion.id;


--
-- Name: documento_solicitud; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documento_solicitud (
    id integer NOT NULL,
    solicitud_id integer NOT NULL,
    formulario_id integer,
    ruta_archivo character varying(500) NOT NULL,
    descripcion character varying(255),
    observaciones text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: TABLE documento_solicitud; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.documento_solicitud IS 'RF-SOL. Escaneos del legajo de una solicitud: los formularios firmados en papel y cualquier otro respaldo. Van por solicitud y no por formulario llenado porque en la práctica son un solo expediente; formulario_id permite identificar cuál es cuál cuando se sabe.';


--
-- Name: documento_solicitud_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.documento_solicitud_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: documento_solicitud_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.documento_solicitud_id_seq OWNED BY public.documento_solicitud.id;


--
-- Name: encargado_menor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encargado_menor (
    menor_id integer NOT NULL,
    encargado_id integer NOT NULL,
    tipo_parentesco_id integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT encargado_menor_distintos_check CHECK ((menor_id <> encargado_id))
);


--
-- Name: TABLE encargado_menor; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.encargado_menor IS 'RF-BEN. Vínculo entre una persona y quien responde por ella. Recomendado para menores de edad y personas con discapacidad, pero NO obligatorio desde la migración 22: la interfaz lo sugiere, la base ya no lo exige.';


--
-- Name: entrega; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entrega (
    id integer NOT NULL,
    persona_id integer NOT NULL,
    persona_receptor_id integer,
    tipo_parentesco_receptor_id integer,
    fecha_entrega date DEFAULT CURRENT_DATE NOT NULL,
    usuario_entrega_id integer NOT NULL,
    observaciones text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT entrega_fecha_valida_check CHECK ((fecha_entrega <= CURRENT_DATE)),
    CONSTRAINT entrega_receptor_coherente_check CHECK (((persona_receptor_id IS NULL) OR (tipo_parentesco_receptor_id IS NOT NULL)))
);


--
-- Name: entrega_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.entrega_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: entrega_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.entrega_id_seq OWNED BY public.entrega.id;


--
-- Name: estado_civil; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estado_civil (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: TABLE estado_civil; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.estado_civil IS 'RF-BEN. Estado civil de una persona, tal como lo pregunta el estudio socioeconómico de Orden de Malta. Catálogo administrable: a diferencia de modalidad_solicitud, ningún código se ramifica sobre estos valores.';


--
-- Name: estado_civil_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estado_civil_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estado_civil_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estado_civil_id_seq OWNED BY public.estado_civil.id;


--
-- Name: estado_contrato_prestamo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estado_contrato_prestamo (
    id integer NOT NULL,
    nombre character varying(20) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: estado_contrato_prestamo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estado_contrato_prestamo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estado_contrato_prestamo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estado_contrato_prestamo_id_seq OWNED BY public.estado_contrato_prestamo.id;


--
-- Name: estado_solicitud_apoyo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.estado_solicitud_apoyo (
    id integer NOT NULL,
    nombre character varying(30) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: estado_solicitud_apoyo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.estado_solicitud_apoyo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: estado_solicitud_apoyo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.estado_solicitud_apoyo_id_seq OWNED BY public.estado_solicitud_apoyo.id;


--
-- Name: evidencia_contrato_prestamo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidencia_contrato_prestamo (
    id integer NOT NULL,
    contrato_prestamo_id integer NOT NULL,
    tipo_evidencia_id integer NOT NULL,
    ruta_archivo character varying(500) NOT NULL,
    observaciones text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: evidencia_contrato_prestamo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.evidencia_contrato_prestamo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: evidencia_contrato_prestamo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.evidencia_contrato_prestamo_id_seq OWNED BY public.evidencia_contrato_prestamo.id;


--
-- Name: evidencia_entrega; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidencia_entrega (
    id integer NOT NULL,
    entrega_id integer NOT NULL,
    tipo_evidencia_id integer NOT NULL,
    ruta_archivo character varying(500) NOT NULL,
    observaciones text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: evidencia_entrega_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.evidencia_entrega_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: evidencia_entrega_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.evidencia_entrega_id_seq OWNED BY public.evidencia_entrega.id;


--
-- Name: formulario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.formulario (
    id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: TABLE formulario; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.formulario IS 'Catalogo de formularios configurables que puede exigir una categoria de insumo antes de aprobar una linea de solicitud (tipicamente equipo). Agregar un formulario nuevo es tarea de datos, no de codigo.';


--
-- Name: formulario_campo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.formulario_campo (
    id integer NOT NULL,
    formulario_id integer NOT NULL,
    etiqueta character varying(200) NOT NULL,
    tipo_dato_id integer NOT NULL,
    catalogo_id integer,
    obligatorio boolean DEFAULT false NOT NULL,
    orden integer NOT NULL,
    grupo_repetible character varying(100),
    ayuda text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: TABLE formulario_campo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.formulario_campo IS 'Campos de un formulario, en el orden en que se muestran. grupo_repetible agrupa los campos que forman una tabla de filas repetibles (grupo familiar, egresos). catalogo_id apunta a un catalogo REUTILIZABLE de opciones; si es NULL, las opciones (si las hay) viven en formulario_campo_opcion, propias de este campo.';


--
-- Name: formulario_campo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.formulario_campo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: formulario_campo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.formulario_campo_id_seq OWNED BY public.formulario_campo.id;


--
-- Name: formulario_campo_opcion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.formulario_campo_opcion (
    id integer NOT NULL,
    formulario_campo_id integer NOT NULL,
    etiqueta character varying(150) NOT NULL,
    orden integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: formulario_campo_opcion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.formulario_campo_opcion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: formulario_campo_opcion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.formulario_campo_opcion_id_seq OWNED BY public.formulario_campo_opcion.id;


--
-- Name: formulario_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.formulario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: formulario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.formulario_id_seq OWNED BY public.formulario.id;


--
-- Name: grado_academico; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grado_academico (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: TABLE grado_academico; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.grado_academico IS 'RF-BEN. Nivel educativo alcanzado. Catálogo administrable. "Ninguno" es un valor con significado propio; la ausencia de dato se representa con NULL en persona.';


--
-- Name: grado_academico_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.grado_academico_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: grado_academico_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.grado_academico_id_seq OWNED BY public.grado_academico.id;


--
-- Name: institucion_donante; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.institucion_donante (
    id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    telefono character varying(20),
    correo character varying(100),
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT institucion_donante_correo_valido_check CHECK (((correo IS NULL) OR ((correo)::text ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text)))
);


--
-- Name: institucion_donante_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.institucion_donante_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: institucion_donante_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.institucion_donante_id_seq OWNED BY public.institucion_donante.id;


--
-- Name: insumo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.insumo (
    id integer NOT NULL,
    categoria_id integer NOT NULL,
    unidad_medida_base_id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    requiere_fecha_caducidad boolean DEFAULT false NOT NULL,
    requiere_codigo_fabricante boolean DEFAULT false NOT NULL,
    bloquea_solicitud_sin_stock boolean DEFAULT false NOT NULL,
    serie_por_unidad boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN insumo.serie_por_unidad; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.insumo.serie_por_unidad IS 'Si cada unidad es una pieza identificable con su propio número de serie. Cuando es verdadero, cada lote es de una unidad y su codigo_lote_fabricante no se repite entre las unidades vivas del insumo.';


--
-- Name: insumo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.insumo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: insumo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.insumo_id_seq OWNED BY public.insumo.id;


--
-- Name: marca_insumo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marca_insumo (
    id integer NOT NULL,
    nombre character varying(150) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: marca_insumo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.marca_insumo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: marca_insumo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.marca_insumo_id_seq OWNED BY public.marca_insumo.id;


--
-- Name: modalidad_solicitud; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.modalidad_solicitud (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: TABLE modalidad_solicitud; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.modalidad_solicitud IS 'Catálogo de solo lectura: bajo qué figura se entrega el insumo. El código se ramifica sobre estos nombres, así que agregar valores exige migración, no una pantalla.';


--
-- Name: modalidad_solicitud_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.modalidad_solicitud_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: modalidad_solicitud_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.modalidad_solicitud_id_seq OWNED BY public.modalidad_solicitud.id;


--
-- Name: multa_prestamo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.multa_prestamo (
    id integer NOT NULL,
    contrato_prestamo_id integer NOT NULL,
    tipo_multa_id integer NOT NULL,
    monto numeric(10,2) NOT NULL,
    fecha_aplicacion date DEFAULT CURRENT_DATE NOT NULL,
    motivo text,
    pagada boolean DEFAULT false NOT NULL,
    fecha_pago date,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT multa_prestamo_fecha_valida_check CHECK ((fecha_aplicacion <= CURRENT_DATE)),
    CONSTRAINT multa_prestamo_monto_check CHECK ((monto >= (0)::numeric)),
    CONSTRAINT multa_prestamo_pago_coherente_check CHECK ((((pagada = false) AND (fecha_pago IS NULL)) OR ((pagada = true) AND (fecha_pago IS NOT NULL))))
);


--
-- Name: multa_prestamo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.multa_prestamo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: multa_prestamo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.multa_prestamo_id_seq OWNED BY public.multa_prestamo.id;


--
-- Name: municipio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.municipio (
    id integer NOT NULL,
    departamento_id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: municipio_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.municipio_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: municipio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.municipio_id_seq OWNED BY public.municipio.id;


--
-- Name: ocupacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocupacion (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: TABLE ocupacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ocupacion IS 'RF-BEN. A qué se dedica la persona. Catálogo administrable: cuando aparece una ocupación que no estaba, se agrega desde Catálogos.';


--
-- Name: ocupacion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ocupacion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ocupacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ocupacion_id_seq OWNED BY public.ocupacion.id;


--
-- Name: persona; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.persona (
    id integer NOT NULL,
    cui_dpi character varying(13),
    nombres character varying(100) NOT NULL,
    apellidos character varying(100) NOT NULL,
    fecha_nacimiento date NOT NULL,
    genero_id integer,
    comunidad_id integer,
    telefono character varying(20),
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    direccion character varying(255),
    estado_civil_id integer,
    grado_academico_id integer,
    ocupacion_id integer,
    municipio_nacimiento_id integer,
    CONSTRAINT persona_apellidos_no_vacio_check CHECK ((length(TRIM(BOTH FROM apellidos)) > 0)),
    CONSTRAINT persona_fecha_nacimiento_valida_check CHECK (((fecha_nacimiento <= CURRENT_DATE) AND (fecha_nacimiento > (CURRENT_DATE - '120 years'::interval)))),
    CONSTRAINT persona_nombres_no_vacio_check CHECK ((length(TRIM(BOTH FROM nombres)) > 0))
);


--
-- Name: COLUMN persona.direccion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.persona.direccion IS 'Direccion de vivienda de la persona. Distinta de comunidad.ubicacion, que es la referencia geografica de la comunidad completa, no de la casa exacta.';


--
-- Name: COLUMN persona.estado_civil_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.persona.estado_civil_id IS 'Estado civil declarado. Nullable: las fichas anteriores a la migración 23 no lo traen.';


--
-- Name: COLUMN persona.municipio_nacimiento_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.persona.municipio_nacimiento_id IS 'Municipio donde nació. Distinto de comunidad_id, que es dónde vive hoy. NULL cuando no se preguntó o cuando nació fuera del país, caso que todavía no se modela.';


--
-- Name: persona_discapacidad; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.persona_discapacidad (
    persona_id integer NOT NULL,
    discapacidad_id integer NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: persona_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.persona_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: persona_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.persona_id_seq OWNED BY public.persona.id;


--
-- Name: presentacion_insumo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.presentacion_insumo (
    id integer NOT NULL,
    insumo_id integer NOT NULL,
    unidad_medida_id integer NOT NULL,
    es_default boolean DEFAULT false NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    unidades_por_presentacion numeric(12,4) DEFAULT 1 NOT NULL,
    CONSTRAINT presentacion_factor_positivo_check CHECK ((unidades_por_presentacion > (0)::numeric))
);


--
-- Name: COLUMN presentacion_insumo.unidades_por_presentacion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.presentacion_insumo.unidades_por_presentacion IS 'Cuántas unidades base contiene esta presentación, de forma NOMINAL. Sirve para convertir al pedir; el dato real de cada envío vive en detalle_inventario_lote.unidades_por_presentacion_lote y puede diferir.';


--
-- Name: presentacion_insumo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.presentacion_insumo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: presentacion_insumo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.presentacion_insumo_id_seq OWNED BY public.presentacion_insumo.id;


--
-- Name: programa; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programa (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: programa_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.programa_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: programa_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.programa_id_seq OWNED BY public.programa.id;


--
-- Name: recepcion_donacion_lote; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recepcion_donacion_lote (
    id integer NOT NULL,
    codigo_lote character varying(50),
    fecha_recepcion date DEFAULT CURRENT_DATE NOT NULL,
    institucion_id integer NOT NULL,
    observaciones_generales text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT recepcion_donacion_lote_fecha_valida_check CHECK ((fecha_recepcion <= CURRENT_DATE))
);


--
-- Name: recepcion_donacion_lote_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.recepcion_donacion_lote_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: recepcion_donacion_lote_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.recepcion_donacion_lote_id_seq OWNED BY public.recepcion_donacion_lote.id;


--
-- Name: receta_medica; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receta_medica (
    id integer NOT NULL,
    solicitud_id integer NOT NULL,
    ruta_archivo character varying(500) NOT NULL,
    fecha_emision date,
    observaciones text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT receta_medica_fecha_valida_check CHECK (((fecha_emision IS NULL) OR (fecha_emision <= CURRENT_DATE)))
);


--
-- Name: receta_medica_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.receta_medica_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: receta_medica_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.receta_medica_id_seq OWNED BY public.receta_medica.id;


--
-- Name: rol; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rol (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    descripcion text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT rol_nombre_valido_check CHECK (((nombre)::text = ANY (ARRAY[('EMPLEADO_DMM'::character varying)::text, ('DIRECTORA'::character varying)::text, ('ALCALDE'::character varying)::text, ('ADMINISTRADOR'::character varying)::text])))
);


--
-- Name: rol_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rol_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rol_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rol_id_seq OWNED BY public.rol.id;


--
-- Name: sesion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sesion (
    id bigint NOT NULL,
    usuario_id integer NOT NULL,
    token_hash character varying(64) NOT NULL,
    ip_origen character varying(45),
    user_agent text,
    ultima_actividad timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expira_en timestamp without time zone NOT NULL,
    revocada_en timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT sesion_expira_en_valida_check CHECK ((expira_en > created_at)),
    CONSTRAINT sesion_revocada_coherente_check CHECK (((revocada_en IS NULL) OR (revocada_en >= created_at)))
);


--
-- Name: TABLE sesion; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.sesion IS 'RNF-SEG-03. Sesiones de usuario con estado en servidor. La inactividad (30 min) se valida en el middleware de autenticacion del backend. El tope absoluto de 12h (expira_en) es decision de diseno propia, no requisito confirmado por el cliente. Nunca se eliminan filas de esta tabla (evidencia de acceso para auditoria/seguridad).';


--
-- Name: COLUMN sesion.token_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sesion.token_hash IS 'Hash (SHA-256) del token de sesion. El valor en claro solo existe en la cookie HttpOnly del cliente, nunca se persiste.';


--
-- Name: COLUMN sesion.ultima_actividad; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sesion.ultima_actividad IS 'Se actualiza en cada request autenticado exitoso. Base para el corte de inactividad de 30 minutos (RNF-SEG-03).';


--
-- Name: COLUMN sesion.expira_en; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sesion.expira_en IS 'Tope absoluto de vigencia (created_at + 12 horas, decision de diseno propia), independiente de la actividad.';


--
-- Name: COLUMN sesion.revocada_en; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.sesion.revocada_en IS 'NULL mientras la sesion esta vigente. Se establece en logout explicito o revocacion administrativa (ej. desactivar el usuario).';


--
-- Name: sesion_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sesion_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sesion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sesion_id_seq OWNED BY public.sesion.id;


--
-- Name: solicitud_apoyo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitud_apoyo (
    id integer NOT NULL,
    persona_id integer NOT NULL,
    programa_id integer NOT NULL,
    fecha_solicitud date DEFAULT CURRENT_DATE NOT NULL,
    requiere_aprobacion boolean DEFAULT false NOT NULL,
    aprobada boolean DEFAULT false NOT NULL,
    estado_id integer NOT NULL,
    fecha_aprobacion date,
    aprobado_por integer,
    observaciones_trabajo_social text,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    registrada_en_suplencia boolean DEFAULT false NOT NULL,
    CONSTRAINT solicitud_apoyo_aprobacion_coherente_check CHECK ((((aprobada = false) AND (fecha_aprobacion IS NULL) AND (aprobado_por IS NULL)) OR ((aprobada = true) AND (fecha_aprobacion IS NOT NULL) AND (aprobado_por IS NOT NULL)))),
    CONSTRAINT solicitud_apoyo_fecha_valida_check CHECK ((fecha_solicitud <= CURRENT_DATE))
);


--
-- Name: COLUMN solicitud_apoyo.registrada_en_suplencia; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.solicitud_apoyo.registrada_en_suplencia IS 'Verdadero cuando quien registró la solicitud no es la encargada del programa elegido. Se fija al crear y no se recalcula: si después le cambian el programa a esa persona, lo que pasó no cambia.';


--
-- Name: solicitud_apoyo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.solicitud_apoyo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: solicitud_apoyo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.solicitud_apoyo_id_seq OWNED BY public.solicitud_apoyo.id;


--
-- Name: tipo_accion_auditoria; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipo_accion_auditoria (
    id integer NOT NULL,
    nombre character varying(10) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: tipo_accion_auditoria_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipo_accion_auditoria_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tipo_accion_auditoria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipo_accion_auditoria_id_seq OWNED BY public.tipo_accion_auditoria.id;


--
-- Name: tipo_dato_campo_formulario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipo_dato_campo_formulario (
    id integer NOT NULL,
    nombre character varying(30) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: tipo_dato_campo_formulario_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipo_dato_campo_formulario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tipo_dato_campo_formulario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipo_dato_campo_formulario_id_seq OWNED BY public.tipo_dato_campo_formulario.id;


--
-- Name: tipo_documento_persona; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipo_documento_persona (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: tipo_documento_persona_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipo_documento_persona_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tipo_documento_persona_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipo_documento_persona_id_seq OWNED BY public.tipo_documento_persona.id;


--
-- Name: tipo_evidencia_contrato; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipo_evidencia_contrato (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: tipo_evidencia_contrato_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipo_evidencia_contrato_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tipo_evidencia_contrato_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipo_evidencia_contrato_id_seq OWNED BY public.tipo_evidencia_contrato.id;


--
-- Name: tipo_evidencia_entrega; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipo_evidencia_entrega (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: tipo_evidencia_entrega_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipo_evidencia_entrega_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tipo_evidencia_entrega_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipo_evidencia_entrega_id_seq OWNED BY public.tipo_evidencia_entrega.id;


--
-- Name: tipo_genero; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipo_genero (
    id integer NOT NULL,
    nombre character varying(30) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: tipo_genero_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipo_genero_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tipo_genero_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipo_genero_id_seq OWNED BY public.tipo_genero.id;


--
-- Name: tipo_multa_prestamo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipo_multa_prestamo (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    monto_sugerido numeric(10,2),
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    CONSTRAINT tipo_multa_prestamo_monto_check CHECK (((monto_sugerido IS NULL) OR (monto_sugerido >= (0)::numeric)))
);


--
-- Name: tipo_multa_prestamo_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipo_multa_prestamo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tipo_multa_prestamo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipo_multa_prestamo_id_seq OWNED BY public.tipo_multa_prestamo.id;


--
-- Name: tipo_parentesco; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipo_parentesco (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: tipo_parentesco_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tipo_parentesco_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tipo_parentesco_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tipo_parentesco_id_seq OWNED BY public.tipo_parentesco.id;


--
-- Name: unidad_medida; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.unidad_medida (
    id integer NOT NULL,
    nombre character varying(30) NOT NULL,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer
);


--
-- Name: unidad_medida_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.unidad_medida_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: unidad_medida_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.unidad_medida_id_seq OWNED BY public.unidad_medida.id;


--
-- Name: usuario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usuario (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    rol_id integer NOT NULL,
    ultimo_login timestamp without time zone,
    activo boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    created_by integer,
    updated_by integer,
    programa_id integer,
    nombre_completo character varying(150),
    CONSTRAINT usuario_username_no_vacio_check CHECK ((length(TRIM(BOTH FROM username)) > 0))
);


--
-- Name: COLUMN usuario.programa_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usuario.programa_id IS 'Programa del que esta usuaria es encargada. Se usa para preseleccionar el campo al crear una solicitud; NO restringe qué puede registrar. Nulo para Directora, Alcalde y Administrador, que no llevan uno propio.';


--
-- Name: COLUMN usuario.nombre_completo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.usuario.nombre_completo IS 'Nombre de la persona, tal como se escribe: con tildes y espacios. Es lo que se muestra en pantallas, auditoría y expedientes. Distinto de username, que es el identificador de acceso y no admite acentos.';


--
-- Name: usuario_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usuario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usuario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usuario_id_seq OWNED BY public.usuario.id;


--
-- Name: v_formularios_exigidos_linea; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_formularios_exigidos_linea AS
 SELECT dsa.id AS detalle_solicitud_id,
    dsa.solicitud_id,
    dsa.modalidad_solicitud_id,
    ms.nombre AS modalidad_nombre,
    f.id AS formulario_id,
    f.nombre AS formulario_nombre,
    f.descripcion AS formulario_descripcion,
    cif.orden,
    dsf.id AS detalle_solicitud_formulario_id,
    COALESCE(dsf.completado, false) AS completado
   FROM (((((public.detalle_solicitud_apoyo dsa
     JOIN public.insumo i ON ((i.id = dsa.insumo_id)))
     JOIN public.modalidad_solicitud ms ON ((ms.id = dsa.modalidad_solicitud_id)))
     JOIN public.categoria_insumo_formulario cif ON (((cif.categoria_insumo_id = i.categoria_id) AND (cif.activo = true) AND ((cif.modalidad_solicitud_id IS NULL) OR (cif.modalidad_solicitud_id = dsa.modalidad_solicitud_id)))))
     JOIN public.formulario f ON (((f.id = cif.formulario_id) AND (f.activo = true))))
     LEFT JOIN public.detalle_solicitud_formulario dsf ON (((dsf.formulario_id = f.id) AND (dsf.detalle_solicitud_id = dsa.id) AND (dsf.activo = true))));


--
-- Name: VIEW v_formularios_exigidos_linea; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_formularios_exigidos_linea IS 'RF-PRO. Formularios que una línea de solicitud debe llenar según la categoría de su insumo Y su modalidad, con el estado de cada uno. Un préstamo no arrastra los formularios marcados como propios de donación.';


--
-- Name: v_inventario_lote_fifo; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_inventario_lote_fifo AS
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
     JOIN public.recepcion_donacion_lote rl ON ((rl.id = dl.recepcion_lote_id)));


--
-- Name: VIEW v_inventario_lote_fifo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_inventario_lote_fifo IS 'RF-ENT. Detalle de inventario por producto, con codigo_lote y fecha_recepcion resueltos via JOIN al lote padre (3FN), y columna orden_fifo lista para ORDER BY en el despacho de entregas.';


--
-- Name: v_lista_espera; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_lista_espera AS
 SELECT dsa.id AS detalle_solicitud_id,
    dsa.solicitud_id,
    p.id AS persona_id,
    (((p.nombres)::text || ' '::text) || (p.apellidos)::text) AS persona_nombre_completo,
    i.nombre AS insumo_nombre,
    dsa.cantidad_requerida,
    dsa.cantidad_entregada,
    esa.nombre AS estado,
    dsa.created_at AS fecha_ingreso_espera,
    (CURRENT_DATE - (dsa.created_at)::date) AS dias_esperando
   FROM ((((public.detalle_solicitud_apoyo dsa
     JOIN public.solicitud_apoyo sa ON ((sa.id = dsa.solicitud_id)))
     JOIN public.persona p ON ((p.id = sa.persona_id)))
     JOIN public.insumo i ON ((i.id = dsa.insumo_id)))
     JOIN public.estado_solicitud_apoyo esa ON ((esa.id = dsa.estado_id)))
  WHERE ((dsa.activo = true) AND ((esa.nombre)::text = ANY (ARRAY[('PENDIENTE_ADQUISICION'::character varying)::text, ('PENDIENTE_ENTREGA_PARCIAL'::character varying)::text])))
  ORDER BY dsa.created_at;


--
-- Name: VIEW v_lista_espera; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_lista_espera IS 'RF-INV. Lista de espera legible por LINEA de solicitud, ordenada FIFO por fecha de creacion de la linea. Ya no depende de asignacion_pendiente (tabla eliminada).';


--
-- Name: v_persona_edad; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_persona_edad AS
 SELECT p.id,
    p.nombres,
    p.apellidos,
    p.fecha_nacimiento,
    public.fn_calcular_edad(p.fecha_nacimiento) AS edad_actual,
    public.fn_es_menor(p.fecha_nacimiento) AS es_menor,
    public.fn_es_adulto_mayor(p.fecha_nacimiento) AS es_adulto_mayor,
    tg.nombre AS genero,
    c.nombre AS comunidad_nombre,
    c.ubicacion AS comunidad_ubicacion,
    m.nombre AS municipio_nombre,
    d.nombre AS departamento_nombre,
    p.cui_dpi,
    p.activo
   FROM ((((public.persona p
     LEFT JOIN public.tipo_genero tg ON ((tg.id = p.genero_id)))
     LEFT JOIN public.comunidad c ON ((c.id = p.comunidad_id)))
     LEFT JOIN public.municipio m ON ((m.id = c.municipio_id)))
     LEFT JOIN public.departamento d ON ((d.id = m.departamento_id)));


--
-- Name: VIEW v_persona_edad; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_persona_edad IS 'RF-BEN. Personas con edad, condicion de menor y adulto mayor calculadas en tiempo real (no almacenadas), genero resuelto via catalogo, y jerarquia geografica completa.';


--
-- Name: v_reporte_personas_atendidas; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_reporte_personas_atendidas AS
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
     LEFT JOIN public.programa pr ON ((pr.id = sa.programa_id)))
  WHERE (e.activo = true);


--
-- Name: VIEW v_reporte_personas_atendidas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_reporte_personas_atendidas IS 'RF-REP. Una fila por insumo entregado (entrega x renglón), con edad calculada a la fecha de la entrega. Desde la migración 19 ya no duplica cuando un despacho se reparte en varios lotes.';


--
-- Name: v_reporte_poblacion_beneficiada; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_reporte_poblacion_beneficiada AS
 SELECT depto.nombre AS departamento_nombre,
    m.nombre AS municipio_nombre,
    c.nombre AS comunidad_nombre,
    pr.nombre AS programa_nombre,
    tg.nombre AS genero,
        CASE
            WHEN public.fn_es_adulto_mayor(p.fecha_nacimiento) THEN 'ADULTO_MAYOR'::text
            WHEN public.fn_es_menor(p.fecha_nacimiento) THEN 'MENOR'::text
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
     LEFT JOIN public.programa pr ON ((pr.id = sa.programa_id)))
  WHERE (e.activo = true)
  GROUP BY depto.nombre, m.nombre, c.nombre, pr.nombre, tg.nombre,
        CASE
            WHEN public.fn_es_adulto_mayor(p.fecha_nacimiento) THEN 'ADULTO_MAYOR'::text
            WHEN public.fn_es_menor(p.fecha_nacimiento) THEN 'MENOR'::text
            ELSE 'ADULTO'::text
        END, (EXISTS ( SELECT 1
           FROM public.persona_discapacidad pd
          WHERE ((pd.persona_id = p.id) AND (pd.activo = true)))), (date_trunc('month'::text, (e.fecha_entrega)::timestamp with time zone));


--
-- Name: VIEW v_reporte_poblacion_beneficiada; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_reporte_poblacion_beneficiada IS 'Grupo E / RF-REP. Poblacion beneficiada agregada por ubicacion, programa, genero, grupo etario y discapacidad, con corte mensual. Desde la migración 19 el programa se alcanza por el renglón de entrega, no por la cabecera.';


--
-- Name: v_reporte_stock_por_categoria; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_reporte_stock_por_categoria AS
 SELECT ci.id AS categoria_id,
    ci.nombre AS categoria_nombre,
    count(DISTINCT i.id) AS cantidad_tipos_insumo,
    (COALESCE(sum(dl.cantidad_disponible) FILTER (WHERE (dl.activo = true)), (0)::bigint))::integer AS unidades_totales_disponibles,
    count(DISTINCT dl.id) FILTER (WHERE ((dl.activo = true) AND (dl.cantidad_disponible > 0) AND ((public.fn_semaforo_caducidad(dl.fecha_caducidad))::text = ANY (ARRAY[('ROJO'::character varying)::text, ('VENCIDO'::character varying)::text])))) AS lotes_urgentes_o_vencidos
   FROM ((public.categoria_insumo ci
     LEFT JOIN public.insumo i ON (((i.categoria_id = ci.id) AND (i.activo = true))))
     LEFT JOIN public.detalle_inventario_lote dl ON ((dl.insumo_id = i.id)))
  WHERE (ci.activo = true)
  GROUP BY ci.id, ci.nombre
  ORDER BY ci.nombre;


--
-- Name: VIEW v_reporte_stock_por_categoria; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_reporte_stock_por_categoria IS 'Grupo E / RF-REP. Cantidad de tipos de insumo y unidades totales disponibles por categoria, mas conteo de lotes en estado urgente o vencido.';


--
-- Name: v_semaforo_inventario; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_semaforo_inventario AS
 SELECT dl.id AS detalle_inventario_lote_id,
    i.id AS insumo_id,
    i.nombre AS insumo_nombre,
    rl.codigo_lote,
    dl.fecha_caducidad,
    rl.fecha_recepcion,
    dl.cantidad_disponible,
    dl.cantidad_inicial,
    public.fn_semaforo_caducidad(dl.fecha_caducidad) AS semaforo
   FROM ((public.detalle_inventario_lote dl
     JOIN public.insumo i ON ((i.id = dl.insumo_id)))
     JOIN public.recepcion_donacion_lote rl ON ((rl.id = dl.recepcion_lote_id)))
  WHERE (dl.activo = true);


--
-- Name: VIEW v_semaforo_inventario; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_semaforo_inventario IS 'RF-INV-02. Cada producto (detalle) de lote activo con su clasificacion de semaforo de caducidad (VENCIDO/ROJO/AMARILLO/VERDE/GRIS) y el codigo del lote padre al que pertenece.';


--
-- Name: v_solicitudes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_solicitudes AS
 SELECT sa.id AS solicitud_id,
    dsa.id AS detalle_solicitud_id,
    p.id AS persona_id,
    (((p.nombres)::text || ' '::text) || (p.apellidos)::text) AS persona_nombre_completo,
    pr.nombre AS programa_nombre,
    i.nombre AS insumo_nombre,
    dsa.cantidad_requerida,
    dsa.cantidad_entregada,
    sa.fecha_solicitud,
    esa_linea.nombre AS estado_linea,
    esa_cabecera.nombre AS estado_cabecera,
    sa.requiere_aprobacion,
    sa.aprobada,
    sa.fecha_aprobacion,
    ua.username AS aprobado_por_username,
    ((esa_linea.nombre)::text = ANY (ARRAY['ENTREGADA'::text, 'CANCELADA'::text])) AS linea_cerrada
   FROM (((((((public.solicitud_apoyo sa
     JOIN public.detalle_solicitud_apoyo dsa ON (((dsa.solicitud_id = sa.id) AND (dsa.activo = true))))
     JOIN public.persona p ON ((p.id = sa.persona_id)))
     JOIN public.programa pr ON ((pr.id = sa.programa_id)))
     JOIN public.insumo i ON ((i.id = dsa.insumo_id)))
     JOIN public.estado_solicitud_apoyo esa_linea ON ((esa_linea.id = dsa.estado_id)))
     JOIN public.estado_solicitud_apoyo esa_cabecera ON ((esa_cabecera.id = sa.estado_id)))
     LEFT JOIN public.usuario ua ON ((ua.id = sa.aprobado_por)))
  WHERE (sa.activo = true);


--
-- Name: VIEW v_solicitudes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_solicitudes IS 'RF-SOL. Una fila por línea de solicitud viva, incluidas las ya entregadas y canceladas. Es la fuente del listado y del historial; v_solicitudes_activas filtra sobre esta.';


--
-- Name: v_solicitudes_activas; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_solicitudes_activas AS
 SELECT solicitud_id,
    detalle_solicitud_id,
    persona_id,
    persona_nombre_completo,
    programa_nombre,
    insumo_nombre,
    cantidad_requerida,
    cantidad_entregada,
    fecha_solicitud,
    estado_linea,
    estado_cabecera,
    requiere_aprobacion,
    aprobada,
    fecha_aprobacion,
    aprobado_por_username,
    linea_cerrada
   FROM public.v_solicitudes
  WHERE (linea_cerrada = false);


--
-- Name: VIEW v_solicitudes_activas; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_solicitudes_activas IS 'Solo las líneas que aún requieren acción. Es v_solicitudes sin las ENTREGADA ni las CANCELADA.';


--
-- Name: v_stock_insumo; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_stock_insumo AS
 SELECT i.id AS insumo_id,
    i.nombre AS insumo_nombre,
    ci.nombre AS categoria_nombre,
    i.requiere_fecha_caducidad,
    i.requiere_codigo_fabricante,
    i.bloquea_solicitud_sin_stock,
    um.nombre AS unidad_base_nombre,
    (COALESCE(sum(dl.cantidad_disponible) FILTER (WHERE (dl.activo = true)), (0)::bigint))::integer AS stock_total,
    min(dl.fecha_caducidad) FILTER (WHERE ((dl.activo = true) AND (dl.cantidad_disponible > 0))) AS proxima_caducidad,
    public.fn_semaforo_caducidad(min(dl.fecha_caducidad) FILTER (WHERE ((dl.activo = true) AND (dl.cantidad_disponible > 0)))) AS semaforo
   FROM (((public.insumo i
     JOIN public.categoria_insumo ci ON ((ci.id = i.categoria_id)))
     JOIN public.unidad_medida um ON ((um.id = i.unidad_medida_base_id)))
     LEFT JOIN public.detalle_inventario_lote dl ON ((dl.insumo_id = i.id)))
  WHERE (i.activo = true)
  GROUP BY i.id, i.nombre, ci.nombre, i.requiere_fecha_caducidad, i.requiere_codigo_fabricante, i.bloquea_solicitud_sin_stock, um.nombre;


--
-- Name: VIEW v_stock_insumo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_stock_insumo IS 'RF-INV. Stock total por insumo (suma de detalles de lote activos, en unidad base), semaforo del detalle mas proximo a vencer, y reglas de negocio propias del insumo (requiere_fecha_caducidad/requiere_codigo_fabricante/bloquea_solicitud_sin_stock viven en insumo, no en categoria_insumo).';


--
-- Name: v_stock_insumo_presentaciones; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_stock_insumo_presentaciones AS
 SELECT i.id AS insumo_id,
    i.nombre AS insumo_nombre,
    vs.stock_total AS stock_total_unidad_base,
    pi.id AS presentacion_id,
    um.nombre AS presentacion_nombre,
    round(avg(dl.unidades_por_presentacion_lote), 4) AS unidades_por_presentacion_promedio,
    count(dl.id) AS lotes_considerados
   FROM ((((public.insumo i
     JOIN public.v_stock_insumo vs ON ((vs.insumo_id = i.id)))
     JOIN public.presentacion_insumo pi ON (((pi.insumo_id = i.id) AND (pi.activo = true))))
     JOIN public.unidad_medida um ON ((um.id = pi.unidad_medida_id)))
     LEFT JOIN public.detalle_inventario_lote dl ON (((dl.insumo_id = i.id) AND (dl.presentacion_recepcion_id = pi.id) AND (dl.activo = true) AND (dl.cantidad_disponible > 0))))
  GROUP BY i.id, i.nombre, vs.stock_total, pi.id, um.nombre;


--
-- Name: VIEW v_stock_insumo_presentaciones; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_stock_insumo_presentaciones IS 'Grupo A. Para cada insumo y presentacion, muestra el promedio de unidades_por_presentacion_lote de los lotes activos con stock disponible en esa presentacion (y cuantos lotes se consideraron). Es informativo/aproximado: si hay lotes con distinto contenido por presentacion, no representa un valor unico exacto. No usar para decidir cantidades de despacho -- eso se calcula contra el lote real de origen.';


--
-- Name: v_unidades_disponibles; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_unidades_disponibles AS
 SELECT dl.id AS detalle_inventario_lote_id,
    dl.insumo_id,
    i.nombre AS insumo_nombre,
    dl.codigo_lote_fabricante AS numero_serie,
    rl.codigo_lote AS codigo_envio,
    rl.fecha_recepcion,
    ins.nombre AS institucion_nombre,
    mi.nombre AS marca_nombre,
    dl.cantidad_disponible
   FROM ((((public.detalle_inventario_lote dl
     JOIN public.insumo i ON ((i.id = dl.insumo_id)))
     JOIN public.recepcion_donacion_lote rl ON ((rl.id = dl.recepcion_lote_id)))
     JOIN public.institucion_donante ins ON ((ins.id = rl.institucion_id)))
     LEFT JOIN public.marca_insumo mi ON ((mi.id = dl.marca_id)))
  WHERE ((dl.activo = true) AND (dl.cantidad_disponible > 0) AND (i.serie_por_unidad = true));


--
-- Name: VIEW v_unidades_disponibles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_unidades_disponibles IS 'Unidades identificables disponibles, una por número de serie. Es lo que se le muestra a quien entrega para que elija la pieza que tiene en la mano.';


--
-- Name: auditoria_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_log ALTER COLUMN id SET DEFAULT nextval('public.auditoria_log_id_seq'::regclass);


--
-- Name: catalogo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo ALTER COLUMN id SET DEFAULT nextval('public.catalogo_id_seq'::regclass);


--
-- Name: catalogo_valor id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo_valor ALTER COLUMN id SET DEFAULT nextval('public.catalogo_valor_id_seq'::regclass);


--
-- Name: categoria_insumo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo ALTER COLUMN id SET DEFAULT nextval('public.categoria_insumo_id_seq'::regclass);


--
-- Name: categoria_insumo_formulario id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo_formulario ALTER COLUMN id SET DEFAULT nextval('public.categoria_insumo_formulario_id_seq'::regclass);


--
-- Name: comunidad id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunidad ALTER COLUMN id SET DEFAULT nextval('public.comunidad_id_seq'::regclass);


--
-- Name: contacto_referencia_persona id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacto_referencia_persona ALTER COLUMN id SET DEFAULT nextval('public.contacto_referencia_persona_id_seq'::regclass);


--
-- Name: contrato_prestamo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_prestamo ALTER COLUMN id SET DEFAULT nextval('public.contrato_prestamo_id_seq'::regclass);


--
-- Name: departamento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departamento ALTER COLUMN id SET DEFAULT nextval('public.departamento_id_seq'::regclass);


--
-- Name: detalle_entrega id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega ALTER COLUMN id SET DEFAULT nextval('public.detalle_entrega_id_seq'::regclass);


--
-- Name: detalle_entrega_lote id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega_lote ALTER COLUMN id SET DEFAULT nextval('public.detalle_entrega_lote_id_seq'::regclass);


--
-- Name: detalle_inventario_lote id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_inventario_lote ALTER COLUMN id SET DEFAULT nextval('public.detalle_inventario_lote_id_seq'::regclass);


--
-- Name: detalle_solicitud_apoyo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo ALTER COLUMN id SET DEFAULT nextval('public.detalle_solicitud_apoyo_id_seq'::regclass);


--
-- Name: detalle_solicitud_formulario id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario ALTER COLUMN id SET DEFAULT nextval('public.detalle_solicitud_formulario_id_seq'::regclass);


--
-- Name: detalle_solicitud_formulario_respuesta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario_respuesta ALTER COLUMN id SET DEFAULT nextval('public.detalle_solicitud_formulario_respuesta_id_seq'::regclass);


--
-- Name: discapacidad id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discapacidad ALTER COLUMN id SET DEFAULT nextval('public.discapacidad_id_seq'::regclass);


--
-- Name: documento_persona id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_persona ALTER COLUMN id SET DEFAULT nextval('public.documento_persona_id_seq'::regclass);


--
-- Name: documento_recepcion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_recepcion ALTER COLUMN id SET DEFAULT nextval('public.documento_recepcion_id_seq'::regclass);


--
-- Name: documento_solicitud id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_solicitud ALTER COLUMN id SET DEFAULT nextval('public.documento_solicitud_id_seq'::regclass);


--
-- Name: entrega id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega ALTER COLUMN id SET DEFAULT nextval('public.entrega_id_seq'::regclass);


--
-- Name: estado_civil id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_civil ALTER COLUMN id SET DEFAULT nextval('public.estado_civil_id_seq'::regclass);


--
-- Name: estado_contrato_prestamo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_contrato_prestamo ALTER COLUMN id SET DEFAULT nextval('public.estado_contrato_prestamo_id_seq'::regclass);


--
-- Name: estado_solicitud_apoyo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_solicitud_apoyo ALTER COLUMN id SET DEFAULT nextval('public.estado_solicitud_apoyo_id_seq'::regclass);


--
-- Name: evidencia_contrato_prestamo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_contrato_prestamo ALTER COLUMN id SET DEFAULT nextval('public.evidencia_contrato_prestamo_id_seq'::regclass);


--
-- Name: evidencia_entrega id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_entrega ALTER COLUMN id SET DEFAULT nextval('public.evidencia_entrega_id_seq'::regclass);


--
-- Name: formulario id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario ALTER COLUMN id SET DEFAULT nextval('public.formulario_id_seq'::regclass);


--
-- Name: formulario_campo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo ALTER COLUMN id SET DEFAULT nextval('public.formulario_campo_id_seq'::regclass);


--
-- Name: formulario_campo_opcion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo_opcion ALTER COLUMN id SET DEFAULT nextval('public.formulario_campo_opcion_id_seq'::regclass);


--
-- Name: grado_academico id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grado_academico ALTER COLUMN id SET DEFAULT nextval('public.grado_academico_id_seq'::regclass);


--
-- Name: institucion_donante id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institucion_donante ALTER COLUMN id SET DEFAULT nextval('public.institucion_donante_id_seq'::regclass);


--
-- Name: insumo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insumo ALTER COLUMN id SET DEFAULT nextval('public.insumo_id_seq'::regclass);


--
-- Name: marca_insumo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marca_insumo ALTER COLUMN id SET DEFAULT nextval('public.marca_insumo_id_seq'::regclass);


--
-- Name: modalidad_solicitud id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modalidad_solicitud ALTER COLUMN id SET DEFAULT nextval('public.modalidad_solicitud_id_seq'::regclass);


--
-- Name: multa_prestamo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multa_prestamo ALTER COLUMN id SET DEFAULT nextval('public.multa_prestamo_id_seq'::regclass);


--
-- Name: municipio id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipio ALTER COLUMN id SET DEFAULT nextval('public.municipio_id_seq'::regclass);


--
-- Name: ocupacion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocupacion ALTER COLUMN id SET DEFAULT nextval('public.ocupacion_id_seq'::regclass);


--
-- Name: persona id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona ALTER COLUMN id SET DEFAULT nextval('public.persona_id_seq'::regclass);


--
-- Name: presentacion_insumo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presentacion_insumo ALTER COLUMN id SET DEFAULT nextval('public.presentacion_insumo_id_seq'::regclass);


--
-- Name: programa id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programa ALTER COLUMN id SET DEFAULT nextval('public.programa_id_seq'::regclass);


--
-- Name: recepcion_donacion_lote id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_donacion_lote ALTER COLUMN id SET DEFAULT nextval('public.recepcion_donacion_lote_id_seq'::regclass);


--
-- Name: receta_medica id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receta_medica ALTER COLUMN id SET DEFAULT nextval('public.receta_medica_id_seq'::regclass);


--
-- Name: rol id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rol ALTER COLUMN id SET DEFAULT nextval('public.rol_id_seq'::regclass);


--
-- Name: sesion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesion ALTER COLUMN id SET DEFAULT nextval('public.sesion_id_seq'::regclass);


--
-- Name: solicitud_apoyo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_apoyo ALTER COLUMN id SET DEFAULT nextval('public.solicitud_apoyo_id_seq'::regclass);


--
-- Name: tipo_accion_auditoria id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_accion_auditoria ALTER COLUMN id SET DEFAULT nextval('public.tipo_accion_auditoria_id_seq'::regclass);


--
-- Name: tipo_dato_campo_formulario id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_dato_campo_formulario ALTER COLUMN id SET DEFAULT nextval('public.tipo_dato_campo_formulario_id_seq'::regclass);


--
-- Name: tipo_documento_persona id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_documento_persona ALTER COLUMN id SET DEFAULT nextval('public.tipo_documento_persona_id_seq'::regclass);


--
-- Name: tipo_evidencia_contrato id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_evidencia_contrato ALTER COLUMN id SET DEFAULT nextval('public.tipo_evidencia_contrato_id_seq'::regclass);


--
-- Name: tipo_evidencia_entrega id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_evidencia_entrega ALTER COLUMN id SET DEFAULT nextval('public.tipo_evidencia_entrega_id_seq'::regclass);


--
-- Name: tipo_genero id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_genero ALTER COLUMN id SET DEFAULT nextval('public.tipo_genero_id_seq'::regclass);


--
-- Name: tipo_multa_prestamo id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_multa_prestamo ALTER COLUMN id SET DEFAULT nextval('public.tipo_multa_prestamo_id_seq'::regclass);


--
-- Name: tipo_parentesco id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_parentesco ALTER COLUMN id SET DEFAULT nextval('public.tipo_parentesco_id_seq'::regclass);


--
-- Name: unidad_medida id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidad_medida ALTER COLUMN id SET DEFAULT nextval('public.unidad_medida_id_seq'::regclass);


--
-- Name: usuario id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario ALTER COLUMN id SET DEFAULT nextval('public.usuario_id_seq'::regclass);


--
-- Name: auditoria_log auditoria_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_log
    ADD CONSTRAINT auditoria_log_pkey PRIMARY KEY (id);


--
-- Name: catalogo catalogo_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo
    ADD CONSTRAINT catalogo_nombre_key UNIQUE (nombre);


--
-- Name: catalogo catalogo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo
    ADD CONSTRAINT catalogo_pkey PRIMARY KEY (id);


--
-- Name: catalogo_valor catalogo_valor_orden_unico_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo_valor
    ADD CONSTRAINT catalogo_valor_orden_unico_key UNIQUE (catalogo_id, orden);


--
-- Name: catalogo_valor catalogo_valor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo_valor
    ADD CONSTRAINT catalogo_valor_pkey PRIMARY KEY (id);


--
-- Name: categoria_insumo_formulario categoria_insumo_formulario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo_formulario
    ADD CONSTRAINT categoria_insumo_formulario_pkey PRIMARY KEY (id);


--
-- Name: categoria_insumo categoria_insumo_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo
    ADD CONSTRAINT categoria_insumo_nombre_key UNIQUE (nombre);


--
-- Name: categoria_insumo categoria_insumo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo
    ADD CONSTRAINT categoria_insumo_pkey PRIMARY KEY (id);


--
-- Name: categoria_insumo_formulario cif_categoria_formulario_unico_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo_formulario
    ADD CONSTRAINT cif_categoria_formulario_unico_key UNIQUE (categoria_insumo_id, formulario_id);


--
-- Name: comunidad comunidad_nombre_municipio_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunidad
    ADD CONSTRAINT comunidad_nombre_municipio_key UNIQUE (nombre, municipio_id);


--
-- Name: comunidad comunidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunidad
    ADD CONSTRAINT comunidad_pkey PRIMARY KEY (id);


--
-- Name: contacto_referencia_persona contacto_referencia_persona_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacto_referencia_persona
    ADD CONSTRAINT contacto_referencia_persona_pkey PRIMARY KEY (id);


--
-- Name: contrato_prestamo contrato_prestamo_anterior_unico_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_prestamo
    ADD CONSTRAINT contrato_prestamo_anterior_unico_key UNIQUE (contrato_anterior_id);


--
-- Name: contrato_prestamo contrato_prestamo_detalle_entrega_unica_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_prestamo
    ADD CONSTRAINT contrato_prestamo_detalle_entrega_unica_key UNIQUE (detalle_entrega_id);


--
-- Name: contrato_prestamo contrato_prestamo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_prestamo
    ADD CONSTRAINT contrato_prestamo_pkey PRIMARY KEY (id);


--
-- Name: departamento departamento_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departamento
    ADD CONSTRAINT departamento_nombre_key UNIQUE (nombre);


--
-- Name: departamento departamento_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departamento
    ADD CONSTRAINT departamento_pkey PRIMARY KEY (id);


--
-- Name: detalle_entrega_lote detalle_entrega_lote_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega_lote
    ADD CONSTRAINT detalle_entrega_lote_pkey PRIMARY KEY (id);


--
-- Name: detalle_entrega detalle_entrega_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega
    ADD CONSTRAINT detalle_entrega_pkey PRIMARY KEY (id);


--
-- Name: detalle_inventario_lote detalle_inventario_lote_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_inventario_lote
    ADD CONSTRAINT detalle_inventario_lote_pkey PRIMARY KEY (id);


--
-- Name: detalle_solicitud_apoyo detalle_solicitud_apoyo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo
    ADD CONSTRAINT detalle_solicitud_apoyo_pkey PRIMARY KEY (id);


--
-- Name: detalle_solicitud_formulario detalle_solicitud_formulario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario
    ADD CONSTRAINT detalle_solicitud_formulario_pkey PRIMARY KEY (id);


--
-- Name: detalle_solicitud_formulario_respuesta detalle_solicitud_formulario_respuesta_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario_respuesta
    ADD CONSTRAINT detalle_solicitud_formulario_respuesta_pkey PRIMARY KEY (id);


--
-- Name: detalle_solicitud_apoyo detalle_solicitud_insumo_unico_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo
    ADD CONSTRAINT detalle_solicitud_insumo_unico_key UNIQUE (solicitud_id, insumo_id);


--
-- Name: discapacidad discapacidad_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discapacidad
    ADD CONSTRAINT discapacidad_nombre_key UNIQUE (nombre);


--
-- Name: discapacidad discapacidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discapacidad
    ADD CONSTRAINT discapacidad_pkey PRIMARY KEY (id);


--
-- Name: documento_persona documento_persona_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_persona
    ADD CONSTRAINT documento_persona_pkey PRIMARY KEY (id);


--
-- Name: documento_recepcion documento_recepcion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_recepcion
    ADD CONSTRAINT documento_recepcion_pkey PRIMARY KEY (id);


--
-- Name: documento_solicitud documento_solicitud_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_solicitud
    ADD CONSTRAINT documento_solicitud_pkey PRIMARY KEY (id);


--
-- Name: detalle_solicitud_formulario dsf_linea_formulario_unico_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario
    ADD CONSTRAINT dsf_linea_formulario_unico_key UNIQUE (detalle_solicitud_id, formulario_id);


--
-- Name: detalle_solicitud_formulario_respuesta dsfr_respuesta_unica_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario_respuesta
    ADD CONSTRAINT dsfr_respuesta_unica_key UNIQUE (detalle_solicitud_formulario_id, formulario_campo_id, numero_fila);


--
-- Name: encargado_menor encargado_menor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encargado_menor
    ADD CONSTRAINT encargado_menor_pkey PRIMARY KEY (menor_id, encargado_id);


--
-- Name: entrega entrega_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega
    ADD CONSTRAINT entrega_pkey PRIMARY KEY (id);


--
-- Name: estado_civil estado_civil_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_civil
    ADD CONSTRAINT estado_civil_nombre_key UNIQUE (nombre);


--
-- Name: estado_civil estado_civil_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_civil
    ADD CONSTRAINT estado_civil_pkey PRIMARY KEY (id);


--
-- Name: estado_contrato_prestamo estado_contrato_prestamo_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_contrato_prestamo
    ADD CONSTRAINT estado_contrato_prestamo_nombre_key UNIQUE (nombre);


--
-- Name: estado_contrato_prestamo estado_contrato_prestamo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_contrato_prestamo
    ADD CONSTRAINT estado_contrato_prestamo_pkey PRIMARY KEY (id);


--
-- Name: estado_solicitud_apoyo estado_solicitud_apoyo_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_solicitud_apoyo
    ADD CONSTRAINT estado_solicitud_apoyo_nombre_key UNIQUE (nombre);


--
-- Name: estado_solicitud_apoyo estado_solicitud_apoyo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_solicitud_apoyo
    ADD CONSTRAINT estado_solicitud_apoyo_pkey PRIMARY KEY (id);


--
-- Name: evidencia_contrato_prestamo evidencia_contrato_prestamo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_contrato_prestamo
    ADD CONSTRAINT evidencia_contrato_prestamo_pkey PRIMARY KEY (id);


--
-- Name: evidencia_entrega evidencia_entrega_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_entrega
    ADD CONSTRAINT evidencia_entrega_pkey PRIMARY KEY (id);


--
-- Name: formulario_campo_opcion fco_orden_unico_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo_opcion
    ADD CONSTRAINT fco_orden_unico_key UNIQUE (formulario_campo_id, orden);


--
-- Name: formulario_campo_opcion formulario_campo_opcion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo_opcion
    ADD CONSTRAINT formulario_campo_opcion_pkey PRIMARY KEY (id);


--
-- Name: formulario_campo formulario_campo_orden_unico_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo
    ADD CONSTRAINT formulario_campo_orden_unico_key UNIQUE (formulario_id, orden);


--
-- Name: formulario_campo formulario_campo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo
    ADD CONSTRAINT formulario_campo_pkey PRIMARY KEY (id);


--
-- Name: formulario formulario_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario
    ADD CONSTRAINT formulario_nombre_key UNIQUE (nombre);


--
-- Name: formulario formulario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario
    ADD CONSTRAINT formulario_pkey PRIMARY KEY (id);


--
-- Name: grado_academico grado_academico_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grado_academico
    ADD CONSTRAINT grado_academico_nombre_key UNIQUE (nombre);


--
-- Name: grado_academico grado_academico_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grado_academico
    ADD CONSTRAINT grado_academico_pkey PRIMARY KEY (id);


--
-- Name: institucion_donante institucion_donante_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institucion_donante
    ADD CONSTRAINT institucion_donante_nombre_key UNIQUE (nombre);


--
-- Name: institucion_donante institucion_donante_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institucion_donante
    ADD CONSTRAINT institucion_donante_pkey PRIMARY KEY (id);


--
-- Name: insumo insumo_nombre_categoria_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insumo
    ADD CONSTRAINT insumo_nombre_categoria_key UNIQUE (nombre, categoria_id);


--
-- Name: insumo insumo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insumo
    ADD CONSTRAINT insumo_pkey PRIMARY KEY (id);


--
-- Name: marca_insumo marca_insumo_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marca_insumo
    ADD CONSTRAINT marca_insumo_nombre_key UNIQUE (nombre);


--
-- Name: marca_insumo marca_insumo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marca_insumo
    ADD CONSTRAINT marca_insumo_pkey PRIMARY KEY (id);


--
-- Name: modalidad_solicitud modalidad_solicitud_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modalidad_solicitud
    ADD CONSTRAINT modalidad_solicitud_nombre_key UNIQUE (nombre);


--
-- Name: modalidad_solicitud modalidad_solicitud_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modalidad_solicitud
    ADD CONSTRAINT modalidad_solicitud_pkey PRIMARY KEY (id);


--
-- Name: multa_prestamo multa_prestamo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multa_prestamo
    ADD CONSTRAINT multa_prestamo_pkey PRIMARY KEY (id);


--
-- Name: municipio municipio_nombre_departamento_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipio
    ADD CONSTRAINT municipio_nombre_departamento_key UNIQUE (nombre, departamento_id);


--
-- Name: municipio municipio_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipio
    ADD CONSTRAINT municipio_pkey PRIMARY KEY (id);


--
-- Name: ocupacion ocupacion_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocupacion
    ADD CONSTRAINT ocupacion_nombre_key UNIQUE (nombre);


--
-- Name: ocupacion ocupacion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocupacion
    ADD CONSTRAINT ocupacion_pkey PRIMARY KEY (id);


--
-- Name: persona persona_cui_dpi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT persona_cui_dpi_key UNIQUE (cui_dpi);


--
-- Name: persona_discapacidad persona_discapacidad_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_discapacidad
    ADD CONSTRAINT persona_discapacidad_pkey PRIMARY KEY (persona_id, discapacidad_id);


--
-- Name: persona persona_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT persona_pkey PRIMARY KEY (id);


--
-- Name: presentacion_insumo presentacion_insumo_insumo_unidad_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presentacion_insumo
    ADD CONSTRAINT presentacion_insumo_insumo_unidad_key UNIQUE (insumo_id, unidad_medida_id);


--
-- Name: presentacion_insumo presentacion_insumo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presentacion_insumo
    ADD CONSTRAINT presentacion_insumo_pkey PRIMARY KEY (id);


--
-- Name: programa programa_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programa
    ADD CONSTRAINT programa_nombre_key UNIQUE (nombre);


--
-- Name: programa programa_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programa
    ADD CONSTRAINT programa_pkey PRIMARY KEY (id);


--
-- Name: recepcion_donacion_lote recepcion_donacion_lote_codigo_lote_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_donacion_lote
    ADD CONSTRAINT recepcion_donacion_lote_codigo_lote_key UNIQUE (codigo_lote);


--
-- Name: recepcion_donacion_lote recepcion_donacion_lote_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_donacion_lote
    ADD CONSTRAINT recepcion_donacion_lote_pkey PRIMARY KEY (id);


--
-- Name: receta_medica receta_medica_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receta_medica
    ADD CONSTRAINT receta_medica_pkey PRIMARY KEY (id);


--
-- Name: rol rol_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rol
    ADD CONSTRAINT rol_nombre_key UNIQUE (nombre);


--
-- Name: rol rol_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rol
    ADD CONSTRAINT rol_pkey PRIMARY KEY (id);


--
-- Name: sesion sesion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesion
    ADD CONSTRAINT sesion_pkey PRIMARY KEY (id);


--
-- Name: sesion sesion_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesion
    ADD CONSTRAINT sesion_token_hash_key UNIQUE (token_hash);


--
-- Name: solicitud_apoyo solicitud_apoyo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_apoyo
    ADD CONSTRAINT solicitud_apoyo_pkey PRIMARY KEY (id);


--
-- Name: tipo_accion_auditoria tipo_accion_auditoria_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_accion_auditoria
    ADD CONSTRAINT tipo_accion_auditoria_nombre_key UNIQUE (nombre);


--
-- Name: tipo_accion_auditoria tipo_accion_auditoria_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_accion_auditoria
    ADD CONSTRAINT tipo_accion_auditoria_pkey PRIMARY KEY (id);


--
-- Name: tipo_dato_campo_formulario tipo_dato_campo_formulario_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_dato_campo_formulario
    ADD CONSTRAINT tipo_dato_campo_formulario_nombre_key UNIQUE (nombre);


--
-- Name: tipo_dato_campo_formulario tipo_dato_campo_formulario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_dato_campo_formulario
    ADD CONSTRAINT tipo_dato_campo_formulario_pkey PRIMARY KEY (id);


--
-- Name: tipo_documento_persona tipo_documento_persona_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_documento_persona
    ADD CONSTRAINT tipo_documento_persona_nombre_key UNIQUE (nombre);


--
-- Name: tipo_documento_persona tipo_documento_persona_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_documento_persona
    ADD CONSTRAINT tipo_documento_persona_pkey PRIMARY KEY (id);


--
-- Name: tipo_evidencia_contrato tipo_evidencia_contrato_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_evidencia_contrato
    ADD CONSTRAINT tipo_evidencia_contrato_nombre_key UNIQUE (nombre);


--
-- Name: tipo_evidencia_contrato tipo_evidencia_contrato_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_evidencia_contrato
    ADD CONSTRAINT tipo_evidencia_contrato_pkey PRIMARY KEY (id);


--
-- Name: tipo_evidencia_entrega tipo_evidencia_entrega_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_evidencia_entrega
    ADD CONSTRAINT tipo_evidencia_entrega_nombre_key UNIQUE (nombre);


--
-- Name: tipo_evidencia_entrega tipo_evidencia_entrega_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_evidencia_entrega
    ADD CONSTRAINT tipo_evidencia_entrega_pkey PRIMARY KEY (id);


--
-- Name: tipo_genero tipo_genero_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_genero
    ADD CONSTRAINT tipo_genero_nombre_key UNIQUE (nombre);


--
-- Name: tipo_genero tipo_genero_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_genero
    ADD CONSTRAINT tipo_genero_pkey PRIMARY KEY (id);


--
-- Name: tipo_multa_prestamo tipo_multa_prestamo_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_multa_prestamo
    ADD CONSTRAINT tipo_multa_prestamo_nombre_key UNIQUE (nombre);


--
-- Name: tipo_multa_prestamo tipo_multa_prestamo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_multa_prestamo
    ADD CONSTRAINT tipo_multa_prestamo_pkey PRIMARY KEY (id);


--
-- Name: tipo_parentesco tipo_parentesco_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_parentesco
    ADD CONSTRAINT tipo_parentesco_nombre_key UNIQUE (nombre);


--
-- Name: tipo_parentesco tipo_parentesco_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_parentesco
    ADD CONSTRAINT tipo_parentesco_pkey PRIMARY KEY (id);


--
-- Name: unidad_medida unidad_medida_nombre_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidad_medida
    ADD CONSTRAINT unidad_medida_nombre_key UNIQUE (nombre);


--
-- Name: unidad_medida unidad_medida_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidad_medida
    ADD CONSTRAINT unidad_medida_pkey PRIMARY KEY (id);


--
-- Name: usuario usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_pkey PRIMARY KEY (id);


--
-- Name: usuario usuario_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT usuario_username_key UNIQUE (username);


--
-- Name: idx_auditoria_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_fecha ON public.auditoria_log USING btree (fecha_hora DESC);


--
-- Name: idx_auditoria_tabla_registro; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_tabla_registro ON public.auditoria_log USING btree (tabla_afectada, registro_id);


--
-- Name: idx_auditoria_tipo_accion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_tipo_accion ON public.auditoria_log USING btree (tipo_accion_id);


--
-- Name: idx_auditoria_usuario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auditoria_usuario ON public.auditoria_log USING btree (usuario_id) WHERE (usuario_id IS NOT NULL);


--
-- Name: idx_catalogo_valor_catalogo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catalogo_valor_catalogo ON public.catalogo_valor USING btree (catalogo_id);


--
-- Name: idx_cif_categoria; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cif_categoria ON public.categoria_insumo_formulario USING btree (categoria_insumo_id);


--
-- Name: idx_cif_formulario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cif_formulario ON public.categoria_insumo_formulario USING btree (formulario_id);


--
-- Name: idx_contacto_referencia_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacto_referencia_persona ON public.contacto_referencia_persona USING btree (persona_id);


--
-- Name: idx_contrato_prestamo_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contrato_prestamo_estado ON public.contrato_prestamo USING btree (estado_id) WHERE (activo = true);


--
-- Name: idx_contrato_prestamo_vencimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contrato_prestamo_vencimiento ON public.contrato_prestamo USING btree (fecha_devolucion_pactada) WHERE (activo = true);


--
-- Name: idx_detalle_entrega_entrega; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_entrega_entrega ON public.detalle_entrega USING btree (entrega_id);


--
-- Name: idx_detalle_entrega_insumo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_entrega_insumo ON public.detalle_entrega USING btree (insumo_id);


--
-- Name: idx_detalle_entrega_lote_lote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_entrega_lote_lote ON public.detalle_entrega_lote USING btree (detalle_inventario_lote_id);


--
-- Name: idx_detalle_entrega_lote_renglon; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_entrega_lote_renglon ON public.detalle_entrega_lote USING btree (detalle_entrega_id);


--
-- Name: idx_detalle_entrega_solicitud; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_entrega_solicitud ON public.detalle_entrega USING btree (detalle_solicitud_id);


--
-- Name: idx_detalle_inventario_fifo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_inventario_fifo ON public.detalle_inventario_lote USING btree (insumo_id, activo, fecha_caducidad) WHERE ((activo = true) AND (cantidad_disponible > 0));


--
-- Name: idx_detalle_inventario_marca; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_inventario_marca ON public.detalle_inventario_lote USING btree (marca_id) WHERE (marca_id IS NOT NULL);


--
-- Name: idx_detalle_inventario_recepcion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_inventario_recepcion ON public.detalle_inventario_lote USING btree (recepcion_lote_id);


--
-- Name: idx_detalle_solicitud_insumo_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_solicitud_insumo_estado ON public.detalle_solicitud_apoyo USING btree (insumo_id, estado_id) WHERE (activo = true);


--
-- Name: idx_detalle_solicitud_solicitud; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_detalle_solicitud_solicitud ON public.detalle_solicitud_apoyo USING btree (solicitud_id);


--
-- Name: idx_documento_persona_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documento_persona_persona ON public.documento_persona USING btree (persona_id);


--
-- Name: idx_documento_recepcion_recepcion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documento_recepcion_recepcion ON public.documento_recepcion USING btree (recepcion_lote_id);


--
-- Name: idx_documento_solicitud_solicitud; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documento_solicitud_solicitud ON public.documento_solicitud USING btree (solicitud_id);


--
-- Name: idx_dsa_modalidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsa_modalidad ON public.detalle_solicitud_apoyo USING btree (modalidad_solicitud_id);


--
-- Name: idx_dsa_presentacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsa_presentacion ON public.detalle_solicitud_apoyo USING btree (presentacion_solicitud_id) WHERE (presentacion_solicitud_id IS NOT NULL);


--
-- Name: idx_dsf_linea; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsf_linea ON public.detalle_solicitud_formulario USING btree (detalle_solicitud_id);


--
-- Name: idx_dsfr_campo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsfr_campo ON public.detalle_solicitud_formulario_respuesta USING btree (formulario_campo_id);


--
-- Name: idx_dsfr_detalle_formulario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dsfr_detalle_formulario ON public.detalle_solicitud_formulario_respuesta USING btree (detalle_solicitud_formulario_id);


--
-- Name: idx_entrega_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entrega_fecha ON public.entrega USING btree (fecha_entrega);


--
-- Name: idx_entrega_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entrega_persona ON public.entrega USING btree (persona_id);


--
-- Name: idx_entrega_receptor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entrega_receptor ON public.entrega USING btree (persona_receptor_id) WHERE (persona_receptor_id IS NOT NULL);


--
-- Name: idx_evidencia_contrato_prestamo_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidencia_contrato_prestamo_contrato ON public.evidencia_contrato_prestamo USING btree (contrato_prestamo_id);


--
-- Name: idx_evidencia_entrega_entrega; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_evidencia_entrega_entrega ON public.evidencia_entrega USING btree (entrega_id);


--
-- Name: idx_formulario_campo_catalogo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_formulario_campo_catalogo ON public.formulario_campo USING btree (catalogo_id);


--
-- Name: idx_formulario_campo_formulario; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_formulario_campo_formulario ON public.formulario_campo USING btree (formulario_id);


--
-- Name: idx_formulario_campo_opcion_campo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_formulario_campo_opcion_campo ON public.formulario_campo_opcion USING btree (formulario_campo_id);


--
-- Name: idx_multa_prestamo_contrato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multa_prestamo_contrato ON public.multa_prestamo USING btree (contrato_prestamo_id);


--
-- Name: idx_multa_prestamo_pendientes; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_multa_prestamo_pendientes ON public.multa_prestamo USING btree (pagada) WHERE ((activo = true) AND (pagada = false));


--
-- Name: idx_municipio_departamento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_municipio_departamento ON public.municipio USING btree (departamento_id);


--
-- Name: idx_persona_comunidad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_persona_comunidad ON public.persona USING btree (comunidad_id);


--
-- Name: idx_persona_cui_dpi; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_persona_cui_dpi ON public.persona USING btree (cui_dpi) WHERE (cui_dpi IS NOT NULL);


--
-- Name: idx_persona_estado_civil; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_persona_estado_civil ON public.persona USING btree (estado_civil_id) WHERE (estado_civil_id IS NOT NULL);


--
-- Name: idx_persona_grado_academico; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_persona_grado_academico ON public.persona USING btree (grado_academico_id) WHERE (grado_academico_id IS NOT NULL);


--
-- Name: idx_persona_municipio_nacimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_persona_municipio_nacimiento ON public.persona USING btree (municipio_nacimiento_id) WHERE (municipio_nacimiento_id IS NOT NULL);


--
-- Name: idx_persona_nombres; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_persona_nombres ON public.persona USING gin (((((nombres)::text || ' '::text) || (apellidos)::text)) public.gin_trgm_ops);


--
-- Name: idx_persona_ocupacion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_persona_ocupacion ON public.persona USING btree (ocupacion_id) WHERE (ocupacion_id IS NOT NULL);


--
-- Name: idx_presentacion_default_unica; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_presentacion_default_unica ON public.presentacion_insumo USING btree (insumo_id) WHERE (es_default = true);


--
-- Name: idx_presentacion_insumo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_presentacion_insumo ON public.presentacion_insumo USING btree (insumo_id);


--
-- Name: idx_recepcion_codigo_lote; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recepcion_codigo_lote ON public.recepcion_donacion_lote USING btree (codigo_lote) WHERE (codigo_lote IS NOT NULL);


--
-- Name: idx_receta_medica_solicitud; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_receta_medica_solicitud ON public.receta_medica USING btree (solicitud_id);


--
-- Name: idx_sesion_usuario_activas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesion_usuario_activas ON public.sesion USING btree (usuario_id) WHERE (revocada_en IS NULL);


--
-- Name: idx_solicitud_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitud_estado ON public.solicitud_apoyo USING btree (estado_id) WHERE (activo = true);


--
-- Name: idx_solicitud_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitud_persona ON public.solicitud_apoyo USING btree (persona_id);


--
-- Name: idx_solicitud_programa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_solicitud_programa ON public.solicitud_apoyo USING btree (programa_id);


--
-- Name: idx_usuario_programa; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usuario_programa ON public.usuario USING btree (programa_id) WHERE (programa_id IS NOT NULL);


--
-- Name: uq_detalle_entrega_insumo_por_entrega; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_detalle_entrega_insumo_por_entrega ON public.detalle_entrega USING btree (entrega_id, insumo_id);


--
-- Name: detalle_entrega trg_actualizar_linea_al_anular_renglon; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_actualizar_linea_al_anular_renglon AFTER UPDATE ON public.detalle_entrega FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_linea_al_anular_renglon();


--
-- Name: detalle_entrega trg_actualizar_linea_desde_entrega; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_actualizar_linea_desde_entrega AFTER INSERT ON public.detalle_entrega FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_linea_desde_entrega();


--
-- Name: catalogo trg_auditoria_catalogo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_catalogo AFTER INSERT OR DELETE OR UPDATE ON public.catalogo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: catalogo_valor trg_auditoria_catalogo_valor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_catalogo_valor AFTER INSERT OR DELETE OR UPDATE ON public.catalogo_valor FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: categoria_insumo trg_auditoria_categoria_insumo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_categoria_insumo AFTER INSERT OR DELETE OR UPDATE ON public.categoria_insumo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: categoria_insumo_formulario trg_auditoria_categoria_insumo_formulario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_categoria_insumo_formulario AFTER INSERT OR DELETE OR UPDATE ON public.categoria_insumo_formulario FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: comunidad trg_auditoria_comunidad; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_comunidad AFTER INSERT OR DELETE OR UPDATE ON public.comunidad FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: contacto_referencia_persona trg_auditoria_contacto_referencia_persona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_contacto_referencia_persona AFTER INSERT OR DELETE OR UPDATE ON public.contacto_referencia_persona FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: contrato_prestamo trg_auditoria_contrato_prestamo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_contrato_prestamo AFTER INSERT OR DELETE OR UPDATE ON public.contrato_prestamo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: departamento trg_auditoria_departamento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_departamento AFTER INSERT OR DELETE OR UPDATE ON public.departamento FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: detalle_entrega trg_auditoria_detalle_entrega; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_detalle_entrega AFTER INSERT OR DELETE OR UPDATE ON public.detalle_entrega FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: detalle_entrega_lote trg_auditoria_detalle_entrega_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_detalle_entrega_lote AFTER INSERT OR DELETE OR UPDATE ON public.detalle_entrega_lote FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: detalle_inventario_lote trg_auditoria_detalle_inventario_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_detalle_inventario_lote AFTER INSERT OR DELETE OR UPDATE ON public.detalle_inventario_lote FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: detalle_solicitud_apoyo trg_auditoria_detalle_solicitud_apoyo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_detalle_solicitud_apoyo AFTER INSERT OR DELETE OR UPDATE ON public.detalle_solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: detalle_solicitud_formulario trg_auditoria_detalle_solicitud_formulario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_detalle_solicitud_formulario AFTER INSERT OR DELETE OR UPDATE ON public.detalle_solicitud_formulario FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: detalle_solicitud_formulario_respuesta trg_auditoria_detalle_solicitud_formulario_respuesta; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_detalle_solicitud_formulario_respuesta AFTER INSERT OR DELETE OR UPDATE ON public.detalle_solicitud_formulario_respuesta FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: discapacidad trg_auditoria_discapacidad; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_discapacidad AFTER INSERT OR DELETE OR UPDATE ON public.discapacidad FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: documento_persona trg_auditoria_documento_persona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_documento_persona AFTER INSERT OR DELETE OR UPDATE ON public.documento_persona FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: documento_recepcion trg_auditoria_documento_recepcion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_documento_recepcion AFTER INSERT OR DELETE OR UPDATE ON public.documento_recepcion FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: documento_solicitud trg_auditoria_documento_solicitud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_documento_solicitud AFTER INSERT OR DELETE OR UPDATE ON public.documento_solicitud FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: encargado_menor trg_auditoria_encargado_menor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_encargado_menor AFTER INSERT OR DELETE OR UPDATE ON public.encargado_menor FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: entrega trg_auditoria_entrega; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_entrega AFTER INSERT OR DELETE OR UPDATE ON public.entrega FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: estado_civil trg_auditoria_estado_civil; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_estado_civil AFTER INSERT OR DELETE OR UPDATE ON public.estado_civil FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: estado_contrato_prestamo trg_auditoria_estado_contrato_prestamo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_estado_contrato_prestamo AFTER INSERT OR DELETE OR UPDATE ON public.estado_contrato_prestamo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: estado_solicitud_apoyo trg_auditoria_estado_solicitud_apoyo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_estado_solicitud_apoyo AFTER INSERT OR DELETE OR UPDATE ON public.estado_solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: evidencia_contrato_prestamo trg_auditoria_evidencia_contrato_prestamo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_evidencia_contrato_prestamo AFTER INSERT OR DELETE OR UPDATE ON public.evidencia_contrato_prestamo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: evidencia_entrega trg_auditoria_evidencia_entrega; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_evidencia_entrega AFTER INSERT OR DELETE OR UPDATE ON public.evidencia_entrega FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: formulario trg_auditoria_formulario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_formulario AFTER INSERT OR DELETE OR UPDATE ON public.formulario FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: formulario_campo trg_auditoria_formulario_campo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_formulario_campo AFTER INSERT OR DELETE OR UPDATE ON public.formulario_campo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: formulario_campo_opcion trg_auditoria_formulario_campo_opcion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_formulario_campo_opcion AFTER INSERT OR DELETE OR UPDATE ON public.formulario_campo_opcion FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: grado_academico trg_auditoria_grado_academico; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_grado_academico AFTER INSERT OR DELETE OR UPDATE ON public.grado_academico FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: institucion_donante trg_auditoria_institucion_donante; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_institucion_donante AFTER INSERT OR DELETE OR UPDATE ON public.institucion_donante FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: insumo trg_auditoria_insumo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_insumo AFTER INSERT OR DELETE OR UPDATE ON public.insumo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: marca_insumo trg_auditoria_marca_insumo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_marca_insumo AFTER INSERT OR DELETE OR UPDATE ON public.marca_insumo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: modalidad_solicitud trg_auditoria_modalidad_solicitud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_modalidad_solicitud AFTER INSERT OR DELETE OR UPDATE ON public.modalidad_solicitud FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: multa_prestamo trg_auditoria_multa_prestamo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_multa_prestamo AFTER INSERT OR DELETE OR UPDATE ON public.multa_prestamo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: municipio trg_auditoria_municipio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_municipio AFTER INSERT OR DELETE OR UPDATE ON public.municipio FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: ocupacion trg_auditoria_ocupacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_ocupacion AFTER INSERT OR DELETE OR UPDATE ON public.ocupacion FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: persona trg_auditoria_persona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_persona AFTER INSERT OR DELETE OR UPDATE ON public.persona FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: persona_discapacidad trg_auditoria_persona_discapacidad; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_persona_discapacidad AFTER INSERT OR DELETE OR UPDATE ON public.persona_discapacidad FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: presentacion_insumo trg_auditoria_presentacion_insumo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_presentacion_insumo AFTER INSERT OR DELETE OR UPDATE ON public.presentacion_insumo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: programa trg_auditoria_programa; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_programa AFTER INSERT OR DELETE OR UPDATE ON public.programa FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: recepcion_donacion_lote trg_auditoria_recepcion_donacion_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_recepcion_donacion_lote AFTER INSERT OR DELETE OR UPDATE ON public.recepcion_donacion_lote FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: receta_medica trg_auditoria_receta_medica; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_receta_medica AFTER INSERT OR DELETE OR UPDATE ON public.receta_medica FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: rol trg_auditoria_rol; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_rol AFTER INSERT OR DELETE OR UPDATE ON public.rol FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: sesion trg_auditoria_sesion_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_sesion_insert AFTER INSERT ON public.sesion FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: sesion trg_auditoria_sesion_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_sesion_update AFTER UPDATE ON public.sesion FOR EACH ROW WHEN (((((to_jsonb(old.*) - 'ultima_actividad'::text) - 'updated_at'::text) - 'updated_by'::text) IS DISTINCT FROM (((to_jsonb(new.*) - 'ultima_actividad'::text) - 'updated_at'::text) - 'updated_by'::text))) EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: solicitud_apoyo trg_auditoria_solicitud_apoyo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_solicitud_apoyo AFTER INSERT OR DELETE OR UPDATE ON public.solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: tipo_accion_auditoria trg_auditoria_tipo_accion_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_tipo_accion_auditoria AFTER INSERT OR DELETE OR UPDATE ON public.tipo_accion_auditoria FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: tipo_dato_campo_formulario trg_auditoria_tipo_dato_campo_formulario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_tipo_dato_campo_formulario AFTER INSERT OR DELETE OR UPDATE ON public.tipo_dato_campo_formulario FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: tipo_documento_persona trg_auditoria_tipo_documento_persona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_tipo_documento_persona AFTER INSERT OR DELETE OR UPDATE ON public.tipo_documento_persona FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: tipo_evidencia_contrato trg_auditoria_tipo_evidencia_contrato; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_tipo_evidencia_contrato AFTER INSERT OR DELETE OR UPDATE ON public.tipo_evidencia_contrato FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: tipo_evidencia_entrega trg_auditoria_tipo_evidencia_entrega; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_tipo_evidencia_entrega AFTER INSERT OR DELETE OR UPDATE ON public.tipo_evidencia_entrega FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: tipo_genero trg_auditoria_tipo_genero; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_tipo_genero AFTER INSERT OR DELETE OR UPDATE ON public.tipo_genero FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: tipo_multa_prestamo trg_auditoria_tipo_multa_prestamo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_tipo_multa_prestamo AFTER INSERT OR DELETE OR UPDATE ON public.tipo_multa_prestamo FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: tipo_parentesco trg_auditoria_tipo_parentesco; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_tipo_parentesco AFTER INSERT OR DELETE OR UPDATE ON public.tipo_parentesco FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: unidad_medida trg_auditoria_unidad_medida; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_unidad_medida AFTER INSERT OR DELETE OR UPDATE ON public.unidad_medida FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: usuario trg_auditoria_usuario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_auditoria_usuario AFTER INSERT OR DELETE OR UPDATE ON public.usuario FOR EACH ROW EXECUTE FUNCTION public.fn_auditoria();


--
-- Name: detalle_entrega_lote trg_calcular_cantidad_entregada_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calcular_cantidad_entregada_lote BEFORE INSERT ON public.detalle_entrega_lote FOR EACH ROW EXECUTE FUNCTION public.fn_calcular_cantidad_entregada();


--
-- Name: detalle_inventario_lote trg_calcular_recepcion_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_calcular_recepcion_lote BEFORE INSERT ON public.detalle_inventario_lote FOR EACH ROW EXECUTE FUNCTION public.fn_calcular_recepcion_lote();


--
-- Name: detalle_entrega_lote trg_descontar_inventario_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_descontar_inventario_lote BEFORE INSERT ON public.detalle_entrega_lote FOR EACH ROW EXECUTE FUNCTION public.fn_descontar_inventario();


--
-- Name: detalle_solicitud_apoyo trg_estado_inicial_linea_solicitud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_estado_inicial_linea_solicitud BEFORE INSERT ON public.detalle_solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_estado_inicial_linea_solicitud();


--
-- Name: detalle_solicitud_apoyo trg_modalidad_inmutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_modalidad_inmutable BEFORE UPDATE ON public.detalle_solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_modalidad_inmutable();


--
-- Name: detalle_entrega trg_restaurar_inventario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_restaurar_inventario BEFORE UPDATE ON public.detalle_entrega FOR EACH ROW EXECUTE FUNCTION public.fn_restaurar_inventario();


--
-- Name: catalogo trg_updated_at_catalogo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_catalogo BEFORE UPDATE ON public.catalogo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: catalogo_valor trg_updated_at_catalogo_valor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_catalogo_valor BEFORE UPDATE ON public.catalogo_valor FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: categoria_insumo trg_updated_at_categoria_insumo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_categoria_insumo BEFORE UPDATE ON public.categoria_insumo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: categoria_insumo_formulario trg_updated_at_categoria_insumo_formulario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_categoria_insumo_formulario BEFORE UPDATE ON public.categoria_insumo_formulario FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: comunidad trg_updated_at_comunidad; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_comunidad BEFORE UPDATE ON public.comunidad FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: contacto_referencia_persona trg_updated_at_contacto_referencia_persona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_contacto_referencia_persona BEFORE UPDATE ON public.contacto_referencia_persona FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: contrato_prestamo trg_updated_at_contrato_prestamo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_contrato_prestamo BEFORE UPDATE ON public.contrato_prestamo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: departamento trg_updated_at_departamento; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_departamento BEFORE UPDATE ON public.departamento FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: detalle_entrega trg_updated_at_detalle_entrega; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_detalle_entrega BEFORE UPDATE ON public.detalle_entrega FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: detalle_entrega_lote trg_updated_at_detalle_entrega_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_detalle_entrega_lote BEFORE UPDATE ON public.detalle_entrega_lote FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: detalle_inventario_lote trg_updated_at_detalle_inventario_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_detalle_inventario_lote BEFORE UPDATE ON public.detalle_inventario_lote FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: detalle_solicitud_apoyo trg_updated_at_detalle_solicitud_apoyo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_detalle_solicitud_apoyo BEFORE UPDATE ON public.detalle_solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: detalle_solicitud_formulario trg_updated_at_detalle_solicitud_formulario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_detalle_solicitud_formulario BEFORE UPDATE ON public.detalle_solicitud_formulario FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: detalle_solicitud_formulario_respuesta trg_updated_at_detalle_solicitud_formulario_respuesta; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_detalle_solicitud_formulario_respuesta BEFORE UPDATE ON public.detalle_solicitud_formulario_respuesta FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: discapacidad trg_updated_at_discapacidad; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_discapacidad BEFORE UPDATE ON public.discapacidad FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: documento_persona trg_updated_at_documento_persona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_documento_persona BEFORE UPDATE ON public.documento_persona FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: documento_recepcion trg_updated_at_documento_recepcion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_documento_recepcion BEFORE UPDATE ON public.documento_recepcion FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: documento_solicitud trg_updated_at_documento_solicitud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_documento_solicitud BEFORE UPDATE ON public.documento_solicitud FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: encargado_menor trg_updated_at_encargado_menor; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_encargado_menor BEFORE UPDATE ON public.encargado_menor FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: entrega trg_updated_at_entrega; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_entrega BEFORE UPDATE ON public.entrega FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: estado_civil trg_updated_at_estado_civil; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_estado_civil BEFORE UPDATE ON public.estado_civil FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: estado_contrato_prestamo trg_updated_at_estado_contrato_prestamo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_estado_contrato_prestamo BEFORE UPDATE ON public.estado_contrato_prestamo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: estado_solicitud_apoyo trg_updated_at_estado_solicitud_apoyo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_estado_solicitud_apoyo BEFORE UPDATE ON public.estado_solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: evidencia_contrato_prestamo trg_updated_at_evidencia_contrato_prestamo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_evidencia_contrato_prestamo BEFORE UPDATE ON public.evidencia_contrato_prestamo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: evidencia_entrega trg_updated_at_evidencia_entrega; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_evidencia_entrega BEFORE UPDATE ON public.evidencia_entrega FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: formulario trg_updated_at_formulario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_formulario BEFORE UPDATE ON public.formulario FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: formulario_campo trg_updated_at_formulario_campo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_formulario_campo BEFORE UPDATE ON public.formulario_campo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: formulario_campo_opcion trg_updated_at_formulario_campo_opcion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_formulario_campo_opcion BEFORE UPDATE ON public.formulario_campo_opcion FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: grado_academico trg_updated_at_grado_academico; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_grado_academico BEFORE UPDATE ON public.grado_academico FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: institucion_donante trg_updated_at_institucion_donante; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_institucion_donante BEFORE UPDATE ON public.institucion_donante FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: insumo trg_updated_at_insumo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_insumo BEFORE UPDATE ON public.insumo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: marca_insumo trg_updated_at_marca_insumo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_marca_insumo BEFORE UPDATE ON public.marca_insumo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: modalidad_solicitud trg_updated_at_modalidad_solicitud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_modalidad_solicitud BEFORE UPDATE ON public.modalidad_solicitud FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: multa_prestamo trg_updated_at_multa_prestamo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_multa_prestamo BEFORE UPDATE ON public.multa_prestamo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: municipio trg_updated_at_municipio; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_municipio BEFORE UPDATE ON public.municipio FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: ocupacion trg_updated_at_ocupacion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_ocupacion BEFORE UPDATE ON public.ocupacion FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: persona trg_updated_at_persona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_persona BEFORE UPDATE ON public.persona FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: persona_discapacidad trg_updated_at_persona_discapacidad; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_persona_discapacidad BEFORE UPDATE ON public.persona_discapacidad FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: presentacion_insumo trg_updated_at_presentacion_insumo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_presentacion_insumo BEFORE UPDATE ON public.presentacion_insumo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: programa trg_updated_at_programa; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_programa BEFORE UPDATE ON public.programa FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: recepcion_donacion_lote trg_updated_at_recepcion_donacion_lote; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_recepcion_donacion_lote BEFORE UPDATE ON public.recepcion_donacion_lote FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: receta_medica trg_updated_at_receta_medica; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_receta_medica BEFORE UPDATE ON public.receta_medica FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: rol trg_updated_at_rol; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_rol BEFORE UPDATE ON public.rol FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: sesion trg_updated_at_sesion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_sesion BEFORE UPDATE ON public.sesion FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: solicitud_apoyo trg_updated_at_solicitud_apoyo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_solicitud_apoyo BEFORE UPDATE ON public.solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: tipo_accion_auditoria trg_updated_at_tipo_accion_auditoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_tipo_accion_auditoria BEFORE UPDATE ON public.tipo_accion_auditoria FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: tipo_dato_campo_formulario trg_updated_at_tipo_dato_campo_formulario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_tipo_dato_campo_formulario BEFORE UPDATE ON public.tipo_dato_campo_formulario FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: tipo_documento_persona trg_updated_at_tipo_documento_persona; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_tipo_documento_persona BEFORE UPDATE ON public.tipo_documento_persona FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: tipo_evidencia_contrato trg_updated_at_tipo_evidencia_contrato; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_tipo_evidencia_contrato BEFORE UPDATE ON public.tipo_evidencia_contrato FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: tipo_evidencia_entrega trg_updated_at_tipo_evidencia_entrega; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_tipo_evidencia_entrega BEFORE UPDATE ON public.tipo_evidencia_entrega FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: tipo_genero trg_updated_at_tipo_genero; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_tipo_genero BEFORE UPDATE ON public.tipo_genero FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: tipo_multa_prestamo trg_updated_at_tipo_multa_prestamo; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_tipo_multa_prestamo BEFORE UPDATE ON public.tipo_multa_prestamo FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: tipo_parentesco trg_updated_at_tipo_parentesco; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_tipo_parentesco BEFORE UPDATE ON public.tipo_parentesco FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: unidad_medida trg_updated_at_unidad_medida; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_unidad_medida BEFORE UPDATE ON public.unidad_medida FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: usuario trg_updated_at_usuario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_updated_at_usuario BEFORE UPDATE ON public.usuario FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: formulario_campo trg_validar_catalogo_campo_formulario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_catalogo_campo_formulario BEFORE UPDATE ON public.formulario_campo FOR EACH ROW WHEN ((new.catalogo_id IS DISTINCT FROM old.catalogo_id)) EXECUTE FUNCTION public.fn_validar_catalogo_campo_formulario();


--
-- Name: detalle_solicitud_apoyo trg_validar_modalidad_categoria; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_modalidad_categoria BEFORE INSERT OR UPDATE ON public.detalle_solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_validar_modalidad_categoria();


--
-- Name: formulario_campo_opcion trg_validar_opciones_campo_formulario; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_opciones_campo_formulario BEFORE INSERT OR UPDATE ON public.formulario_campo_opcion FOR EACH ROW EXECUTE FUNCTION public.fn_validar_opciones_campo_formulario();


--
-- Name: detalle_entrega trg_validar_origen_unico_entrega; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_origen_unico_entrega BEFORE INSERT ON public.detalle_entrega FOR EACH ROW EXECUTE FUNCTION public.fn_validar_origen_unico_entrega();


--
-- Name: detalle_solicitud_apoyo trg_validar_presentacion_linea_solicitud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_presentacion_linea_solicitud BEFORE INSERT OR UPDATE ON public.detalle_solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_validar_presentacion_linea_solicitud();


--
-- Name: detalle_inventario_lote trg_validar_serie_por_unidad; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_serie_por_unidad BEFORE INSERT OR UPDATE ON public.detalle_inventario_lote FOR EACH ROW EXECUTE FUNCTION public.fn_validar_serie_por_unidad();


--
-- Name: detalle_solicitud_apoyo trg_validar_stock_linea_solicitud; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_validar_stock_linea_solicitud BEFORE INSERT ON public.detalle_solicitud_apoyo FOR EACH ROW EXECUTE FUNCTION public.fn_validar_stock_linea_solicitud();


--
-- Name: auditoria_log fk_auditoria_tipo_accion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_log
    ADD CONSTRAINT fk_auditoria_tipo_accion FOREIGN KEY (tipo_accion_id) REFERENCES public.tipo_accion_auditoria(id) ON DELETE RESTRICT;


--
-- Name: auditoria_log fk_auditoria_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auditoria_log
    ADD CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: catalogo fk_cat2_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo
    ADD CONSTRAINT fk_cat2_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: catalogo fk_cat2_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo
    ADD CONSTRAINT fk_cat2_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: categoria_insumo fk_cat_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo
    ADD CONSTRAINT fk_cat_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: categoria_insumo fk_cat_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo
    ADD CONSTRAINT fk_cat_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: catalogo_valor fk_catv_catalogo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo_valor
    ADD CONSTRAINT fk_catv_catalogo FOREIGN KEY (catalogo_id) REFERENCES public.catalogo(id) ON DELETE CASCADE;


--
-- Name: catalogo_valor fk_catv_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo_valor
    ADD CONSTRAINT fk_catv_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: catalogo_valor fk_catv_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalogo_valor
    ADD CONSTRAINT fk_catv_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: categoria_insumo_formulario fk_cif_categoria; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo_formulario
    ADD CONSTRAINT fk_cif_categoria FOREIGN KEY (categoria_insumo_id) REFERENCES public.categoria_insumo(id) ON DELETE CASCADE;


--
-- Name: categoria_insumo_formulario fk_cif_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo_formulario
    ADD CONSTRAINT fk_cif_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: categoria_insumo_formulario fk_cif_formulario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo_formulario
    ADD CONSTRAINT fk_cif_formulario FOREIGN KEY (formulario_id) REFERENCES public.formulario(id) ON DELETE CASCADE;


--
-- Name: categoria_insumo_formulario fk_cif_modalidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo_formulario
    ADD CONSTRAINT fk_cif_modalidad FOREIGN KEY (modalidad_solicitud_id) REFERENCES public.modalidad_solicitud(id) ON DELETE RESTRICT;


--
-- Name: categoria_insumo_formulario fk_cif_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categoria_insumo_formulario
    ADD CONSTRAINT fk_cif_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: comunidad fk_com_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunidad
    ADD CONSTRAINT fk_com_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: comunidad fk_com_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunidad
    ADD CONSTRAINT fk_com_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: comunidad fk_comunidad_municipio; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comunidad
    ADD CONSTRAINT fk_comunidad_municipio FOREIGN KEY (municipio_id) REFERENCES public.municipio(id) ON DELETE RESTRICT;


--
-- Name: contrato_prestamo fk_cp_contrato_anterior; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_prestamo
    ADD CONSTRAINT fk_cp_contrato_anterior FOREIGN KEY (contrato_anterior_id) REFERENCES public.contrato_prestamo(id) ON DELETE RESTRICT;


--
-- Name: contrato_prestamo fk_cp_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_prestamo
    ADD CONSTRAINT fk_cp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: contrato_prestamo fk_cp_detalle_entrega; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_prestamo
    ADD CONSTRAINT fk_cp_detalle_entrega FOREIGN KEY (detalle_entrega_id) REFERENCES public.detalle_entrega(id) ON DELETE RESTRICT;


--
-- Name: contrato_prestamo fk_cp_estado; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_prestamo
    ADD CONSTRAINT fk_cp_estado FOREIGN KEY (estado_id) REFERENCES public.estado_contrato_prestamo(id) ON DELETE RESTRICT;


--
-- Name: contrato_prestamo fk_cp_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contrato_prestamo
    ADD CONSTRAINT fk_cp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: contacto_referencia_persona fk_crp_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacto_referencia_persona
    ADD CONSTRAINT fk_crp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: contacto_referencia_persona fk_crp_persona; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacto_referencia_persona
    ADD CONSTRAINT fk_crp_persona FOREIGN KEY (persona_id) REFERENCES public.persona(id) ON DELETE CASCADE;


--
-- Name: contacto_referencia_persona fk_crp_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacto_referencia_persona
    ADD CONSTRAINT fk_crp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: detalle_entrega fk_de_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega
    ADD CONSTRAINT fk_de_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: detalle_entrega fk_de_detalle_solicitud; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega
    ADD CONSTRAINT fk_de_detalle_solicitud FOREIGN KEY (detalle_solicitud_id) REFERENCES public.detalle_solicitud_apoyo(id) ON DELETE RESTRICT;


--
-- Name: detalle_entrega fk_de_entrega; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega
    ADD CONSTRAINT fk_de_entrega FOREIGN KEY (entrega_id) REFERENCES public.entrega(id) ON DELETE RESTRICT;


--
-- Name: detalle_entrega fk_de_insumo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega
    ADD CONSTRAINT fk_de_insumo FOREIGN KEY (insumo_id) REFERENCES public.insumo(id) ON DELETE RESTRICT;


--
-- Name: detalle_entrega fk_de_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega
    ADD CONSTRAINT fk_de_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: detalle_entrega_lote fk_del_detalle_entrega; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega_lote
    ADD CONSTRAINT fk_del_detalle_entrega FOREIGN KEY (detalle_entrega_id) REFERENCES public.detalle_entrega(id) ON DELETE RESTRICT;


--
-- Name: departamento fk_depto_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departamento
    ADD CONSTRAINT fk_depto_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: departamento fk_depto_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.departamento
    ADD CONSTRAINT fk_depto_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: detalle_entrega_lote fk_det_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega_lote
    ADD CONSTRAINT fk_det_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: detalle_entrega_lote fk_det_lote; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega_lote
    ADD CONSTRAINT fk_det_lote FOREIGN KEY (detalle_inventario_lote_id) REFERENCES public.detalle_inventario_lote(id) ON DELETE RESTRICT;


--
-- Name: detalle_entrega_lote fk_det_presentacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega_lote
    ADD CONSTRAINT fk_det_presentacion FOREIGN KEY (presentacion_despacho_id) REFERENCES public.presentacion_insumo(id) ON DELETE RESTRICT;


--
-- Name: detalle_entrega_lote fk_det_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_entrega_lote
    ADD CONSTRAINT fk_det_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: detalle_inventario_lote fk_detalle_lote_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_inventario_lote
    ADD CONSTRAINT fk_detalle_lote_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: detalle_inventario_lote fk_detalle_lote_insumo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_inventario_lote
    ADD CONSTRAINT fk_detalle_lote_insumo FOREIGN KEY (insumo_id) REFERENCES public.insumo(id) ON DELETE RESTRICT;


--
-- Name: detalle_inventario_lote fk_detalle_lote_presentacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_inventario_lote
    ADD CONSTRAINT fk_detalle_lote_presentacion FOREIGN KEY (presentacion_recepcion_id) REFERENCES public.presentacion_insumo(id) ON DELETE RESTRICT;


--
-- Name: detalle_inventario_lote fk_detalle_lote_recepcion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_inventario_lote
    ADD CONSTRAINT fk_detalle_lote_recepcion FOREIGN KEY (recepcion_lote_id) REFERENCES public.recepcion_donacion_lote(id) ON DELETE RESTRICT;


--
-- Name: detalle_inventario_lote fk_detalle_lote_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_inventario_lote
    ADD CONSTRAINT fk_detalle_lote_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: detalle_inventario_lote fk_dil_marca; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_inventario_lote
    ADD CONSTRAINT fk_dil_marca FOREIGN KEY (marca_id) REFERENCES public.marca_insumo(id) ON DELETE RESTRICT;


--
-- Name: discapacidad fk_dis_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discapacidad
    ADD CONSTRAINT fk_dis_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: discapacidad fk_dis_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discapacidad
    ADD CONSTRAINT fk_dis_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: documento_persona fk_dp_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_persona
    ADD CONSTRAINT fk_dp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: documento_persona fk_dp_persona; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_persona
    ADD CONSTRAINT fk_dp_persona FOREIGN KEY (persona_id) REFERENCES public.persona(id) ON DELETE CASCADE;


--
-- Name: documento_persona fk_dp_tipo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_persona
    ADD CONSTRAINT fk_dp_tipo FOREIGN KEY (tipo_documento_id) REFERENCES public.tipo_documento_persona(id) ON DELETE RESTRICT;


--
-- Name: documento_persona fk_dp_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_persona
    ADD CONSTRAINT fk_dp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: documento_recepcion fk_dr_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_recepcion
    ADD CONSTRAINT fk_dr_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: documento_recepcion fk_dr_recepcion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_recepcion
    ADD CONSTRAINT fk_dr_recepcion FOREIGN KEY (recepcion_lote_id) REFERENCES public.recepcion_donacion_lote(id) ON DELETE CASCADE;


--
-- Name: documento_recepcion fk_dr_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_recepcion
    ADD CONSTRAINT fk_dr_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: documento_solicitud fk_ds_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_solicitud
    ADD CONSTRAINT fk_ds_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: documento_solicitud fk_ds_formulario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_solicitud
    ADD CONSTRAINT fk_ds_formulario FOREIGN KEY (formulario_id) REFERENCES public.formulario(id) ON DELETE RESTRICT;


--
-- Name: documento_solicitud fk_ds_solicitud; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_solicitud
    ADD CONSTRAINT fk_ds_solicitud FOREIGN KEY (solicitud_id) REFERENCES public.solicitud_apoyo(id) ON DELETE CASCADE;


--
-- Name: documento_solicitud fk_ds_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documento_solicitud
    ADD CONSTRAINT fk_ds_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: detalle_solicitud_apoyo fk_dsa_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo
    ADD CONSTRAINT fk_dsa_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: detalle_solicitud_apoyo fk_dsa_estado; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo
    ADD CONSTRAINT fk_dsa_estado FOREIGN KEY (estado_id) REFERENCES public.estado_solicitud_apoyo(id) ON DELETE RESTRICT;


--
-- Name: detalle_solicitud_apoyo fk_dsa_insumo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo
    ADD CONSTRAINT fk_dsa_insumo FOREIGN KEY (insumo_id) REFERENCES public.insumo(id) ON DELETE RESTRICT;


--
-- Name: detalle_solicitud_apoyo fk_dsa_modalidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo
    ADD CONSTRAINT fk_dsa_modalidad FOREIGN KEY (modalidad_solicitud_id) REFERENCES public.modalidad_solicitud(id) ON DELETE RESTRICT;


--
-- Name: detalle_solicitud_apoyo fk_dsa_presentacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo
    ADD CONSTRAINT fk_dsa_presentacion FOREIGN KEY (presentacion_solicitud_id) REFERENCES public.presentacion_insumo(id) ON DELETE RESTRICT;


--
-- Name: detalle_solicitud_apoyo fk_dsa_receta; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo
    ADD CONSTRAINT fk_dsa_receta FOREIGN KEY (receta_medica_id) REFERENCES public.receta_medica(id) ON DELETE SET NULL;


--
-- Name: detalle_solicitud_apoyo fk_dsa_solicitud; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo
    ADD CONSTRAINT fk_dsa_solicitud FOREIGN KEY (solicitud_id) REFERENCES public.solicitud_apoyo(id) ON DELETE CASCADE;


--
-- Name: detalle_solicitud_apoyo fk_dsa_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_apoyo
    ADD CONSTRAINT fk_dsa_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: detalle_solicitud_formulario fk_dsf_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario
    ADD CONSTRAINT fk_dsf_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: detalle_solicitud_formulario fk_dsf_formulario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario
    ADD CONSTRAINT fk_dsf_formulario FOREIGN KEY (formulario_id) REFERENCES public.formulario(id) ON DELETE RESTRICT;


--
-- Name: detalle_solicitud_formulario fk_dsf_linea; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario
    ADD CONSTRAINT fk_dsf_linea FOREIGN KEY (detalle_solicitud_id) REFERENCES public.detalle_solicitud_apoyo(id) ON DELETE CASCADE;


--
-- Name: detalle_solicitud_formulario fk_dsf_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario
    ADD CONSTRAINT fk_dsf_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: detalle_solicitud_formulario_respuesta fk_dsfr_campo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario_respuesta
    ADD CONSTRAINT fk_dsfr_campo FOREIGN KEY (formulario_campo_id) REFERENCES public.formulario_campo(id) ON DELETE RESTRICT;


--
-- Name: detalle_solicitud_formulario_respuesta fk_dsfr_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario_respuesta
    ADD CONSTRAINT fk_dsfr_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: detalle_solicitud_formulario_respuesta fk_dsfr_detalle_formulario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario_respuesta
    ADD CONSTRAINT fk_dsfr_detalle_formulario FOREIGN KEY (detalle_solicitud_formulario_id) REFERENCES public.detalle_solicitud_formulario(id) ON DELETE CASCADE;


--
-- Name: detalle_solicitud_formulario_respuesta fk_dsfr_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.detalle_solicitud_formulario_respuesta
    ADD CONSTRAINT fk_dsfr_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: estado_civil fk_ec_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_civil
    ADD CONSTRAINT fk_ec_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: estado_civil fk_ec_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_civil
    ADD CONSTRAINT fk_ec_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: evidencia_contrato_prestamo fk_ecp_contrato; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_contrato_prestamo
    ADD CONSTRAINT fk_ecp_contrato FOREIGN KEY (contrato_prestamo_id) REFERENCES public.contrato_prestamo(id) ON DELETE CASCADE;


--
-- Name: estado_contrato_prestamo fk_ecp_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_contrato_prestamo
    ADD CONSTRAINT fk_ecp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: evidencia_contrato_prestamo fk_ecp_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_contrato_prestamo
    ADD CONSTRAINT fk_ecp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: evidencia_contrato_prestamo fk_ecp_tipo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_contrato_prestamo
    ADD CONSTRAINT fk_ecp_tipo FOREIGN KEY (tipo_evidencia_id) REFERENCES public.tipo_evidencia_contrato(id) ON DELETE RESTRICT;


--
-- Name: estado_contrato_prestamo fk_ecp_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_contrato_prestamo
    ADD CONSTRAINT fk_ecp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: evidencia_contrato_prestamo fk_ecp_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_contrato_prestamo
    ADD CONSTRAINT fk_ecp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: evidencia_entrega fk_ee_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_entrega
    ADD CONSTRAINT fk_ee_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: evidencia_entrega fk_ee_entrega; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_entrega
    ADD CONSTRAINT fk_ee_entrega FOREIGN KEY (entrega_id) REFERENCES public.entrega(id) ON DELETE CASCADE;


--
-- Name: evidencia_entrega fk_ee_tipo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_entrega
    ADD CONSTRAINT fk_ee_tipo FOREIGN KEY (tipo_evidencia_id) REFERENCES public.tipo_evidencia_entrega(id) ON DELETE RESTRICT;


--
-- Name: evidencia_entrega fk_ee_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidencia_entrega
    ADD CONSTRAINT fk_ee_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: encargado_menor fk_em_encargado; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encargado_menor
    ADD CONSTRAINT fk_em_encargado FOREIGN KEY (encargado_id) REFERENCES public.persona(id) ON DELETE RESTRICT;


--
-- Name: encargado_menor fk_em_menor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encargado_menor
    ADD CONSTRAINT fk_em_menor FOREIGN KEY (menor_id) REFERENCES public.persona(id) ON DELETE CASCADE;


--
-- Name: encargado_menor fk_em_parentesco; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encargado_menor
    ADD CONSTRAINT fk_em_parentesco FOREIGN KEY (tipo_parentesco_id) REFERENCES public.tipo_parentesco(id) ON DELETE RESTRICT;


--
-- Name: entrega fk_entrega_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega
    ADD CONSTRAINT fk_entrega_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: entrega fk_entrega_parentesco; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega
    ADD CONSTRAINT fk_entrega_parentesco FOREIGN KEY (tipo_parentesco_receptor_id) REFERENCES public.tipo_parentesco(id) ON DELETE RESTRICT;


--
-- Name: entrega fk_entrega_persona; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega
    ADD CONSTRAINT fk_entrega_persona FOREIGN KEY (persona_id) REFERENCES public.persona(id) ON DELETE RESTRICT;


--
-- Name: entrega fk_entrega_receptor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega
    ADD CONSTRAINT fk_entrega_receptor FOREIGN KEY (persona_receptor_id) REFERENCES public.persona(id) ON DELETE RESTRICT;


--
-- Name: entrega fk_entrega_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega
    ADD CONSTRAINT fk_entrega_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: entrega fk_entrega_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrega
    ADD CONSTRAINT fk_entrega_usuario FOREIGN KEY (usuario_entrega_id) REFERENCES public.usuario(id) ON DELETE RESTRICT;


--
-- Name: estado_solicitud_apoyo fk_esa_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_solicitud_apoyo
    ADD CONSTRAINT fk_esa_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: estado_solicitud_apoyo fk_esa_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.estado_solicitud_apoyo
    ADD CONSTRAINT fk_esa_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: formulario_campo fk_fc_catalogo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo
    ADD CONSTRAINT fk_fc_catalogo FOREIGN KEY (catalogo_id) REFERENCES public.catalogo(id) ON DELETE RESTRICT;


--
-- Name: formulario_campo fk_fc_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo
    ADD CONSTRAINT fk_fc_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: formulario_campo fk_fc_formulario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo
    ADD CONSTRAINT fk_fc_formulario FOREIGN KEY (formulario_id) REFERENCES public.formulario(id) ON DELETE CASCADE;


--
-- Name: formulario_campo fk_fc_tipo_dato; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo
    ADD CONSTRAINT fk_fc_tipo_dato FOREIGN KEY (tipo_dato_id) REFERENCES public.tipo_dato_campo_formulario(id) ON DELETE RESTRICT;


--
-- Name: formulario_campo fk_fc_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo
    ADD CONSTRAINT fk_fc_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: formulario_campo_opcion fk_fco_campo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo_opcion
    ADD CONSTRAINT fk_fco_campo FOREIGN KEY (formulario_campo_id) REFERENCES public.formulario_campo(id) ON DELETE CASCADE;


--
-- Name: formulario_campo_opcion fk_fco_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo_opcion
    ADD CONSTRAINT fk_fco_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: formulario_campo_opcion fk_fco_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario_campo_opcion
    ADD CONSTRAINT fk_fco_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: formulario fk_form_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario
    ADD CONSTRAINT fk_form_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: formulario fk_form_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.formulario
    ADD CONSTRAINT fk_form_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: grado_academico fk_ga_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grado_academico
    ADD CONSTRAINT fk_ga_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: grado_academico fk_ga_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grado_academico
    ADD CONSTRAINT fk_ga_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: insumo fk_ins2_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insumo
    ADD CONSTRAINT fk_ins2_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: insumo fk_ins2_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insumo
    ADD CONSTRAINT fk_ins2_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: institucion_donante fk_ins_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institucion_donante
    ADD CONSTRAINT fk_ins_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: institucion_donante fk_ins_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institucion_donante
    ADD CONSTRAINT fk_ins_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: insumo fk_insumo_categoria; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insumo
    ADD CONSTRAINT fk_insumo_categoria FOREIGN KEY (categoria_id) REFERENCES public.categoria_insumo(id) ON DELETE RESTRICT;


--
-- Name: insumo fk_insumo_unidad_base; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.insumo
    ADD CONSTRAINT fk_insumo_unidad_base FOREIGN KEY (unidad_medida_base_id) REFERENCES public.unidad_medida(id) ON DELETE RESTRICT;


--
-- Name: marca_insumo fk_mi_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marca_insumo
    ADD CONSTRAINT fk_mi_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: marca_insumo fk_mi_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marca_insumo
    ADD CONSTRAINT fk_mi_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: multa_prestamo fk_mp_contrato; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multa_prestamo
    ADD CONSTRAINT fk_mp_contrato FOREIGN KEY (contrato_prestamo_id) REFERENCES public.contrato_prestamo(id) ON DELETE CASCADE;


--
-- Name: multa_prestamo fk_mp_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multa_prestamo
    ADD CONSTRAINT fk_mp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: multa_prestamo fk_mp_tipo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multa_prestamo
    ADD CONSTRAINT fk_mp_tipo FOREIGN KEY (tipo_multa_id) REFERENCES public.tipo_multa_prestamo(id) ON DELETE RESTRICT;


--
-- Name: multa_prestamo fk_mp_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.multa_prestamo
    ADD CONSTRAINT fk_mp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: modalidad_solicitud fk_ms_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modalidad_solicitud
    ADD CONSTRAINT fk_ms_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: modalidad_solicitud fk_ms_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.modalidad_solicitud
    ADD CONSTRAINT fk_ms_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: municipio fk_muni_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipio
    ADD CONSTRAINT fk_muni_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: municipio fk_muni_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipio
    ADD CONSTRAINT fk_muni_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: municipio fk_municipio_departamento; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.municipio
    ADD CONSTRAINT fk_municipio_departamento FOREIGN KEY (departamento_id) REFERENCES public.departamento(id) ON DELETE RESTRICT;


--
-- Name: ocupacion fk_ocu_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocupacion
    ADD CONSTRAINT fk_ocu_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: ocupacion fk_ocu_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocupacion
    ADD CONSTRAINT fk_ocu_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id) ON DELETE SET NULL;


--
-- Name: persona_discapacidad fk_pd_discapacidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_discapacidad
    ADD CONSTRAINT fk_pd_discapacidad FOREIGN KEY (discapacidad_id) REFERENCES public.discapacidad(id) ON DELETE RESTRICT;


--
-- Name: persona_discapacidad fk_pd_persona; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona_discapacidad
    ADD CONSTRAINT fk_pd_persona FOREIGN KEY (persona_id) REFERENCES public.persona(id) ON DELETE CASCADE;


--
-- Name: persona fk_per_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT fk_per_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: persona fk_per_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT fk_per_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: persona fk_persona_comunidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT fk_persona_comunidad FOREIGN KEY (comunidad_id) REFERENCES public.comunidad(id) ON DELETE RESTRICT;


--
-- Name: persona fk_persona_estado_civil; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT fk_persona_estado_civil FOREIGN KEY (estado_civil_id) REFERENCES public.estado_civil(id) ON DELETE RESTRICT;


--
-- Name: persona fk_persona_genero; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT fk_persona_genero FOREIGN KEY (genero_id) REFERENCES public.tipo_genero(id) ON DELETE RESTRICT;


--
-- Name: persona fk_persona_grado_academico; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT fk_persona_grado_academico FOREIGN KEY (grado_academico_id) REFERENCES public.grado_academico(id) ON DELETE RESTRICT;


--
-- Name: persona fk_persona_municipio_nacimiento; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT fk_persona_municipio_nacimiento FOREIGN KEY (municipio_nacimiento_id) REFERENCES public.municipio(id) ON DELETE RESTRICT;


--
-- Name: persona fk_persona_ocupacion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.persona
    ADD CONSTRAINT fk_persona_ocupacion FOREIGN KEY (ocupacion_id) REFERENCES public.ocupacion(id) ON DELETE RESTRICT;


--
-- Name: presentacion_insumo fk_pi_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presentacion_insumo
    ADD CONSTRAINT fk_pi_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: presentacion_insumo fk_pi_insumo; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presentacion_insumo
    ADD CONSTRAINT fk_pi_insumo FOREIGN KEY (insumo_id) REFERENCES public.insumo(id) ON DELETE CASCADE;


--
-- Name: presentacion_insumo fk_pi_unidad; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presentacion_insumo
    ADD CONSTRAINT fk_pi_unidad FOREIGN KEY (unidad_medida_id) REFERENCES public.unidad_medida(id) ON DELETE RESTRICT;


--
-- Name: presentacion_insumo fk_pi_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.presentacion_insumo
    ADD CONSTRAINT fk_pi_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: programa fk_prog_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programa
    ADD CONSTRAINT fk_prog_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: programa fk_prog_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programa
    ADD CONSTRAINT fk_prog_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: recepcion_donacion_lote fk_rec_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_donacion_lote
    ADD CONSTRAINT fk_rec_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: recepcion_donacion_lote fk_rec_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_donacion_lote
    ADD CONSTRAINT fk_rec_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: recepcion_donacion_lote fk_recepcion_institucion; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recepcion_donacion_lote
    ADD CONSTRAINT fk_recepcion_institucion FOREIGN KEY (institucion_id) REFERENCES public.institucion_donante(id) ON DELETE RESTRICT;


--
-- Name: receta_medica fk_rm_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receta_medica
    ADD CONSTRAINT fk_rm_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: receta_medica fk_rm_solicitud; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receta_medica
    ADD CONSTRAINT fk_rm_solicitud FOREIGN KEY (solicitud_id) REFERENCES public.solicitud_apoyo(id) ON DELETE CASCADE;


--
-- Name: receta_medica fk_rm_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receta_medica
    ADD CONSTRAINT fk_rm_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: rol fk_rol_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rol
    ADD CONSTRAINT fk_rol_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: rol fk_rol_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rol
    ADD CONSTRAINT fk_rol_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: sesion fk_sesion_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesion
    ADD CONSTRAINT fk_sesion_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: sesion fk_sesion_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesion
    ADD CONSTRAINT fk_sesion_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: sesion fk_sesion_usuario; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesion
    ADD CONSTRAINT fk_sesion_usuario FOREIGN KEY (usuario_id) REFERENCES public.usuario(id) ON DELETE CASCADE;


--
-- Name: solicitud_apoyo fk_sol_aprobador; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_apoyo
    ADD CONSTRAINT fk_sol_aprobador FOREIGN KEY (aprobado_por) REFERENCES public.usuario(id);


--
-- Name: solicitud_apoyo fk_sol_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_apoyo
    ADD CONSTRAINT fk_sol_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: solicitud_apoyo fk_sol_estado; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_apoyo
    ADD CONSTRAINT fk_sol_estado FOREIGN KEY (estado_id) REFERENCES public.estado_solicitud_apoyo(id) ON DELETE RESTRICT;


--
-- Name: solicitud_apoyo fk_sol_persona; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_apoyo
    ADD CONSTRAINT fk_sol_persona FOREIGN KEY (persona_id) REFERENCES public.persona(id) ON DELETE RESTRICT;


--
-- Name: solicitud_apoyo fk_sol_programa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_apoyo
    ADD CONSTRAINT fk_sol_programa FOREIGN KEY (programa_id) REFERENCES public.programa(id) ON DELETE RESTRICT;


--
-- Name: solicitud_apoyo fk_sol_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitud_apoyo
    ADD CONSTRAINT fk_sol_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: tipo_accion_auditoria fk_taa_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_accion_auditoria
    ADD CONSTRAINT fk_taa_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: tipo_accion_auditoria fk_taa_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_accion_auditoria
    ADD CONSTRAINT fk_taa_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: tipo_dato_campo_formulario fk_tdcf_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_dato_campo_formulario
    ADD CONSTRAINT fk_tdcf_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: tipo_dato_campo_formulario fk_tdcf_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_dato_campo_formulario
    ADD CONSTRAINT fk_tdcf_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: tipo_documento_persona fk_tdp_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_documento_persona
    ADD CONSTRAINT fk_tdp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: tipo_documento_persona fk_tdp_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_documento_persona
    ADD CONSTRAINT fk_tdp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: tipo_evidencia_contrato fk_tec_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_evidencia_contrato
    ADD CONSTRAINT fk_tec_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: tipo_evidencia_contrato fk_tec_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_evidencia_contrato
    ADD CONSTRAINT fk_tec_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: tipo_evidencia_entrega fk_tee_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_evidencia_entrega
    ADD CONSTRAINT fk_tee_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: tipo_evidencia_entrega fk_tee_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_evidencia_entrega
    ADD CONSTRAINT fk_tee_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: tipo_genero fk_tg_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_genero
    ADD CONSTRAINT fk_tg_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: tipo_genero fk_tg_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_genero
    ADD CONSTRAINT fk_tg_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: tipo_multa_prestamo fk_tmp_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_multa_prestamo
    ADD CONSTRAINT fk_tmp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: tipo_multa_prestamo fk_tmp_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_multa_prestamo
    ADD CONSTRAINT fk_tmp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: tipo_parentesco fk_tp_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_parentesco
    ADD CONSTRAINT fk_tp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: tipo_parentesco fk_tp_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipo_parentesco
    ADD CONSTRAINT fk_tp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: unidad_medida fk_um_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidad_medida
    ADD CONSTRAINT fk_um_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: unidad_medida fk_um_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.unidad_medida
    ADD CONSTRAINT fk_um_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: usuario fk_usuario_created_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT fk_usuario_created_by FOREIGN KEY (created_by) REFERENCES public.usuario(id);


--
-- Name: usuario fk_usuario_programa; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT fk_usuario_programa FOREIGN KEY (programa_id) REFERENCES public.programa(id) ON DELETE RESTRICT;


--
-- Name: usuario fk_usuario_rol; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT fk_usuario_rol FOREIGN KEY (rol_id) REFERENCES public.rol(id) ON DELETE RESTRICT;


--
-- Name: usuario fk_usuario_updated_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usuario
    ADD CONSTRAINT fk_usuario_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario(id);


--
-- Name: FUNCTION fn_auditoria(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fn_auditoria() FROM PUBLIC;


--
-- Name: FUNCTION fn_crear_entrega(p_persona_id integer, p_usuario_entrega_id integer, p_observaciones text, p_persona_receptor_id integer, p_tipo_parentesco_receptor_id integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.fn_crear_entrega(p_persona_id integer, p_usuario_entrega_id integer, p_observaciones text, p_persona_receptor_id integer, p_tipo_parentesco_receptor_id integer) TO dmm_app;


--
-- Name: PROCEDURE sp_desactivar_detalle_entrega(IN p_detalle_entrega_id integer, IN p_usuario_id integer, IN p_motivo text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON PROCEDURE public.sp_desactivar_detalle_entrega(IN p_detalle_entrega_id integer, IN p_usuario_id integer, IN p_motivo text) TO dmm_app;


--
-- Name: TABLE auditoria_log; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.auditoria_log TO dmm_app;


--
-- Name: SEQUENCE auditoria_log_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.auditoria_log_id_seq TO dmm_app;


--
-- Name: TABLE catalogo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.catalogo TO dmm_app;


--
-- Name: SEQUENCE catalogo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.catalogo_id_seq TO dmm_app;


--
-- Name: TABLE catalogo_valor; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.catalogo_valor TO dmm_app;


--
-- Name: SEQUENCE catalogo_valor_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.catalogo_valor_id_seq TO dmm_app;


--
-- Name: TABLE categoria_insumo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.categoria_insumo TO dmm_app;


--
-- Name: TABLE categoria_insumo_formulario; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.categoria_insumo_formulario TO dmm_app;


--
-- Name: SEQUENCE categoria_insumo_formulario_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.categoria_insumo_formulario_id_seq TO dmm_app;


--
-- Name: SEQUENCE categoria_insumo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.categoria_insumo_id_seq TO dmm_app;


--
-- Name: TABLE comunidad; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.comunidad TO dmm_app;


--
-- Name: SEQUENCE comunidad_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.comunidad_id_seq TO dmm_app;


--
-- Name: TABLE contacto_referencia_persona; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.contacto_referencia_persona TO dmm_app;


--
-- Name: SEQUENCE contacto_referencia_persona_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.contacto_referencia_persona_id_seq TO dmm_app;


--
-- Name: TABLE contrato_prestamo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.contrato_prestamo TO dmm_app;


--
-- Name: SEQUENCE contrato_prestamo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.contrato_prestamo_id_seq TO dmm_app;


--
-- Name: TABLE departamento; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.departamento TO dmm_app;


--
-- Name: SEQUENCE departamento_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.departamento_id_seq TO dmm_app;


--
-- Name: TABLE detalle_entrega; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.detalle_entrega TO dmm_app;


--
-- Name: SEQUENCE detalle_entrega_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.detalle_entrega_id_seq TO dmm_app;


--
-- Name: TABLE detalle_entrega_lote; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.detalle_entrega_lote TO dmm_app;


--
-- Name: SEQUENCE detalle_entrega_lote_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.detalle_entrega_lote_id_seq TO dmm_app;


--
-- Name: TABLE detalle_inventario_lote; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.detalle_inventario_lote TO dmm_app;


--
-- Name: SEQUENCE detalle_inventario_lote_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.detalle_inventario_lote_id_seq TO dmm_app;


--
-- Name: TABLE detalle_solicitud_apoyo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.detalle_solicitud_apoyo TO dmm_app;


--
-- Name: SEQUENCE detalle_solicitud_apoyo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.detalle_solicitud_apoyo_id_seq TO dmm_app;


--
-- Name: TABLE detalle_solicitud_formulario; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.detalle_solicitud_formulario TO dmm_app;


--
-- Name: SEQUENCE detalle_solicitud_formulario_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.detalle_solicitud_formulario_id_seq TO dmm_app;


--
-- Name: TABLE detalle_solicitud_formulario_respuesta; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.detalle_solicitud_formulario_respuesta TO dmm_app;


--
-- Name: SEQUENCE detalle_solicitud_formulario_respuesta_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.detalle_solicitud_formulario_respuesta_id_seq TO dmm_app;


--
-- Name: TABLE discapacidad; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.discapacidad TO dmm_app;


--
-- Name: SEQUENCE discapacidad_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.discapacidad_id_seq TO dmm_app;


--
-- Name: TABLE documento_persona; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.documento_persona TO dmm_app;


--
-- Name: SEQUENCE documento_persona_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.documento_persona_id_seq TO dmm_app;


--
-- Name: TABLE documento_recepcion; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.documento_recepcion TO dmm_app;


--
-- Name: SEQUENCE documento_recepcion_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.documento_recepcion_id_seq TO dmm_app;


--
-- Name: TABLE documento_solicitud; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.documento_solicitud TO dmm_app;


--
-- Name: SEQUENCE documento_solicitud_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.documento_solicitud_id_seq TO dmm_app;


--
-- Name: TABLE encargado_menor; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.encargado_menor TO dmm_app;


--
-- Name: TABLE entrega; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.entrega TO dmm_app;


--
-- Name: SEQUENCE entrega_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.entrega_id_seq TO dmm_app;


--
-- Name: TABLE estado_civil; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.estado_civil TO dmm_app;


--
-- Name: SEQUENCE estado_civil_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.estado_civil_id_seq TO dmm_app;


--
-- Name: TABLE estado_contrato_prestamo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.estado_contrato_prestamo TO dmm_app;


--
-- Name: SEQUENCE estado_contrato_prestamo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.estado_contrato_prestamo_id_seq TO dmm_app;


--
-- Name: TABLE estado_solicitud_apoyo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.estado_solicitud_apoyo TO dmm_app;


--
-- Name: SEQUENCE estado_solicitud_apoyo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.estado_solicitud_apoyo_id_seq TO dmm_app;


--
-- Name: TABLE evidencia_contrato_prestamo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.evidencia_contrato_prestamo TO dmm_app;


--
-- Name: SEQUENCE evidencia_contrato_prestamo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.evidencia_contrato_prestamo_id_seq TO dmm_app;


--
-- Name: TABLE evidencia_entrega; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.evidencia_entrega TO dmm_app;


--
-- Name: SEQUENCE evidencia_entrega_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.evidencia_entrega_id_seq TO dmm_app;


--
-- Name: TABLE formulario; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.formulario TO dmm_app;


--
-- Name: TABLE formulario_campo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.formulario_campo TO dmm_app;


--
-- Name: SEQUENCE formulario_campo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.formulario_campo_id_seq TO dmm_app;


--
-- Name: TABLE formulario_campo_opcion; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.formulario_campo_opcion TO dmm_app;


--
-- Name: SEQUENCE formulario_campo_opcion_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.formulario_campo_opcion_id_seq TO dmm_app;


--
-- Name: SEQUENCE formulario_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.formulario_id_seq TO dmm_app;


--
-- Name: TABLE grado_academico; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.grado_academico TO dmm_app;


--
-- Name: SEQUENCE grado_academico_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.grado_academico_id_seq TO dmm_app;


--
-- Name: TABLE institucion_donante; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.institucion_donante TO dmm_app;


--
-- Name: SEQUENCE institucion_donante_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.institucion_donante_id_seq TO dmm_app;


--
-- Name: TABLE insumo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.insumo TO dmm_app;


--
-- Name: SEQUENCE insumo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.insumo_id_seq TO dmm_app;


--
-- Name: TABLE marca_insumo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.marca_insumo TO dmm_app;


--
-- Name: SEQUENCE marca_insumo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.marca_insumo_id_seq TO dmm_app;


--
-- Name: TABLE modalidad_solicitud; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.modalidad_solicitud TO dmm_app;


--
-- Name: SEQUENCE modalidad_solicitud_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.modalidad_solicitud_id_seq TO dmm_app;


--
-- Name: TABLE multa_prestamo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.multa_prestamo TO dmm_app;


--
-- Name: SEQUENCE multa_prestamo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.multa_prestamo_id_seq TO dmm_app;


--
-- Name: TABLE municipio; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.municipio TO dmm_app;


--
-- Name: SEQUENCE municipio_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.municipio_id_seq TO dmm_app;


--
-- Name: TABLE ocupacion; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.ocupacion TO dmm_app;


--
-- Name: SEQUENCE ocupacion_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.ocupacion_id_seq TO dmm_app;


--
-- Name: TABLE persona; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.persona TO dmm_app;


--
-- Name: TABLE persona_discapacidad; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.persona_discapacidad TO dmm_app;


--
-- Name: SEQUENCE persona_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.persona_id_seq TO dmm_app;


--
-- Name: TABLE presentacion_insumo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.presentacion_insumo TO dmm_app;


--
-- Name: SEQUENCE presentacion_insumo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.presentacion_insumo_id_seq TO dmm_app;


--
-- Name: TABLE programa; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.programa TO dmm_app;


--
-- Name: SEQUENCE programa_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.programa_id_seq TO dmm_app;


--
-- Name: TABLE recepcion_donacion_lote; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.recepcion_donacion_lote TO dmm_app;


--
-- Name: SEQUENCE recepcion_donacion_lote_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.recepcion_donacion_lote_id_seq TO dmm_app;


--
-- Name: TABLE receta_medica; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.receta_medica TO dmm_app;


--
-- Name: SEQUENCE receta_medica_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.receta_medica_id_seq TO dmm_app;


--
-- Name: TABLE rol; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.rol TO dmm_app;


--
-- Name: SEQUENCE rol_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.rol_id_seq TO dmm_app;


--
-- Name: TABLE sesion; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.sesion TO dmm_app;


--
-- Name: SEQUENCE sesion_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.sesion_id_seq TO dmm_app;


--
-- Name: TABLE solicitud_apoyo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.solicitud_apoyo TO dmm_app;


--
-- Name: SEQUENCE solicitud_apoyo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.solicitud_apoyo_id_seq TO dmm_app;


--
-- Name: TABLE tipo_accion_auditoria; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.tipo_accion_auditoria TO dmm_app;


--
-- Name: SEQUENCE tipo_accion_auditoria_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.tipo_accion_auditoria_id_seq TO dmm_app;


--
-- Name: TABLE tipo_dato_campo_formulario; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tipo_dato_campo_formulario TO dmm_app;


--
-- Name: SEQUENCE tipo_dato_campo_formulario_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.tipo_dato_campo_formulario_id_seq TO dmm_app;


--
-- Name: TABLE tipo_documento_persona; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tipo_documento_persona TO dmm_app;


--
-- Name: SEQUENCE tipo_documento_persona_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.tipo_documento_persona_id_seq TO dmm_app;


--
-- Name: TABLE tipo_evidencia_contrato; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tipo_evidencia_contrato TO dmm_app;


--
-- Name: SEQUENCE tipo_evidencia_contrato_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,USAGE ON SEQUENCE public.tipo_evidencia_contrato_id_seq TO dmm_app;


--
-- Name: TABLE tipo_evidencia_entrega; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tipo_evidencia_entrega TO dmm_app;


--
-- Name: SEQUENCE tipo_evidencia_entrega_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.tipo_evidencia_entrega_id_seq TO dmm_app;


--
-- Name: TABLE tipo_genero; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tipo_genero TO dmm_app;


--
-- Name: SEQUENCE tipo_genero_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.tipo_genero_id_seq TO dmm_app;


--
-- Name: TABLE tipo_multa_prestamo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tipo_multa_prestamo TO dmm_app;


--
-- Name: SEQUENCE tipo_multa_prestamo_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.tipo_multa_prestamo_id_seq TO dmm_app;


--
-- Name: TABLE tipo_parentesco; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.tipo_parentesco TO dmm_app;


--
-- Name: SEQUENCE tipo_parentesco_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.tipo_parentesco_id_seq TO dmm_app;


--
-- Name: TABLE unidad_medida; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.unidad_medida TO dmm_app;


--
-- Name: SEQUENCE unidad_medida_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.unidad_medida_id_seq TO dmm_app;


--
-- Name: TABLE usuario; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,UPDATE ON TABLE public.usuario TO dmm_app;


--
-- Name: SEQUENCE usuario_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT USAGE ON SEQUENCE public.usuario_id_seq TO dmm_app;


--
-- Name: TABLE v_formularios_exigidos_linea; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_formularios_exigidos_linea TO dmm_app;


--
-- Name: TABLE v_inventario_lote_fifo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_inventario_lote_fifo TO dmm_app;


--
-- Name: TABLE v_lista_espera; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_lista_espera TO dmm_app;


--
-- Name: TABLE v_reporte_personas_atendidas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_reporte_personas_atendidas TO dmm_app;


--
-- Name: TABLE v_reporte_poblacion_beneficiada; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_reporte_poblacion_beneficiada TO dmm_app;


--
-- Name: TABLE v_reporte_stock_por_categoria; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_reporte_stock_por_categoria TO dmm_app;


--
-- Name: TABLE v_semaforo_inventario; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_semaforo_inventario TO dmm_app;


--
-- Name: TABLE v_solicitudes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_solicitudes TO dmm_app;


--
-- Name: TABLE v_solicitudes_activas; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_solicitudes_activas TO dmm_app;


--
-- Name: TABLE v_stock_insumo; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_stock_insumo TO dmm_app;


--
-- Name: TABLE v_stock_insumo_presentaciones; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_stock_insumo_presentaciones TO dmm_app;


--
-- Name: TABLE v_unidades_disponibles; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT ON TABLE public.v_unidades_disponibles TO dmm_app;


--
-- PostgreSQL database dump complete
--


-- pg_dump deja el search_path vacio; lo que sigue usa nombres calificados,
-- pero se restablece para quien continue en la misma sesion.
SELECT pg_catalog.set_config('search_path', 'public', false);

-- ============================================================================
-- 3. DATOS SEMILLA
--
-- Solo catalogos, NUNCA datos de personas ni usuarios. Los ids se conservan
-- porque municipio referencia a departamento, y las secuencias se ajustan al
-- final de cada tabla.
-- ============================================================================
INSERT INTO public.tipo_accion_auditoria (id, nombre, activo) VALUES
    ('1', 'INSERT', 'true'),
    ('2', 'UPDATE', 'true'),
    ('3', 'DELETE', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.tipo_accion_auditoria', 'id'), (SELECT max(id) FROM public.tipo_accion_auditoria));

INSERT INTO public.rol (id, nombre, descripcion, activo) VALUES
    ('1', 'ADMINISTRADOR', 'Gestion de usuarios, configuracion y catalogos.', 'true'),
    ('2', 'ALCALDE', 'Acceso exclusivo de solo lectura al modulo de reportes.', 'true'),
    ('3', 'DIRECTORA', 'Permisos equivalentes a Administrador, incluida gestion de catalogos.', 'true'),
    ('4', 'EMPLEADO_DMM', 'Operacion diaria: beneficiarios, solicitudes, inventario, entregas.', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.rol', 'id'), (SELECT max(id) FROM public.rol));

INSERT INTO public.estado_solicitud_apoyo (id, nombre, activo) VALUES
    ('1', 'PENDIENTE_ADQUISICION', 'true'),
    ('2', 'PENDIENTE_ENTREGA', 'true'),
    ('3', 'PENDIENTE_ENTREGA_PARCIAL', 'true'),
    ('4', 'APROBADA', 'true'),
    ('5', 'RECHAZADA', 'true'),
    ('6', 'ENTREGADA', 'true'),
    ('7', 'CANCELADA', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.estado_solicitud_apoyo', 'id'), (SELECT max(id) FROM public.estado_solicitud_apoyo));

INSERT INTO public.modalidad_solicitud (id, nombre, descripcion, activo) VALUES
    ('1', 'DONACION', 'Entrega definitiva. El insumo pasa a ser de la persona y no se devuelve.', 'true'),
    ('2', 'PRESTAMO', 'Entrega temporal con contrato y fecha de devolución pactada. No exige estudio socioeconómico.', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.modalidad_solicitud', 'id'), (SELECT max(id) FROM public.modalidad_solicitud));

INSERT INTO public.estado_contrato_prestamo (id, nombre, activo) VALUES
    ('1', 'VIGENTE', 'true'),
    ('2', 'DEVUELTO', 'true'),
    ('3', 'VENCIDO', 'true'),
    ('4', 'EXTENDIDO', 'true'),
    ('5', 'NO_DEVUELTO', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.estado_contrato_prestamo', 'id'), (SELECT max(id) FROM public.estado_contrato_prestamo));

INSERT INTO public.tipo_genero (id, nombre, activo) VALUES
    ('1', 'MASCULINO', 'true'),
    ('2', 'FEMENINO', 'true'),
    ('3', 'OTRO', 'true'),
    ('4', 'PREFIERE_NO_DECIR', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.tipo_genero', 'id'), (SELECT max(id) FROM public.tipo_genero));

INSERT INTO public.tipo_parentesco (id, nombre, activo) VALUES
    ('1', 'MADRE', 'true'),
    ('2', 'PADRE', 'true'),
    ('3', 'HIJO_A', 'true'),
    ('4', 'HERMANO_A', 'true'),
    ('5', 'ABUELO_A', 'true'),
    ('6', 'TIO_A', 'true'),
    ('7', 'CONYUGE', 'true'),
    ('8', 'OTRO', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.tipo_parentesco', 'id'), (SELECT max(id) FROM public.tipo_parentesco));

INSERT INTO public.tipo_documento_persona (id, nombre, activo) VALUES
    ('2', 'PARTIDA_NACIMIENTO', 'true'),
    ('3', 'DPI_ENCARGADO', 'true'),
    ('4', 'OTRO', 'true'),
    ('5', 'DPI anverso', 'true'),
    ('6', 'DPI reverso', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.tipo_documento_persona', 'id'), (SELECT max(id) FROM public.tipo_documento_persona));

INSERT INTO public.tipo_evidencia_entrega (id, nombre, activo) VALUES
    ('1', 'FOTO_BENEFICIARIO_CON_INSUMO', 'true'),
    ('2', 'FOTO_RECEPTOR', 'true'),
    ('3', 'FOTOCOPIA_DPI_RECEPTOR', 'true'),
    ('4', 'OTRO', 'true'),
    ('5', 'RECETA_MEDICA', 'true'),
    ('6', 'FORMULARIO_FIRMADO', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.tipo_evidencia_entrega', 'id'), (SELECT max(id) FROM public.tipo_evidencia_entrega));

INSERT INTO public.tipo_evidencia_contrato (id, nombre, activo) VALUES
    ('1', 'CONTRATO_FIRMADO', 'true'),
    ('2', 'DPI_FRONTAL', 'true'),
    ('3', 'DPI_REVERSO', 'true'),
    ('4', 'FOTO_RECEPCION', 'true'),
    ('5', 'OTRO', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.tipo_evidencia_contrato', 'id'), (SELECT max(id) FROM public.tipo_evidencia_contrato));

INSERT INTO public.tipo_multa_prestamo (id, nombre, monto_sugerido, activo) VALUES
    ('1', 'ATRASO', '50.00', 'true'),
    ('2', 'EQUIPO_DANADO', '100.00', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.tipo_multa_prestamo', 'id'), (SELECT max(id) FROM public.tipo_multa_prestamo));

INSERT INTO public.tipo_dato_campo_formulario (id, nombre, activo) VALUES
    ('1', 'TEXTO_CORTO', 'true'),
    ('2', 'TEXTO_LARGO', 'true'),
    ('3', 'NUMERO', 'true'),
    ('4', 'FECHA', 'true'),
    ('5', 'SI_NO', 'true'),
    ('6', 'SELECCION_UNICA', 'true'),
    ('7', 'SELECCION_MULTIPLE', 'true'),
    ('8', 'FECHA_NACIMIENTO', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.tipo_dato_campo_formulario', 'id'), (SELECT max(id) FROM public.tipo_dato_campo_formulario));

INSERT INTO public.departamento (id, nombre, activo) VALUES
    ('1', 'Alta Verapaz', 'true'),
    ('2', 'Baja Verapaz', 'true'),
    ('3', 'Chimaltenango', 'true'),
    ('4', 'Chiquimula', 'true'),
    ('5', 'El Progreso', 'true'),
    ('6', 'Escuintla', 'true'),
    ('7', 'Guatemala', 'true'),
    ('8', 'Huehuetenango', 'true'),
    ('9', 'Izabal', 'true'),
    ('10', 'Jalapa', 'true'),
    ('11', 'Jutiapa', 'true'),
    ('12', 'Petén', 'true'),
    ('13', 'Quetzaltenango', 'true'),
    ('14', 'Quiché', 'true'),
    ('15', 'Retalhuleu', 'true'),
    ('16', 'Sacatepéquez', 'true'),
    ('17', 'San Marcos', 'true'),
    ('18', 'Santa Rosa', 'true'),
    ('19', 'Sololá', 'true'),
    ('20', 'Suchitepéquez', 'true'),
    ('21', 'Totonicapán', 'true'),
    ('22', 'Zacapa', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.departamento', 'id'), (SELECT max(id) FROM public.departamento));

INSERT INTO public.municipio (id, departamento_id, nombre, activo) VALUES
    ('1', '22', 'Zacapa', 'true'),
    ('2', '22', 'Estanzuela', 'true'),
    ('3', '22', 'Río Hondo', 'true'),
    ('4', '22', 'Gualán', 'true'),
    ('5', '22', 'Teculután', 'true'),
    ('6', '22', 'Usumatlán', 'true'),
    ('7', '22', 'Cabañas', 'true'),
    ('8', '22', 'San Diego', 'true'),
    ('9', '22', 'La Unión', 'true'),
    ('10', '22', 'Huité', 'true'),
    ('11', '22', 'San Jorge', 'true'),
    ('12', '1', 'Cobán', 'true'),
    ('13', '1', 'Santa Cruz Verapaz', 'true'),
    ('14', '1', 'San Cristóbal Verapaz', 'true'),
    ('15', '1', 'Tactic', 'true'),
    ('16', '1', 'Tamahú', 'true'),
    ('17', '1', 'Tucurú', 'true'),
    ('18', '1', 'Panzós', 'true'),
    ('19', '1', 'Senahú', 'true'),
    ('20', '1', 'San Pedro Carchá', 'true'),
    ('21', '1', 'San Juan Chamelco', 'true'),
    ('22', '1', 'Lanquín', 'true'),
    ('23', '1', 'Santa María Cahabón', 'true'),
    ('24', '1', 'Chisec', 'true'),
    ('25', '1', 'Chahal', 'true'),
    ('26', '1', 'Fray Bartolomé de las Casas', 'true'),
    ('27', '1', 'Santa Catalina La Tinta', 'true'),
    ('28', '1', 'Raxruhá', 'true'),
    ('29', '2', 'Salamá', 'true'),
    ('30', '2', 'San Miguel Chicaj', 'true'),
    ('31', '2', 'Rabinal', 'true'),
    ('32', '2', 'Cubulco', 'true'),
    ('33', '2', 'Granados', 'true'),
    ('34', '2', 'El Chol', 'true'),
    ('35', '2', 'San Jerónimo', 'true'),
    ('36', '2', 'Purulhá', 'true'),
    ('37', '3', 'Chimaltenango', 'true'),
    ('38', '3', 'San José Poaquil', 'true'),
    ('39', '3', 'San Martín Jilotepeque', 'true'),
    ('40', '3', 'San Juan Comalapa', 'true'),
    ('41', '3', 'Santa Apolonia', 'true'),
    ('42', '3', 'Tecpán Guatemala', 'true'),
    ('43', '3', 'Patzún', 'true'),
    ('44', '3', 'Pochuta', 'true'),
    ('45', '3', 'Patzicía', 'true'),
    ('46', '3', 'Santa Cruz Balanyá', 'true'),
    ('47', '3', 'Acatenango', 'true'),
    ('48', '3', 'San Pedro Yepocapa', 'true'),
    ('49', '3', 'San Andrés Itzapa', 'true'),
    ('50', '3', 'Parramos', 'true'),
    ('51', '3', 'Zaragoza', 'true'),
    ('52', '3', 'El Tejar', 'true'),
    ('53', '4', 'Chiquimula', 'true'),
    ('54', '4', 'San José La Arada', 'true'),
    ('55', '4', 'San Juan Ermita', 'true'),
    ('56', '4', 'Jocotán', 'true'),
    ('57', '4', 'Camotán', 'true'),
    ('58', '4', 'Olopa', 'true'),
    ('59', '4', 'Esquipulas', 'true'),
    ('60', '4', 'Concepción Las Minas', 'true'),
    ('61', '4', 'Quezaltepeque', 'true'),
    ('62', '4', 'San Jacinto', 'true'),
    ('63', '4', 'Ipala', 'true'),
    ('64', '5', 'Guastatoya', 'true'),
    ('65', '5', 'Morazán', 'true'),
    ('66', '5', 'San Agustín Acasaguastlán', 'true'),
    ('67', '5', 'San Cristóbal Acasaguastlán', 'true'),
    ('68', '5', 'El Jícaro', 'true'),
    ('69', '5', 'Sansare', 'true'),
    ('70', '5', 'Sanarate', 'true'),
    ('71', '5', 'San Antonio La Paz', 'true'),
    ('72', '6', 'Escuintla', 'true'),
    ('73', '6', 'Santa Lucía Cotzumalguapa', 'true'),
    ('74', '6', 'La Democracia', 'true'),
    ('75', '6', 'Siquinalá', 'true'),
    ('76', '6', 'Masagua', 'true'),
    ('77', '6', 'Tiquisate', 'true'),
    ('78', '6', 'La Gomera', 'true'),
    ('79', '6', 'Guanagazapa', 'true'),
    ('80', '6', 'San José', 'true'),
    ('81', '6', 'Iztapa', 'true'),
    ('82', '6', 'Palín', 'true'),
    ('83', '6', 'San Vicente Pacaya', 'true'),
    ('84', '6', 'Nueva Concepción', 'true'),
    ('85', '6', 'Sipacate', 'true'),
    ('86', '7', 'Guatemala', 'true'),
    ('87', '7', 'Santa Catarina Pinula', 'true'),
    ('88', '7', 'San José Pinula', 'true'),
    ('89', '7', 'San José del Golfo', 'true'),
    ('90', '7', 'Palencia', 'true'),
    ('91', '7', 'Chinautla', 'true'),
    ('92', '7', 'San Pedro Ayampuc', 'true'),
    ('93', '7', 'Mixco', 'true'),
    ('94', '7', 'San Pedro Sacatepéquez', 'true'),
    ('95', '7', 'San Juan Sacatepéquez', 'true'),
    ('96', '7', 'San Raymundo', 'true'),
    ('97', '7', 'Chuarrancho', 'true'),
    ('98', '7', 'Fraijanes', 'true'),
    ('99', '7', 'Amatitlán', 'true'),
    ('100', '7', 'Villa Nueva', 'true'),
    ('101', '7', 'Villa Canales', 'true'),
    ('102', '7', 'San Miguel Petapa', 'true'),
    ('103', '8', 'Huehuetenango', 'true'),
    ('104', '8', 'Chiantla', 'true'),
    ('105', '8', 'Malacatancito', 'true'),
    ('106', '8', 'Cuilco', 'true'),
    ('107', '8', 'Nentón', 'true'),
    ('108', '8', 'San Pedro Necta', 'true'),
    ('109', '8', 'Jacaltenango', 'true'),
    ('110', '8', 'San Pedro Soloma', 'true'),
    ('111', '8', 'San Ildefonso Ixtahuacán', 'true'),
    ('112', '8', 'Santa Bárbara', 'true'),
    ('113', '8', 'La Libertad', 'true'),
    ('114', '8', 'La Democracia', 'true'),
    ('115', '8', 'San Miguel Acatán', 'true'),
    ('116', '8', 'San Rafael La Independencia', 'true'),
    ('117', '8', 'Todos Santos Cuchumatán', 'true'),
    ('118', '8', 'San Juan Atitán', 'true'),
    ('119', '8', 'Santa Eulalia', 'true'),
    ('120', '8', 'San Mateo Ixtatán', 'true'),
    ('121', '8', 'Colotenango', 'true'),
    ('122', '8', 'San Sebastián Huehuetenango', 'true'),
    ('123', '8', 'Tectitán', 'true'),
    ('124', '8', 'Concepción Huista', 'true'),
    ('125', '8', 'San Juan Ixcoy', 'true'),
    ('126', '8', 'San Antonio Huista', 'true'),
    ('127', '8', 'San Sebastián Coatán', 'true'),
    ('128', '8', 'Barillas', 'true'),
    ('129', '8', 'Aguacatán', 'true'),
    ('130', '8', 'San Rafael Petzal', 'true'),
    ('131', '8', 'San Gaspar Ixchil', 'true'),
    ('132', '8', 'Santiago Chimaltenango', 'true'),
    ('133', '8', 'Santa Ana Huista', 'true'),
    ('134', '8', 'Unión Cantinil', 'true'),
    ('135', '8', 'Petatán', 'true'),
    ('136', '9', 'Puerto Barrios', 'true'),
    ('137', '9', 'Livingston', 'true'),
    ('138', '9', 'El Estor', 'true'),
    ('139', '9', 'Morales', 'true'),
    ('140', '9', 'Los Amates', 'true'),
    ('141', '10', 'Jalapa', 'true'),
    ('142', '10', 'San Pedro Pinula', 'true'),
    ('143', '10', 'San Luis Jilotepeque', 'true'),
    ('144', '10', 'San Manuel Chaparrón', 'true'),
    ('145', '10', 'San Carlos Alzatate', 'true'),
    ('146', '10', 'Monjas', 'true'),
    ('147', '10', 'Mataquescuintla', 'true'),
    ('148', '11', 'Jutiapa', 'true'),
    ('149', '11', 'El Progreso', 'true'),
    ('150', '11', 'Santa Catarina Mita', 'true'),
    ('151', '11', 'Agua Blanca', 'true'),
    ('152', '11', 'Asunción Mita', 'true'),
    ('153', '11', 'Yupiltepeque', 'true'),
    ('154', '11', 'Atescatempa', 'true'),
    ('155', '11', 'Jerez', 'true'),
    ('156', '11', 'El Adelanto', 'true'),
    ('157', '11', 'Zapotitlán', 'true'),
    ('158', '11', 'Comapa', 'true'),
    ('159', '11', 'Jalpatagua', 'true'),
    ('160', '11', 'Conguaco', 'true'),
    ('161', '11', 'Moyuta', 'true'),
    ('162', '11', 'Pasaco', 'true'),
    ('163', '11', 'San José Acatempa', 'true'),
    ('164', '11', 'Quesada', 'true'),
    ('165', '12', 'Flores', 'true'),
    ('166', '12', 'San José', 'true'),
    ('167', '12', 'San Benito', 'true'),
    ('168', '12', 'San Andrés', 'true'),
    ('169', '12', 'La Libertad', 'true'),
    ('170', '12', 'San Francisco', 'true'),
    ('171', '12', 'Santa Ana', 'true'),
    ('172', '12', 'Dolores', 'true'),
    ('173', '12', 'San Luis', 'true'),
    ('174', '12', 'Sayaxché', 'true'),
    ('175', '12', 'Melchor de Mencos', 'true'),
    ('176', '12', 'Poptún', 'true'),
    ('177', '12', 'Las Cruces', 'true'),
    ('178', '12', 'El Chal', 'true'),
    ('179', '13', 'Quetzaltenango', 'true'),
    ('180', '13', 'Salcajá', 'true'),
    ('181', '13', 'Olintepeque', 'true'),
    ('182', '13', 'San Carlos Sija', 'true'),
    ('183', '13', 'Sibilia', 'true'),
    ('184', '13', 'Cabricán', 'true'),
    ('185', '13', 'Cajolá', 'true'),
    ('186', '13', 'San Miguel Sigüilá', 'true'),
    ('187', '13', 'Ostuncalco', 'true'),
    ('188', '13', 'San Mateo', 'true'),
    ('189', '13', 'Concepción Chiquirichapa', 'true'),
    ('190', '13', 'San Martín Sacatepéquez', 'true'),
    ('191', '13', 'Almolonga', 'true'),
    ('192', '13', 'Cantel', 'true'),
    ('193', '13', 'Huitán', 'true'),
    ('194', '13', 'Zunil', 'true'),
    ('195', '13', 'Colomba', 'true'),
    ('196', '13', 'San Francisco La Unión', 'true'),
    ('197', '13', 'El Palmar', 'true'),
    ('198', '13', 'Coatepeque', 'true'),
    ('199', '13', 'Génova', 'true'),
    ('200', '13', 'Flores Costa Cuca', 'true'),
    ('201', '13', 'La Esperanza', 'true'),
    ('202', '13', 'Palestina de Los Altos', 'true'),
    ('203', '14', 'Santa Cruz del Quiché', 'true'),
    ('204', '14', 'Chiché', 'true'),
    ('205', '14', 'Chinique', 'true'),
    ('206', '14', 'Zacualpa', 'true'),
    ('207', '14', 'Chajul', 'true'),
    ('208', '14', 'Santo Tomás Chichicastenango', 'true'),
    ('209', '14', 'Patzité', 'true'),
    ('210', '14', 'San Antonio Ilotenango', 'true'),
    ('211', '14', 'San Pedro Jocopilas', 'true'),
    ('212', '14', 'Cunén', 'true'),
    ('213', '14', 'San Juan Cotzal', 'true'),
    ('214', '14', 'Joyabaj', 'true'),
    ('215', '14', 'Nebaj', 'true'),
    ('216', '14', 'San Andrés Sajcabajá', 'true'),
    ('217', '14', 'Uspantán', 'true'),
    ('218', '14', 'Sacapulas', 'true'),
    ('219', '14', 'San Bartolomé Jocotenango', 'true'),
    ('220', '14', 'Canillá', 'true'),
    ('221', '14', 'Chicamán', 'true'),
    ('222', '14', 'Ixcán', 'true'),
    ('223', '14', 'Pachalum', 'true'),
    ('224', '15', 'Retalhuleu', 'true'),
    ('225', '15', 'San Sebastián', 'true'),
    ('226', '15', 'Santa Cruz Muluá', 'true'),
    ('227', '15', 'San Martín Zapotitlán', 'true'),
    ('228', '15', 'San Felipe', 'true'),
    ('229', '15', 'San Andrés Villa Seca', 'true'),
    ('230', '15', 'Champerico', 'true'),
    ('231', '15', 'Nuevo San Carlos', 'true'),
    ('232', '15', 'El Asintal', 'true'),
    ('233', '16', 'Antigua Guatemala', 'true'),
    ('234', '16', 'Jocotenango', 'true'),
    ('235', '16', 'Pastores', 'true'),
    ('236', '16', 'Sumpango', 'true'),
    ('237', '16', 'Santo Domingo Xenacoj', 'true'),
    ('238', '16', 'Santiago Sacatepéquez', 'true'),
    ('239', '16', 'San Bartolomé Milpas Altas', 'true'),
    ('240', '16', 'San Lucas Sacatepéquez', 'true'),
    ('241', '16', 'Santa Lucía Milpas Altas', 'true'),
    ('242', '16', 'Magdalena Milpas Altas', 'true'),
    ('243', '16', 'Santa María de Jesús', 'true'),
    ('244', '16', 'Ciudad Vieja', 'true'),
    ('245', '16', 'San Miguel Dueñas', 'true'),
    ('246', '16', 'Alotenango', 'true'),
    ('247', '16', 'San Antonio Aguas Calientes', 'true'),
    ('248', '16', 'Santa Catarina Barahona', 'true'),
    ('249', '17', 'San Marcos', 'true'),
    ('250', '17', 'San Pedro Sacatepéquez', 'true'),
    ('251', '17', 'San Antonio Sacatepéquez', 'true'),
    ('252', '17', 'Comitancillo', 'true'),
    ('253', '17', 'San Miguel Ixtahuacán', 'true'),
    ('254', '17', 'Concepción Tutuapa', 'true'),
    ('255', '17', 'Tacaná', 'true'),
    ('256', '17', 'Sibinal', 'true'),
    ('257', '17', 'Tajumulco', 'true'),
    ('258', '17', 'Tejutla', 'true'),
    ('259', '17', 'San Rafael Pie de la Cuesta', 'true'),
    ('260', '17', 'Nuevo Progreso', 'true'),
    ('261', '17', 'El Tumbador', 'true'),
    ('262', '17', 'San José El Rodeo', 'true'),
    ('263', '17', 'Malacatán', 'true'),
    ('264', '17', 'Catarina', 'true'),
    ('265', '17', 'Ayutla', 'true'),
    ('266', '17', 'Ocós', 'true'),
    ('267', '17', 'San Pablo', 'true'),
    ('268', '17', 'El Quetzal', 'true'),
    ('269', '17', 'La Reforma', 'true'),
    ('270', '17', 'Pajapita', 'true'),
    ('271', '17', 'Ixchiguán', 'true'),
    ('272', '17', 'San José Ojetenam', 'true'),
    ('273', '17', 'San Cristóbal Cucho', 'true'),
    ('274', '17', 'Sipacapa', 'true'),
    ('275', '17', 'Esquipulas Palo Gordo', 'true'),
    ('276', '17', 'Río Blanco', 'true'),
    ('277', '17', 'San Lorenzo', 'true'),
    ('278', '17', 'La Blanca', 'true'),
    ('279', '18', 'Cuilapa', 'true'),
    ('280', '18', 'Barberena', 'true'),
    ('281', '18', 'Santa Rosa de Lima', 'true'),
    ('282', '18', 'Casillas', 'true'),
    ('283', '18', 'San Rafael Las Flores', 'true'),
    ('284', '18', 'Oratorio', 'true'),
    ('285', '18', 'San Juan Tecuaco', 'true'),
    ('286', '18', 'Chiquimulilla', 'true'),
    ('287', '18', 'Taxisco', 'true'),
    ('288', '18', 'Santa María Ixhuatán', 'true'),
    ('289', '18', 'Guazacapán', 'true'),
    ('290', '18', 'Santa Cruz Naranjo', 'true'),
    ('291', '18', 'Pueblo Nuevo Viñas', 'true'),
    ('292', '18', 'Nueva Santa Rosa', 'true'),
    ('293', '19', 'Sololá', 'true'),
    ('294', '19', 'San José Chacayá', 'true'),
    ('295', '19', 'Santa María Visitación', 'true'),
    ('296', '19', 'Santa Lucía Utatlán', 'true'),
    ('297', '19', 'Nahualá', 'true'),
    ('298', '19', 'Santa Catarina Ixtahuacán', 'true'),
    ('299', '19', 'Santa Clara La Laguna', 'true'),
    ('300', '19', 'Concepción', 'true'),
    ('301', '19', 'San Andrés Semetabaj', 'true'),
    ('302', '19', 'Panajachel', 'true'),
    ('303', '19', 'Santa Catarina Palopó', 'true'),
    ('304', '19', 'San Antonio Palopó', 'true'),
    ('305', '19', 'San Lucas Tolimán', 'true'),
    ('306', '19', 'Santa Cruz La Laguna', 'true'),
    ('307', '19', 'San Pablo La Laguna', 'true'),
    ('308', '19', 'San Marcos La Laguna', 'true'),
    ('309', '19', 'San Juan La Laguna', 'true'),
    ('310', '19', 'San Pedro La Laguna', 'true'),
    ('311', '19', 'Santiago Atitlán', 'true'),
    ('312', '20', 'Mazatenango', 'true'),
    ('313', '20', 'Cuyotenango', 'true'),
    ('314', '20', 'San Francisco Zapotitlán', 'true'),
    ('315', '20', 'San Bernardino', 'true'),
    ('316', '20', 'San José El Ídolo', 'true'),
    ('317', '20', 'Santo Domingo Suchitepéquez', 'true'),
    ('318', '20', 'San Lorenzo', 'true'),
    ('319', '20', 'Samayac', 'true'),
    ('320', '20', 'San Pablo Jocopilas', 'true'),
    ('321', '20', 'San Antonio Suchitepéquez', 'true'),
    ('322', '20', 'San Miguel Panán', 'true'),
    ('323', '20', 'San Gabriel', 'true'),
    ('324', '20', 'Chicacao', 'true'),
    ('325', '20', 'Patulul', 'true'),
    ('326', '20', 'Santa Bárbara', 'true'),
    ('327', '20', 'San Juan Bautista', 'true'),
    ('328', '20', 'Santo Tomás La Unión', 'true'),
    ('329', '20', 'Zunilito', 'true'),
    ('330', '20', 'Pueblo Nuevo', 'true'),
    ('331', '20', 'Río Bravo', 'true'),
    ('332', '20', 'San José La Máquina', 'true'),
    ('333', '21', 'Totonicapán', 'true'),
    ('334', '21', 'San Cristóbal Totonicapán', 'true'),
    ('335', '21', 'San Francisco El Alto', 'true'),
    ('336', '21', 'San Andrés Xecul', 'true'),
    ('337', '21', 'Momostenango', 'true'),
    ('338', '21', 'Santa María Chiquimula', 'true'),
    ('339', '21', 'Santa Lucía La Reforma', 'true'),
    ('340', '21', 'San Bartolo', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.municipio', 'id'), (SELECT max(id) FROM public.municipio));

INSERT INTO public.estado_civil (id, nombre, descripcion, activo) VALUES
    ('1', 'Soltero(a)', 'Persona que nunca ha contraído matrimonio ni ha formalizado una unión de hecho.', 'true'),
    ('2', 'Casado(a)', 'Persona unida en matrimonio legal.', 'true'),
    ('3', 'Divorciado(a)', 'Persona cuyo matrimonio se disolvió legalmente.', 'true'),
    ('4', 'Viudo(a)', 'Persona cuyo cónyuge ha fallecido.', 'true'),
    ('5', 'Unión de hecho', 'Situación reconocida legalmente cuando una pareja convive por cierto tiempo con ánimo de permanencia.', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.estado_civil', 'id'), (SELECT max(id) FROM public.estado_civil));

INSERT INTO public.ocupacion (id, nombre, activo) VALUES
    ('1', 'Ama de casa', 'true'),
    ('2', 'Agricultor(a)', 'true'),
    ('3', 'Comerciante', 'true'),
    ('4', 'Jornalero(a)', 'true'),
    ('5', 'Estudiante', 'true'),
    ('6', 'Otra', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.ocupacion', 'id'), (SELECT max(id) FROM public.ocupacion));

INSERT INTO public.grado_academico (id, nombre, activo) VALUES
    ('1', 'Ninguno', 'true'),
    ('2', 'Educación primaria', 'true'),
    ('3', 'Educación básica', 'true'),
    ('4', 'Educación de nivel diversificado', 'true'),
    ('5', 'Educación superior o universitaria', 'true')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.grado_academico', 'id'), (SELECT max(id) FROM public.grado_academico));

INSERT INTO public.discapacidad (id, nombre, activo) VALUES
    ('1', 'Motriz', 'true'),
    ('2', 'Visual', 'true'),
    ('3', 'Auditiva', 'true'),
    ('4', 'Intelectual', 'true'),
    ('5', 'Psicosocial', 'true'),
    ('6', 'Del habla', 'true'),
    ('7', 'Múltiple', 'false')
ON CONFLICT DO NOTHING;
SELECT setval(pg_get_serial_sequence('public.discapacidad', 'id'), (SELECT max(id) FROM public.discapacidad));

-- ============================================================================
-- 4. MIGRACION 28 (formato del CUI/DPI)
--
-- Se incorpora tal cual: en una base recien creada el UPDATE no encuentra
-- filas y el CHECK se agrega directamente.
-- ============================================================================
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

-- ============================================================================
-- 5. CONEXION DEL ROL Y ZONA HORARIA DE ESTA BASE
--
-- Con bloques DO y current_database(): el v3 tenia el nombre de la base
-- escrito a mano ("dmm_usumatlan_db"), y en cualquier otra base el GRANT
-- CONNECT fallaba o, peor, se aplicaba a una base distinta.
--
-- La zona horaria solo afecta a sesiones NUEVAS: reconecte despues.
-- ============================================================================
DO $conexion$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO dmm_app', current_database());
    EXECUTE format(
        'ALTER DATABASE %I SET timezone = %L',
        current_database(), 'America/Guatemala'
    );
END
$conexion$;
