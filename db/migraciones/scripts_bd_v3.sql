-- ============================================================================
-- SISTEMA DMM USUMATLAN — ESQUEMA COMPLETO (v3)
--
-- Reconstruye la base de datos desde cero: tablas, funciones, procedimientos,
-- vistas, triggers, datos semilla y las migraciones 09 a 13 ya incorporadas.
--
-- Se ejecuta de principio a fin sin errores, tanto con `psql -f` como pegado
-- en el Query Tool de pgAdmin.
--
-- ----------------------------------------------------------------------------
-- ANTES DE EJECUTAR
--
--  1. Cree la base CONECTADO COMO EL USUARIO DUEÑO (normalmente `postgres`),
--     nunca como `dmm_app`:
--
--         CREATE DATABASE dmm_usumatlan_db;
--
--     Esto importa mas de lo que parece. En Postgres el que crea un objeto es
--     su dueño, y un dueño puede hacer DROP, ALTER y DISABLE TRIGGER sobre sus
--     tablas SIN IMPORTAR cuantos REVOKE se le apliquen -- `has_table_privilege`
--     incluso devuelve false para un dueño y aun asi puede tirar la tabla.
--     Ademas, quien sea dueño de la BASE hereda `pg_database_owner`, que es
--     dueño del esquema public, y conserva CREATE pase lo que pase.
--
--     Montar la base con `dmm_app` anula buena parte de la migracion 12.
--
--  2. Si la base ya existe y su dueño es otro, corrijalo CONECTADO A OTRA BASE
--     (ALTER DATABASE ... OWNER TO no funciona sobre la base actual):
--
--         ALTER DATABASE dmm_usumatlan_db OWNER TO postgres;
--
--  3. Ejecute este script conectado a la base recien creada, como el dueño.
--
-- ----------------------------------------------------------------------------
-- DESPUES DE EJECUTAR
--
--  1. RECONECTE. El bloque de zona horaria usa ALTER DATABASE ... SET, que solo
--     afecta a sesiones nuevas: reinicie el backend y cierre/reabra pgAdmin.
--
--  2. Cambie la clave del rol de aplicacion (la migracion 12 lo crea con una
--     de marcador):
--
--         ALTER ROLE dmm_app PASSWORD 'una-clave-larga-y-aleatoria';
--
--  3. Apunte el backend a ese rol en el .env, y deje el usuario dueño en una
--     variable aparte: `prisma db pull` y las migraciones futuras lo necesitan.
--
--         DATABASE_URL="postgresql://dmm_app:CLAVE@localhost:5432/dmm_usumatlan_db"
--         DATABASE_URL_OWNER="postgresql://postgres:CLAVE@localhost:5432/dmm_usumatlan_db"
--
--  4. Cree el primer usuario ADMINISTRADOR por SQL, con el hash bcrypt ya
--     generado. No hay endpoint de registro publico, por diseño.
--
--  5. Verifique:
--
--         SELECT current_setting('TimeZone'), CURRENT_DATE;   -- America/Guatemala
--         SELECT count(*) FROM pg_tables
--          WHERE schemaname='public' AND tableowner='dmm_app';         -- 0
--         SELECT has_schema_privilege('dmm_app','public','CREATE');    -- false
--         SELECT prosecdef FROM pg_proc WHERE proname='fn_auditoria';  -- true
--
-- ----------------------------------------------------------------------------
-- PARA LA BASE DE PRUEBAS (dmm_test)
--
-- Mismos pasos, misma propiedad. Una base de pruebas montada con mas
-- privilegios que produccion produce pruebas que mienten: dejarian pasar cosas
-- que en produccion fallan.
--
-- ----------------------------------------------------------------------------
-- MIGRACIONES INCORPORADAS
--
--   09_zona_horaria                        America/Guatemala
--   10_auditoria_sesion_sin_latido         quita el ruido del refresco de sesion
--   11_indices_auditoria                   indices para GET /api/auditoria
--   12_rol_aplicacion_minimo_privilegio    rol dmm_app + auditoria inalterable
--   13_fix_recalculo_al_anular_entrega     regresion de estado al anular
--
-- No hace falta aplicarlas por separado sobre una base creada con este script.
-- ============================================================================


-- =====================================================================
-- SISTEMA DMM (Direccion Municipal de la Mujer) - Usumatlan, Zacapa
-- FASE 1 (v2): Esquema de tablas (DDL) - normalizado y con constraints robustas
-- =====================================================================
-- Version 2: incorpora 11 cambios acordados tras revision de consistencia:
--   1. encargado_menor.parentesco -> catalogo tipo_parentesco
--   2. entrega.parentesco_receptor -> FK al mismo catalogo tipo_parentesco
--   3. Eliminado persona.documento_identificacion (redundante con documento_persona)
--   4. contacto_responsable -> tabla contacto_referencia_persona (1:N, nombre+telefono)
--   5. Nueva tabla documento_recepcion; eliminado recepcion_donacion_lote.documento_respaldo
--   6. Eliminada asignacion_pendiente (absorbida por detalle_solicitud_apoyo)
--   7. Rediseno: solicitud_apoyo (cabecera) + detalle_solicitud_apoyo (linea por insumo)
--   8. Nueva tabla receta_medica (vinculada a cabecera, referenciada opcional desde cada linea)
--   9. persona.genero -> catalogo tipo_genero
--   10. contrato_prestamo: quita numero_documento/observaciones/fecha_extendida_hasta;
--       agrega ruta_documento_firmado, detalle_entrega_id (antes entrega_id), contrato_anterior_id
--   11. Nuevas tablas tipo_multa_prestamo (catalogo) + multa_prestamo (movimiento)
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------
-- SEG: Seguridad y autenticacion
-- ---------------------------------------------------------------------

CREATE TABLE public.rol
(
    id              serial PRIMARY KEY,
    nombre          character varying(50) NOT NULL,
    descripcion     text,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT rol_nombre_key UNIQUE (nombre),
    CONSTRAINT rol_nombre_valido_check CHECK (
        nombre IN ('EMPLEADO_DMM', 'DIRECTORA', 'ALCALDE', 'ADMINISTRADOR')
    )
);

CREATE TABLE public.usuario
(
    id              serial PRIMARY KEY,
    username        character varying(50) NOT NULL,
    password_hash   character varying(255) NOT NULL,
    rol_id          integer NOT NULL,
    ultimo_login    timestamp,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT usuario_username_key UNIQUE (username),
    CONSTRAINT usuario_username_no_vacio_check CHECK (length(trim(username)) > 0),
    CONSTRAINT fk_usuario_rol FOREIGN KEY (rol_id)
        REFERENCES public.rol (id) ON UPDATE NO ACTION ON DELETE RESTRICT
);

ALTER TABLE public.rol
    ADD CONSTRAINT fk_rol_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    ADD CONSTRAINT fk_rol_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id);

ALTER TABLE public.usuario
    ADD CONSTRAINT fk_usuario_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    ADD CONSTRAINT fk_usuario_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id);

CREATE TABLE public.tipo_accion_auditoria
(
    id              serial PRIMARY KEY,
    nombre          character varying(10) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT tipo_accion_auditoria_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_taa_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_taa_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.auditoria_log
(
    id                  bigserial PRIMARY KEY,
    tabla_afectada      character varying(50) NOT NULL,
    registro_id         integer NOT NULL,
    tipo_accion_id      integer NOT NULL,
    usuario_id          integer,
    fecha_hora          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    valores_antiguos    jsonb,
    valores_nuevos      jsonb,
    CONSTRAINT fk_auditoria_tipo_accion FOREIGN KEY (tipo_accion_id)
        REFERENCES public.tipo_accion_auditoria (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id)
        REFERENCES public.usuario (id) ON UPDATE NO ACTION ON DELETE SET NULL
);
CREATE INDEX idx_auditoria_tipo_accion ON public.auditoria_log (tipo_accion_id);

-- ---------------------------------------------------------------------
-- sesion: RNF-SEG-03 (expiracion por inactividad de 30 minutos).
-- La vigencia por inactividad se valida en el middleware del backend
-- (depende de NOW() en tiempo de request, no de insercion, por eso no
-- vive en un CHECK/constraint de esta tabla).
--
-- expira_en (tope absoluto de 12 horas desde created_at, independiente
-- de la actividad): es una decision de diseno propia (buena practica de
-- seguridad para evitar sesiones indefinidas sostenidas solo por
-- trafico continuo), NO proviene de un requisito confirmado por el
-- cliente -- se deja documentado explicitamente para no confundirla con
-- RNF-SEG-03 en revisiones futuras.
--
-- Nunca se eliminan filas (evidencia de acceso para auditoria de
-- seguridad); por eso el trigger de auditoria de esta tabla solo cubre
-- INSERT/UPDATE, no DELETE (excepcion deliberada al patron estandar del
-- resto del sistema, que audita los 3 eventos).
-- ---------------------------------------------------------------------
CREATE TABLE public.sesion
(
    id                  bigserial PRIMARY KEY,
    usuario_id          integer NOT NULL,
    token_hash          character varying(64) NOT NULL,
    ip_origen           character varying(45),
    user_agent          text,
    ultima_actividad     timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expira_en            timestamp NOT NULL,
    revocada_en          timestamp,
    created_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp,
    created_by          integer,
    updated_by          integer,
    CONSTRAINT sesion_token_hash_key UNIQUE (token_hash),
    CONSTRAINT sesion_expira_en_valida_check CHECK (expira_en > created_at),
    CONSTRAINT sesion_revocada_coherente_check CHECK (
        revocada_en IS NULL OR revocada_en >= created_at
    ),
    CONSTRAINT fk_sesion_usuario FOREIGN KEY (usuario_id)
        REFERENCES public.usuario (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_sesion_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_sesion_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

-- Busqueda principal del middleware de auth: por token_hash (ya cubierta
-- por el UNIQUE de arriba). Este indice adicional acelera "listar/
-- revocar todas las sesiones activas de un usuario" (Administrador
-- forzando cierre de sesion, o el propio usuario viendo sus sesiones
-- abiertas).
CREATE INDEX idx_sesion_usuario_activas
    ON public.sesion (usuario_id)
    WHERE revocada_en IS NULL;

COMMENT ON TABLE public.sesion IS
    'RNF-SEG-03. Sesiones de usuario con estado en servidor. La inactividad (30 min) se valida en el middleware de autenticacion del backend. El tope absoluto de 12h (expira_en) es decision de diseno propia, no requisito confirmado por el cliente. Nunca se eliminan filas de esta tabla (evidencia de acceso para auditoria/seguridad).';
COMMENT ON COLUMN public.sesion.token_hash IS
    'Hash (SHA-256) del token de sesion. El valor en claro solo existe en la cookie HttpOnly del cliente, nunca se persiste.';
COMMENT ON COLUMN public.sesion.ultima_actividad IS
    'Se actualiza en cada request autenticado exitoso. Base para el corte de inactividad de 30 minutos (RNF-SEG-03).';
COMMENT ON COLUMN public.sesion.expira_en IS
    'Tope absoluto de vigencia (created_at + 12 horas, decision de diseno propia), independiente de la actividad.';
COMMENT ON COLUMN public.sesion.revocada_en IS
    'NULL mientras la sesion esta vigente. Se establece en logout explicito o revocacion administrativa (ej. desactivar el usuario).';

-- ---------------------------------------------------------------------
-- Geografia: departamento -> municipio -> comunidad
-- ---------------------------------------------------------------------

CREATE TABLE public.departamento
(
    id              serial PRIMARY KEY,
    nombre          character varying(100) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT departamento_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_depto_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_depto_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.municipio
(
    id              serial PRIMARY KEY,
    departamento_id integer NOT NULL,
    nombre          character varying(100) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT municipio_nombre_departamento_key UNIQUE (nombre, departamento_id),
    CONSTRAINT fk_municipio_departamento FOREIGN KEY (departamento_id)
        REFERENCES public.departamento (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_muni_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_muni_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_municipio_departamento ON public.municipio (departamento_id);

CREATE TABLE public.comunidad
(
    id              serial PRIMARY KEY,
    municipio_id    integer NOT NULL,
    nombre          character varying(100) NOT NULL,
    ubicacion       character varying(255),
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT comunidad_nombre_municipio_key UNIQUE (nombre, municipio_id),
    CONSTRAINT fk_comunidad_municipio FOREIGN KEY (municipio_id)
        REFERENCES public.municipio (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_com_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_com_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

-- ---------------------------------------------------------------------
-- BEN: Beneficiarios
-- ---------------------------------------------------------------------

CREATE TABLE public.discapacidad
(
    id              serial PRIMARY KEY,
    nombre          character varying(100) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT discapacidad_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_dis_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_dis_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

-- Cambio #9: catalogo tipo_genero (antes VARCHAR + CHECK en persona.genero)
CREATE TABLE public.tipo_genero
(
    id              serial PRIMARY KEY,
    nombre          character varying(30) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT tipo_genero_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_tg_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_tg_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

-- Cambio #1/#2: catalogo tipo_parentesco compartido entre encargado_menor
-- y entrega.tipo_parentesco_receptor_id
CREATE TABLE public.tipo_parentesco
(
    id              serial PRIMARY KEY,
    nombre          character varying(50) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT tipo_parentesco_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_tp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_tp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.persona
(
    id                          serial PRIMARY KEY,
    cui_dpi                     character varying(13),
    nombres                     character varying(100) NOT NULL,
    apellidos                   character varying(100) NOT NULL,
    fecha_nacimiento            date NOT NULL,
    genero_id                   integer,
    comunidad_id                integer,
    telefono                    character varying(20),
    activo                      boolean NOT NULL DEFAULT true,
    created_at                  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  timestamp,
    created_by                  integer,
    updated_by                  integer,
    CONSTRAINT persona_cui_dpi_key UNIQUE (cui_dpi),
    CONSTRAINT persona_nombres_no_vacio_check CHECK (length(trim(nombres)) > 0),
    CONSTRAINT persona_apellidos_no_vacio_check CHECK (length(trim(apellidos)) > 0),
    CONSTRAINT persona_fecha_nacimiento_valida_check CHECK (
        fecha_nacimiento <= CURRENT_DATE AND fecha_nacimiento > CURRENT_DATE - INTERVAL '120 years'
    ),
    CONSTRAINT fk_persona_comunidad FOREIGN KEY (comunidad_id)
        REFERENCES public.comunidad (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_persona_genero FOREIGN KEY (genero_id)
        REFERENCES public.tipo_genero (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_per_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_per_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_persona_comunidad ON public.persona (comunidad_id);
CREATE INDEX idx_persona_cui_dpi ON public.persona (cui_dpi) WHERE cui_dpi IS NOT NULL;
CREATE INDEX idx_persona_nombres ON public.persona USING gin (
    (nombres || ' ' || apellidos) gin_trgm_ops
);

-- Cambio #4: contacto_referencia_persona (nueva, reemplaza persona.contacto_responsable)
CREATE TABLE public.contacto_referencia_persona
(
    id              serial PRIMARY KEY,
    persona_id      integer NOT NULL,
    nombre          character varying(150) NOT NULL,
    telefono        character varying(20),
    observaciones   text,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT contacto_referencia_nombre_no_vacio_check CHECK (length(trim(nombre)) > 0),
    CONSTRAINT fk_crp_persona FOREIGN KEY (persona_id)
        REFERENCES public.persona (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_crp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_crp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_contacto_referencia_persona ON public.contacto_referencia_persona (persona_id);

CREATE TABLE public.tipo_documento_persona
(
    id              serial PRIMARY KEY,
    nombre          character varying(50) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT tipo_documento_persona_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_tdp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_tdp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.documento_persona
(
    id                  serial PRIMARY KEY,
    persona_id          integer NOT NULL,
    tipo_documento_id   integer NOT NULL,
    numero_documento    character varying(100),
    ruta_archivo         character varying(500),
    observaciones        text,
    activo              boolean NOT NULL DEFAULT true,
    created_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp,
    created_by          integer,
    updated_by          integer,
    CONSTRAINT fk_dp_persona FOREIGN KEY (persona_id)
        REFERENCES public.persona (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_dp_tipo FOREIGN KEY (tipo_documento_id)
        REFERENCES public.tipo_documento_persona (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_dp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_dp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_documento_persona_persona ON public.documento_persona (persona_id);

CREATE TABLE public.persona_discapacidad
(
    persona_id      integer NOT NULL,
    discapacidad_id integer NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT persona_discapacidad_pkey PRIMARY KEY (persona_id, discapacidad_id),
    CONSTRAINT fk_pd_persona FOREIGN KEY (persona_id)
        REFERENCES public.persona (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_pd_discapacidad FOREIGN KEY (discapacidad_id)
        REFERENCES public.discapacidad (id) ON UPDATE NO ACTION ON DELETE RESTRICT
);

-- Cambio #1: encargado_menor.parentesco ahora es FK a tipo_parentesco
CREATE TABLE public.encargado_menor
(
    menor_id            integer NOT NULL,
    encargado_id        integer NOT NULL,
    tipo_parentesco_id  integer NOT NULL,
    activo              boolean NOT NULL DEFAULT true,
    created_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp,
    created_by          integer,
    updated_by          integer,
    CONSTRAINT encargado_menor_pkey PRIMARY KEY (menor_id, encargado_id),
    CONSTRAINT encargado_menor_distintos_check CHECK (menor_id <> encargado_id),
    CONSTRAINT fk_em_menor FOREIGN KEY (menor_id)
        REFERENCES public.persona (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_em_encargado FOREIGN KEY (encargado_id)
        REFERENCES public.persona (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_em_parentesco FOREIGN KEY (tipo_parentesco_id)
        REFERENCES public.tipo_parentesco (id) ON UPDATE NO ACTION ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------
-- PRO: Programas y solicitudes
-- ---------------------------------------------------------------------

CREATE TABLE public.programa
(
    id              serial PRIMARY KEY,
    nombre          character varying(100) NOT NULL,
    descripcion     text,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT programa_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_prog_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_prog_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

-- ---------------------------------------------------------------------
-- INV: Inventario y donaciones
-- ---------------------------------------------------------------------

CREATE TABLE public.institucion_donante
(
    id              serial PRIMARY KEY,
    nombre          character varying(150) NOT NULL,
    telefono        character varying(20),
    correo          character varying(100),
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT institucion_donante_nombre_key UNIQUE (nombre),
    CONSTRAINT institucion_donante_correo_valido_check CHECK (
        correo IS NULL OR correo ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    ),
    CONSTRAINT fk_ins_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_ins_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.unidad_medida
(
    id              serial PRIMARY KEY,
    nombre          character varying(30) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT unidad_medida_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_um_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_um_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.categoria_insumo
(
    id                          serial PRIMARY KEY,
    nombre                      character varying(100) NOT NULL,
    requiere_fecha_caducidad    boolean NOT NULL DEFAULT false,
    requiere_codigo_fabricante  boolean NOT NULL DEFAULT false,
    bloquea_solicitud_sin_stock boolean NOT NULL DEFAULT false,
    activo                      boolean NOT NULL DEFAULT true,
    created_at                  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  timestamp,
    created_by                  integer,
    updated_by                  integer,
    CONSTRAINT categoria_insumo_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_cat_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_cat_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.insumo
(
    id                      serial PRIMARY KEY,
    categoria_id            integer NOT NULL,
    unidad_medida_base_id   integer NOT NULL,
    nombre                  character varying(150) NOT NULL,
    descripcion             text,
    es_perecedero           boolean NOT NULL DEFAULT false,
    activo                  boolean NOT NULL DEFAULT true,
    created_at              timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              timestamp,
    created_by              integer,
    updated_by              integer,
    CONSTRAINT insumo_nombre_categoria_key UNIQUE (nombre, categoria_id),
    CONSTRAINT fk_insumo_categoria FOREIGN KEY (categoria_id)
        REFERENCES public.categoria_insumo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_insumo_unidad_base FOREIGN KEY (unidad_medida_base_id)
        REFERENCES public.unidad_medida (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_ins2_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_ins2_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.presentacion_insumo
(
    id                  serial PRIMARY KEY,
    insumo_id           integer NOT NULL,
    unidad_medida_id    integer NOT NULL,
    factor_a_base       numeric(12,4) NOT NULL,
    es_default          boolean NOT NULL DEFAULT false,
    activo              boolean NOT NULL DEFAULT true,
    created_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp,
    created_by          integer,
    updated_by          integer,
    CONSTRAINT presentacion_insumo_factor_check CHECK (factor_a_base > 0),
    CONSTRAINT presentacion_insumo_insumo_unidad_key UNIQUE (insumo_id, unidad_medida_id),
    CONSTRAINT fk_pi_insumo FOREIGN KEY (insumo_id)
        REFERENCES public.insumo (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_pi_unidad FOREIGN KEY (unidad_medida_id)
        REFERENCES public.unidad_medida (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_pi_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_pi_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_presentacion_insumo ON public.presentacion_insumo (insumo_id);
CREATE UNIQUE INDEX idx_presentacion_default_unica
    ON public.presentacion_insumo (insumo_id) WHERE es_default = true;

CREATE TABLE public.recepcion_donacion_lote
(
    id                          serial PRIMARY KEY,
    codigo_lote                 character varying(50),
    fecha_recepcion             date NOT NULL DEFAULT CURRENT_DATE,
    institucion_id              integer NOT NULL,
    observaciones_generales     text,
    activo                      boolean NOT NULL DEFAULT true,
    created_at                  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  timestamp,
    created_by                  integer,
    updated_by                  integer,
    CONSTRAINT recepcion_donacion_lote_fecha_valida_check CHECK (fecha_recepcion <= CURRENT_DATE),
    CONSTRAINT recepcion_donacion_lote_codigo_lote_key UNIQUE (codigo_lote),
    CONSTRAINT fk_recepcion_institucion FOREIGN KEY (institucion_id)
        REFERENCES public.institucion_donante (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_rec_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_rec_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_recepcion_codigo_lote
    ON public.recepcion_donacion_lote (codigo_lote) WHERE codigo_lote IS NOT NULL;

-- Cambio #5: documento_recepcion (nueva)
CREATE TABLE public.documento_recepcion
(
    id                  serial PRIMARY KEY,
    recepcion_lote_id   integer NOT NULL,
    ruta_archivo         character varying(500) NOT NULL,
    descripcion          character varying(255),
    activo              boolean NOT NULL DEFAULT true,
    created_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp,
    created_by          integer,
    updated_by          integer,
    CONSTRAINT fk_dr_recepcion FOREIGN KEY (recepcion_lote_id)
        REFERENCES public.recepcion_donacion_lote (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_dr_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_dr_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_documento_recepcion_recepcion ON public.documento_recepcion (recepcion_lote_id);

CREATE TABLE public.detalle_inventario_lote
(
    id                          serial PRIMARY KEY,
    insumo_id                   integer NOT NULL,
    recepcion_lote_id           integer NOT NULL,
    presentacion_recepcion_id   integer NOT NULL,
    cantidad_recepcion_original numeric(12,4) NOT NULL,
    codigo_lote_fabricante      character varying(50),
    fecha_caducidad             date,
    cantidad_inicial            integer NOT NULL,
    cantidad_disponible         integer NOT NULL,
    observaciones               text,
    activo                      boolean NOT NULL DEFAULT true,
    created_at                  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  timestamp,
    created_by                  integer,
    updated_by                  integer,
    CONSTRAINT detalle_inventario_lote_cantidad_inicial_check CHECK (cantidad_inicial > 0),
    CONSTRAINT detalle_inventario_lote_cantidad_disponible_check CHECK (cantidad_disponible >= 0),
    CONSTRAINT detalle_inventario_lote_cantidad_coherente_check CHECK (cantidad_disponible <= cantidad_inicial),
    CONSTRAINT detalle_inventario_lote_cantidad_recepcion_check CHECK (cantidad_recepcion_original > 0),
    CONSTRAINT fk_detalle_lote_insumo FOREIGN KEY (insumo_id)
        REFERENCES public.insumo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_detalle_lote_recepcion FOREIGN KEY (recepcion_lote_id)
        REFERENCES public.recepcion_donacion_lote (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_detalle_lote_presentacion FOREIGN KEY (presentacion_recepcion_id)
        REFERENCES public.presentacion_insumo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_detalle_lote_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_detalle_lote_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_detalle_inventario_fifo
    ON public.detalle_inventario_lote (insumo_id, activo, fecha_caducidad)
    WHERE activo = true AND cantidad_disponible > 0;
CREATE INDEX idx_detalle_inventario_recepcion
    ON public.detalle_inventario_lote (recepcion_lote_id);

-- ---------------------------------------------------------------------
-- Cambio #7: solicitud_apoyo (CABECERA) + detalle_solicitud_apoyo (LINEA)
-- ---------------------------------------------------------------------

CREATE TABLE public.estado_solicitud_apoyo
(
    id              serial PRIMARY KEY,
    nombre          character varying(30) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT estado_solicitud_apoyo_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_esa_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_esa_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.solicitud_apoyo
(
    id                              serial PRIMARY KEY,
    persona_id                      integer NOT NULL,
    programa_id                     integer NOT NULL,
    fecha_solicitud                 date NOT NULL DEFAULT CURRENT_DATE,
    requiere_aprobacion             boolean NOT NULL DEFAULT false,
    aprobada                        boolean NOT NULL DEFAULT false,
    estado_id                       integer NOT NULL,
    fecha_aprobacion                date,
    aprobado_por                    integer,
    observaciones_trabajo_social    text,
    activo                          boolean NOT NULL DEFAULT true,
    created_at                      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                      timestamp,
    created_by                      integer,
    updated_by                      integer,
    CONSTRAINT solicitud_apoyo_fecha_valida_check CHECK (fecha_solicitud <= CURRENT_DATE),
    CONSTRAINT solicitud_apoyo_aprobacion_coherente_check CHECK (
        (aprobada = false AND fecha_aprobacion IS NULL AND aprobado_por IS NULL)
        OR (aprobada = true AND fecha_aprobacion IS NOT NULL AND aprobado_por IS NOT NULL)
    ),
    CONSTRAINT fk_sol_persona FOREIGN KEY (persona_id)
        REFERENCES public.persona (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_sol_programa FOREIGN KEY (programa_id)
        REFERENCES public.programa (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_sol_estado FOREIGN KEY (estado_id)
        REFERENCES public.estado_solicitud_apoyo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_sol_aprobador FOREIGN KEY (aprobado_por) REFERENCES public.usuario (id),
    CONSTRAINT fk_sol_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_sol_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_solicitud_persona ON public.solicitud_apoyo (persona_id);
CREATE INDEX idx_solicitud_programa ON public.solicitud_apoyo (programa_id);
CREATE INDEX idx_solicitud_estado ON public.solicitud_apoyo (estado_id) WHERE activo = true;

CREATE TABLE public.detalle_solicitud_apoyo
(
    id                  serial PRIMARY KEY,
    solicitud_id        integer NOT NULL,
    insumo_id           integer NOT NULL,
    cantidad_requerida  integer NOT NULL,
    cantidad_entregada  integer NOT NULL DEFAULT 0,
    estado_id           integer NOT NULL,
    fecha_asignacion    date,
    activo              boolean NOT NULL DEFAULT true,
    created_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp,
    created_by          integer,
    updated_by          integer,
    CONSTRAINT detalle_solicitud_cantidad_requerida_check CHECK (cantidad_requerida > 0),
    CONSTRAINT detalle_solicitud_cantidad_entregada_check CHECK (
        cantidad_entregada >= 0 AND cantidad_entregada <= cantidad_requerida
    ),
    CONSTRAINT detalle_solicitud_insumo_unico_key UNIQUE (solicitud_id, insumo_id),
    CONSTRAINT fk_dsa_solicitud FOREIGN KEY (solicitud_id)
        REFERENCES public.solicitud_apoyo (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_dsa_insumo FOREIGN KEY (insumo_id)
        REFERENCES public.insumo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_dsa_estado FOREIGN KEY (estado_id)
        REFERENCES public.estado_solicitud_apoyo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_dsa_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_dsa_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_detalle_solicitud_solicitud ON public.detalle_solicitud_apoyo (solicitud_id);
CREATE INDEX idx_detalle_solicitud_insumo_estado
    ON public.detalle_solicitud_apoyo (insumo_id, estado_id) WHERE activo = true;

-- Cambio #8: receta_medica (nueva)
CREATE TABLE public.receta_medica
(
    id                  serial PRIMARY KEY,
    solicitud_id        integer NOT NULL,
    ruta_archivo         character varying(500) NOT NULL,
    fecha_emision        date,
    observaciones        text,
    activo              boolean NOT NULL DEFAULT true,
    created_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp,
    created_by          integer,
    updated_by          integer,
    CONSTRAINT receta_medica_fecha_valida_check CHECK (fecha_emision IS NULL OR fecha_emision <= CURRENT_DATE),
    CONSTRAINT fk_rm_solicitud FOREIGN KEY (solicitud_id)
        REFERENCES public.solicitud_apoyo (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_rm_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_rm_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_receta_medica_solicitud ON public.receta_medica (solicitud_id);

ALTER TABLE public.detalle_solicitud_apoyo
    ADD COLUMN receta_medica_id integer,
    ADD CONSTRAINT fk_dsa_receta FOREIGN KEY (receta_medica_id)
        REFERENCES public.receta_medica (id) ON UPDATE NO ACTION ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- ENT: Entregas y despachos
-- ---------------------------------------------------------------------

CREATE TABLE public.entrega
(
    id                              serial PRIMARY KEY,
    detalle_solicitud_id            integer,
    persona_id                      integer NOT NULL,
    persona_receptor_id             integer,
    tipo_parentesco_receptor_id     integer,
    fecha_entrega                   date NOT NULL DEFAULT CURRENT_DATE,
    usuario_entrega_id              integer NOT NULL,
    observaciones                   text,
    activo                          boolean NOT NULL DEFAULT true,
    created_at                      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                      timestamp,
    created_by                      integer,
    updated_by                      integer,
    CONSTRAINT entrega_fecha_valida_check CHECK (fecha_entrega <= CURRENT_DATE),
    CONSTRAINT entrega_receptor_coherente_check CHECK (
        persona_receptor_id IS NULL OR tipo_parentesco_receptor_id IS NOT NULL
    ),
    CONSTRAINT fk_entrega_detalle_solicitud FOREIGN KEY (detalle_solicitud_id)
        REFERENCES public.detalle_solicitud_apoyo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_entrega_persona FOREIGN KEY (persona_id)
        REFERENCES public.persona (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_entrega_receptor FOREIGN KEY (persona_receptor_id)
        REFERENCES public.persona (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_entrega_parentesco FOREIGN KEY (tipo_parentesco_receptor_id)
        REFERENCES public.tipo_parentesco (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_entrega_usuario FOREIGN KEY (usuario_entrega_id)
        REFERENCES public.usuario (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_entrega_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_entrega_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_entrega_persona ON public.entrega (persona_id);
CREATE INDEX idx_entrega_receptor ON public.entrega (persona_receptor_id) WHERE persona_receptor_id IS NOT NULL;
CREATE INDEX idx_entrega_detalle_solicitud ON public.entrega (detalle_solicitud_id) WHERE detalle_solicitud_id IS NOT NULL;
CREATE INDEX idx_entrega_fecha ON public.entrega (fecha_entrega);

CREATE TABLE public.detalle_entrega
(
    id                          serial PRIMARY KEY,
    entrega_id                  integer NOT NULL,
    detalle_inventario_lote_id  integer NOT NULL,
    presentacion_despacho_id    integer NOT NULL,
    cantidad_despacho_original  numeric(12,4) NOT NULL,
    cantidad_entregada          integer NOT NULL,
    activo                      boolean NOT NULL DEFAULT true,
    created_at                  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  timestamp,
    created_by                  integer,
    updated_by                  integer,
    CONSTRAINT detalle_entrega_cantidad_entregada_check CHECK (cantidad_entregada > 0),
    CONSTRAINT detalle_entrega_cantidad_despacho_check CHECK (cantidad_despacho_original > 0),
    CONSTRAINT fk_det_entrega FOREIGN KEY (entrega_id)
        REFERENCES public.entrega (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_det_lote FOREIGN KEY (detalle_inventario_lote_id)
        REFERENCES public.detalle_inventario_lote (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_det_presentacion FOREIGN KEY (presentacion_despacho_id)
        REFERENCES public.presentacion_insumo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_det_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_det_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_detalle_entrega_entrega ON public.detalle_entrega (entrega_id);
CREATE INDEX idx_detalle_entrega_lote ON public.detalle_entrega (detalle_inventario_lote_id);

-- ---------------------------------------------------------------------
-- Cambio #10/#11: prestamo de equipo con contrato + multas
-- ---------------------------------------------------------------------

CREATE TABLE public.estado_contrato_prestamo
(
    id              serial PRIMARY KEY,
    nombre          character varying(20) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT estado_contrato_prestamo_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_ecp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_ecp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.contrato_prestamo
(
    id                          serial PRIMARY KEY,
    detalle_entrega_id          integer,
    contrato_anterior_id        integer,
    fecha_inicio                date NOT NULL DEFAULT CURRENT_DATE,
    fecha_devolucion_pactada    date NOT NULL,
    fecha_devolucion_real       date,
    estado_id                   integer NOT NULL,
    ruta_documento_firmado      character varying(500),
    activo                      boolean NOT NULL DEFAULT true,
    created_at                  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  timestamp,
    created_by                  integer,
    updated_by                  integer,
    CONSTRAINT contrato_prestamo_detalle_entrega_unica_key UNIQUE (detalle_entrega_id),
    CONSTRAINT contrato_prestamo_anterior_unico_key UNIQUE (contrato_anterior_id),
    CONSTRAINT contrato_prestamo_fechas_check CHECK (fecha_devolucion_pactada >= fecha_inicio),
    CONSTRAINT contrato_prestamo_devolucion_real_check CHECK (
        fecha_devolucion_real IS NULL OR fecha_devolucion_real >= fecha_inicio
    ),
    CONSTRAINT contrato_origen_check CHECK (
        (detalle_entrega_id IS NOT NULL AND contrato_anterior_id IS NULL)
        OR (detalle_entrega_id IS NULL AND contrato_anterior_id IS NOT NULL)
    ),
    CONSTRAINT fk_cp_detalle_entrega FOREIGN KEY (detalle_entrega_id)
        REFERENCES public.detalle_entrega (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_cp_contrato_anterior FOREIGN KEY (contrato_anterior_id)
        REFERENCES public.contrato_prestamo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_cp_estado FOREIGN KEY (estado_id)
        REFERENCES public.estado_contrato_prestamo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_cp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_cp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_contrato_prestamo_estado ON public.contrato_prestamo (estado_id) WHERE activo = true;
CREATE INDEX idx_contrato_prestamo_vencimiento
    ON public.contrato_prestamo (fecha_devolucion_pactada) WHERE activo = true;

CREATE TABLE public.tipo_multa_prestamo
(
    id              serial PRIMARY KEY,
    nombre          character varying(50) NOT NULL,
    monto_sugerido  numeric(10,2),
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT tipo_multa_prestamo_nombre_key UNIQUE (nombre),
    CONSTRAINT tipo_multa_prestamo_monto_check CHECK (monto_sugerido IS NULL OR monto_sugerido >= 0),
    CONSTRAINT fk_tmp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_tmp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.multa_prestamo
(
    id                      serial PRIMARY KEY,
    contrato_prestamo_id    integer NOT NULL,
    tipo_multa_id           integer NOT NULL,
    monto                   numeric(10,2) NOT NULL,
    fecha_aplicacion        date NOT NULL DEFAULT CURRENT_DATE,
    motivo                  text,
    pagada                  boolean NOT NULL DEFAULT false,
    fecha_pago              date,
    activo                  boolean NOT NULL DEFAULT true,
    created_at              timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              timestamp,
    created_by              integer,
    updated_by              integer,
    CONSTRAINT multa_prestamo_monto_check CHECK (monto >= 0),
    CONSTRAINT multa_prestamo_fecha_valida_check CHECK (fecha_aplicacion <= CURRENT_DATE),
    CONSTRAINT multa_prestamo_pago_coherente_check CHECK (
        (pagada = false AND fecha_pago IS NULL) OR (pagada = true AND fecha_pago IS NOT NULL)
    ),
    CONSTRAINT fk_mp_contrato FOREIGN KEY (contrato_prestamo_id)
        REFERENCES public.contrato_prestamo (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_mp_tipo FOREIGN KEY (tipo_multa_id)
        REFERENCES public.tipo_multa_prestamo (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_mp_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_mp_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_multa_prestamo_contrato ON public.multa_prestamo (contrato_prestamo_id);
CREATE INDEX idx_multa_prestamo_pendientes ON public.multa_prestamo (pagada) WHERE activo = true AND pagada = false;

CREATE TABLE public.tipo_evidencia_entrega
(
    id              serial PRIMARY KEY,
    nombre          character varying(50) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT tipo_evidencia_entrega_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_tee_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_tee_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

CREATE TABLE public.evidencia_entrega
(
    id                  serial PRIMARY KEY,
    entrega_id          integer NOT NULL,
    tipo_evidencia_id   integer NOT NULL,
    ruta_archivo         character varying(500) NOT NULL,
    observaciones        text,
    activo              boolean NOT NULL DEFAULT true,
    created_at          timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          timestamp,
    created_by          integer,
    updated_by          integer,
    CONSTRAINT fk_ee_entrega FOREIGN KEY (entrega_id)
        REFERENCES public.entrega (id) ON UPDATE NO ACTION ON DELETE CASCADE,
    CONSTRAINT fk_ee_tipo FOREIGN KEY (tipo_evidencia_id)
        REFERENCES public.tipo_evidencia_entrega (id) ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT fk_ee_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_ee_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);
CREATE INDEX idx_evidencia_entrega_entrega ON public.evidencia_entrega (entrega_id);

COMMIT;

























-- =====================================================================
-- SISTEMA DMM - Datos semilla para catalogos de estado/tipo (v2)
-- =====================================================================
-- Cambios respecto a la version anterior:
--   - Eliminado el seed de estado_asignacion_pendiente (tabla eliminada).
--   - Agregado tipo_genero, tipo_parentesco (nuevos catalogos).
--   - Agregado tipo_multa_prestamo, con los montos reales del contrato
--     de prestamo de equipo de la DMM (Q50 retraso, Q100 dano) como
--     monto_sugerido -- editable por contrato, no fijo.
-- =====================================================================

BEGIN;

INSERT INTO public.tipo_accion_auditoria (nombre) VALUES
    ('INSERT'),
    ('UPDATE'),
    ('DELETE');

INSERT INTO public.estado_solicitud_apoyo (nombre) VALUES
    ('PENDIENTE_ADQUISICION'),
    ('PENDIENTE_ENTREGA'),
    ('PENDIENTE_ENTREGA_PARCIAL'),
    ('APROBADA'),
    ('RECHAZADA'),
    ('ENTREGADA'),
    ('CANCELADA');

INSERT INTO public.estado_contrato_prestamo (nombre) VALUES
    ('VIGENTE'),
    ('DEVUELTO'),
    ('VENCIDO'),
    ('EXTENDIDO');

INSERT INTO public.tipo_documento_persona (nombre) VALUES
    ('DPI'),
    ('PARTIDA_NACIMIENTO'),
    ('DPI_ENCARGADO'),
    ('OTRO');

INSERT INTO public.tipo_evidencia_entrega (nombre) VALUES
    ('FOTO_BENEFICIARIO_CON_INSUMO'),
    ('FOTO_RECEPTOR'),
    ('FOTOCOPIA_DPI_RECEPTOR'),
    ('OTRO');

INSERT INTO public.tipo_genero (nombre) VALUES
    ('MASCULINO'),
    ('FEMENINO'),
    ('OTRO'),
    ('PREFIERE_NO_DECIR');

INSERT INTO public.tipo_parentesco (nombre) VALUES
    ('MADRE'),
    ('PADRE'),
    ('HIJO_A'),
    ('HERMANO_A'),
    ('ABUELO_A'),
    ('TIO_A'),
    ('CONYUGE'),
    ('OTRO');

INSERT INTO public.tipo_multa_prestamo (nombre, monto_sugerido) VALUES
    ('RETRASO_DEVOLUCION', 50.00),
    ('EQUIPO_DANADO', 100.00);

COMMIT;














-- =====================================================================
-- SISTEMA DMM - FASE 2: Funciones auxiliares
-- =====================================================================
-- Estas son funciones "de consulta/calculo" que NO son trigger functions
-- y no modifican datos (salvo fn_set_updated_at, que es la unica trigger
-- function generica de esta fase por conveniencia, ya que se reutiliza
-- en todas las tablas).
--
-- Se marcan STABLE o IMMUTABLE donde corresponde para que el planner de
-- Postgres pueda optimizar/cachear su evaluacion dentro de una misma
-- sentencia (importante porque varias se llaman repetidamente desde
-- triggers de validacion sobre muchas filas).
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- fn_calcular_edad: edad en anios completos, a la fecha de HOY.
-- STABLE (no IMMUTABLE) porque depende de CURRENT_DATE, que cambia
-- entre llamadas en distintos dias (aunque es constante dentro de la
-- misma transaccion/sentencia).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_calcular_edad(p_fecha_nacimiento date)
RETURNS integer
LANGUAGE sql
STABLE
AS $function$
    SELECT DATE_PART('year', AGE(CURRENT_DATE, p_fecha_nacimiento))::integer;
$function$;

COMMENT ON FUNCTION public.fn_calcular_edad(date) IS
    'Edad en anios completos a la fecha actual. Usar fn_edad_en_fecha para calculos historicos (reportes).';

-- ---------------------------------------------------------------------
-- fn_edad_en_fecha: edad en anios completos a una fecha ARBITRARIA.
-- Necesaria para reportes: "personas atendidas por edad" debe reflejar
-- la edad que tenian al momento de la entrega/solicitud, no su edad hoy.
-- IMMUTABLE porque, dadas las dos fechas, el resultado nunca cambia.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_edad_en_fecha(p_fecha_nacimiento date, p_fecha_referencia date)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT DATE_PART('year', AGE(p_fecha_referencia, p_fecha_nacimiento))::integer;
$function$;

COMMENT ON FUNCTION public.fn_edad_en_fecha(date, date) IS
    'Edad en anios completos que tenia una persona en una fecha de referencia dada. Uso: reportes historicos (RF-REP).';

-- ---------------------------------------------------------------------
-- fn_es_menor: true si la persona es menor de edad HOY.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_es_menor(p_fecha_nacimiento date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
    SELECT public.fn_calcular_edad(p_fecha_nacimiento) < 18;
$function$;

COMMENT ON FUNCTION public.fn_es_menor(date) IS
    'true si la persona es menor de 18 anios a la fecha actual.';

-- ---------------------------------------------------------------------
-- fn_stock_disponible: suma de cantidad_disponible en lotes activos
-- de un insumo. Fuente unica de verdad para "hay stock o no" (RF-INV,
-- RF-PRO: medicamentos con stock 0 bloquean solicitudes).
-- STABLE: no modifica datos, pero SI lee de la tabla, por lo que no
-- puede ser IMMUTABLE (el resultado cambia si otra transaccion inserta
-- una entrega). STABLE permite que el planner la evalue una sola vez
-- por sentencia si se llama varias veces con el mismo argumento.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stock_disponible(p_insumo_id integer)
RETURNS integer
LANGUAGE sql
STABLE
AS $function$
    SELECT COALESCE(SUM(cantidad_disponible), 0)::integer
    FROM public.detalle_inventario_lote
    WHERE insumo_id = p_insumo_id
      AND activo = true;
$function$;

COMMENT ON FUNCTION public.fn_stock_disponible(integer) IS
    'Stock total disponible de un insumo, sumando todos sus lotes activos. Fuente unica de verdad para validaciones de stock.';

-- ---------------------------------------------------------------------
-- fn_semaforo_caducidad: clasifica una fecha de caducidad en un estado
-- de alerta visual (RF-INV-02: semaforo de caducidad de medicamentos).
--
-- Regla de negocio (RF-INV-02):
--   ROJO      -> vence en menos de 3 meses
--   AMARILLO  -> vence entre 3 y 6 meses
--   VERDE     -> vence en mas de 6 meses
--   VENCIDO   -> fecha_caducidad ya paso (no contemplado explicitamente
--                en RF-INV-02, pero se distingue de ROJO porque la
--                accion operativa es distinta: un lote vencido debe
--                darse de baja, uno "por vencer" aun puede despacharse
--                con urgencia). Si se prefiere fusionarlo con ROJO para
--                calzar estrictamente con el requisito, es un cambio de
--                una linea.
--   GRIS      -> sin fecha de caducidad (insumo no perecedero)
--
-- Se usan INTERVALS de calendario (3/6 meses), no un numero fijo de dias
-- (ej. 90/180), porque los meses no tienen duracion uniforme: comparar
-- contra fechas de calendario reales evita el corte de +/-1-2 dias que
-- introduciria una aproximacion en dias fijos.
--
-- STABLE (no IMMUTABLE) porque depende de CURRENT_DATE.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_semaforo_caducidad(p_fecha_caducidad date)
RETURNS character varying
LANGUAGE plpgsql
STABLE
AS $function$
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
$function$;

COMMENT ON FUNCTION public.fn_semaforo_caducidad(date) IS
    'RF-INV-02. Semaforo de caducidad: GRIS (sin fecha) / VENCIDO / ROJO (<3 meses) / AMARILLO (3-6 meses) / VERDE (>6 meses).';

-- ---------------------------------------------------------------------
-- fn_set_updated_at: trigger function generica BEFORE UPDATE que
-- mantiene updated_at sincronizado en cualquier tabla que la use.
-- Se define aqui (junto a las funciones auxiliares) porque es de
-- proposito general y no especifica de un modulo de negocio, aunque
-- tecnicamente es una trigger function (los triggers que la invocan se
-- crean en la Fase 3).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_set_updated_at() IS
    'Trigger BEFORE UPDATE generico: fija updated_at = NOW() en cada UPDATE. Reutilizable en cualquier tabla con esa columna.';

-- ---------------------------------------------------------------------
-- fn_convertir_a_base: Grupo A (PREGUNTAS_DMM). Convierte una cantidad
-- capturada en una presentacion especifica (ej. "2 cajas") a la unidad
-- base del insumo (ej. tabletas), usando el factor_a_base definido en
-- presentacion_insumo.
--
-- IMMUTABLE: dado el mismo id de presentacion y la misma cantidad, el
-- resultado nunca cambia dentro de una transaccion (factor_a_base no
-- deberia editarse una vez en uso; si se edita, es una correccion de
-- catalogo, no un cambio de negocio normal).
--
-- Redondea hacia abajo (floor) porque cantidad_inicial/cantidad_disponible
-- son enteras (unidades fisicas discretas: no se puede tener media
-- tableta en inventario). Si el factor no resulta en un numero entero
-- exacto, el residuo se pierde -- esto es aceptable porque las
-- conversiones reales (caja->tableta, bolsa->unidad) son enteras por
-- diseno del catalogo; un factor no entero seria un error de captura en
-- presentacion_insumo, no algo que el sistema deba absorber en silencio.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_convertir_a_base(p_presentacion_id integer, p_cantidad numeric)
RETURNS integer
LANGUAGE sql
STABLE
AS $function$
    SELECT FLOOR(p_cantidad * pi.factor_a_base)::integer
    FROM public.presentacion_insumo pi
    WHERE pi.id = p_presentacion_id;
$function$;

COMMENT ON FUNCTION public.fn_convertir_a_base(integer, numeric) IS
    'Grupo A. Convierte una cantidad en una presentacion (ej. cajas) a unidad base del insumo (ej. tabletas), usando presentacion_insumo.factor_a_base.';

-- ---------------------------------------------------------------------
-- fn_es_adulto_mayor: Grupo D (PREGUNTAS_DMM P26). El cliente confirmo
-- 65 anios como el corte de adulto mayor (no 60).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_es_adulto_mayor(p_fecha_nacimiento date)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
    SELECT public.fn_calcular_edad(p_fecha_nacimiento) >= 65;
$function$;

COMMENT ON FUNCTION public.fn_es_adulto_mayor(date) IS
    'true si la persona tiene 65 anios o mas a la fecha actual (definicion confirmada por el cliente, PREGUNTAS_DMM P26).';

COMMIT;



















-- =====================================================================
-- SISTEMA DMM - FASE 3a (v2): Triggers genericos (updated_at + auditoria)
-- =====================================================================
-- Actualizado para el schema v2 (38 tablas). Cambios respecto a la
-- version anterior:
--   - Eliminados los triggers de asignacion_pendiente y
--     estado_asignacion_pendiente (tablas eliminadas, absorbidas por
--     detalle_solicitud_apoyo).
--   - Agregados triggers para las 9 tablas nuevas: tipo_genero,
--     tipo_parentesco, contacto_referencia_persona, documento_recepcion,
--     detalle_solicitud_apoyo, receta_medica, tipo_multa_prestamo,
--     multa_prestamo, sesion.
--   - sesion tiene un patron de auditoria distinto (solo INSERT/UPDATE,
--     nunca DELETE) por decision explicita de diseno -- se marca aparte
--     al final de la seccion de auditoria.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- fn_auditoria: registra INSERT/UPDATE/DELETE en auditoria_log.
-- Requiere que el backend inyecte SET LOCAL app.usuario_id = X al inicio
-- de cada transaccion; si no lo hace, usuario_id queda NULL (no falla).
--
-- Incluye el manejo de tablas con clave primaria compuesta
-- (encargado_menor, persona_discapacidad), que usan un campo representativo
-- en vez de "id". Cualquier tabla nueva con clave compuesta necesita su
-- entrada en el CASE, o fallara con 'record new has no field id'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_auditoria()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
$function$;

COMMENT ON FUNCTION public.fn_auditoria() IS
    'Trigger AFTER I/U/D generico: registra el cambio en auditoria_log. Lee app.usuario_id inyectado por el backend via SET LOCAL. Para tablas con clave primaria compuesta (encargado_menor, persona_discapacidad) usa un campo representativo en vez de "id" (ver migracion 08_fix_fn_auditoria_clave_compuesta.sql).';

-- =====================================================================
-- Triggers BEFORE UPDATE: updated_at
-- =====================================================================

CREATE TRIGGER trg_updated_at_rol
    BEFORE UPDATE ON public.rol
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_usuario
    BEFORE UPDATE ON public.usuario
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_tipo_accion_auditoria
    BEFORE UPDATE ON public.tipo_accion_auditoria
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_sesion
    BEFORE UPDATE ON public.sesion
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_departamento
    BEFORE UPDATE ON public.departamento
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_municipio
    BEFORE UPDATE ON public.municipio
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_comunidad
    BEFORE UPDATE ON public.comunidad
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_discapacidad
    BEFORE UPDATE ON public.discapacidad
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_tipo_genero
    BEFORE UPDATE ON public.tipo_genero
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_tipo_parentesco
    BEFORE UPDATE ON public.tipo_parentesco
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_persona
    BEFORE UPDATE ON public.persona
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_contacto_referencia_persona
    BEFORE UPDATE ON public.contacto_referencia_persona
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_tipo_documento_persona
    BEFORE UPDATE ON public.tipo_documento_persona
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_documento_persona
    BEFORE UPDATE ON public.documento_persona
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_persona_discapacidad
    BEFORE UPDATE ON public.persona_discapacidad
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_encargado_menor
    BEFORE UPDATE ON public.encargado_menor
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_programa
    BEFORE UPDATE ON public.programa
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_institucion_donante
    BEFORE UPDATE ON public.institucion_donante
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_unidad_medida
    BEFORE UPDATE ON public.unidad_medida
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_categoria_insumo
    BEFORE UPDATE ON public.categoria_insumo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_insumo
    BEFORE UPDATE ON public.insumo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_presentacion_insumo
    BEFORE UPDATE ON public.presentacion_insumo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_recepcion_donacion_lote
    BEFORE UPDATE ON public.recepcion_donacion_lote
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_documento_recepcion
    BEFORE UPDATE ON public.documento_recepcion
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_detalle_inventario_lote
    BEFORE UPDATE ON public.detalle_inventario_lote
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_estado_solicitud_apoyo
    BEFORE UPDATE ON public.estado_solicitud_apoyo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_solicitud_apoyo
    BEFORE UPDATE ON public.solicitud_apoyo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_detalle_solicitud_apoyo
    BEFORE UPDATE ON public.detalle_solicitud_apoyo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_receta_medica
    BEFORE UPDATE ON public.receta_medica
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_entrega
    BEFORE UPDATE ON public.entrega
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_detalle_entrega
    BEFORE UPDATE ON public.detalle_entrega
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_estado_contrato_prestamo
    BEFORE UPDATE ON public.estado_contrato_prestamo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_contrato_prestamo
    BEFORE UPDATE ON public.contrato_prestamo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_tipo_multa_prestamo
    BEFORE UPDATE ON public.tipo_multa_prestamo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_multa_prestamo
    BEFORE UPDATE ON public.multa_prestamo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_tipo_evidencia_entrega
    BEFORE UPDATE ON public.tipo_evidencia_entrega
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_updated_at_evidencia_entrega
    BEFORE UPDATE ON public.evidencia_entrega
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =====================================================================
-- Triggers AFTER I/U/D: auditoria
-- Se aplica a TODAS las tablas de negocio. auditoria_log en si misma
-- NO se audita (seria recursivo).
-- =====================================================================

CREATE TRIGGER trg_auditoria_usuario
    AFTER INSERT OR UPDATE OR DELETE ON public.usuario
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_rol
    AFTER INSERT OR UPDATE OR DELETE ON public.rol
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_tipo_accion_auditoria
    AFTER INSERT OR UPDATE OR DELETE ON public.tipo_accion_auditoria
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

-- sesion: excepcion deliberada -- solo INSERT/UPDATE, nunca DELETE,
-- porque nunca se eliminan filas de esta tabla (evidencia de acceso
-- para auditoria/seguridad, ver comentario en 01_schema.sql).
CREATE TRIGGER trg_auditoria_sesion
    AFTER INSERT OR UPDATE ON public.sesion
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_departamento
    AFTER INSERT OR UPDATE OR DELETE ON public.departamento
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_municipio
    AFTER INSERT OR UPDATE OR DELETE ON public.municipio
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_comunidad
    AFTER INSERT OR UPDATE OR DELETE ON public.comunidad
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_discapacidad
    AFTER INSERT OR UPDATE OR DELETE ON public.discapacidad
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_tipo_genero
    AFTER INSERT OR UPDATE OR DELETE ON public.tipo_genero
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_tipo_parentesco
    AFTER INSERT OR UPDATE OR DELETE ON public.tipo_parentesco
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_persona
    AFTER INSERT OR UPDATE OR DELETE ON public.persona
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_contacto_referencia_persona
    AFTER INSERT OR UPDATE OR DELETE ON public.contacto_referencia_persona
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_tipo_documento_persona
    AFTER INSERT OR UPDATE OR DELETE ON public.tipo_documento_persona
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_documento_persona
    AFTER INSERT OR UPDATE OR DELETE ON public.documento_persona
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_persona_discapacidad
    AFTER INSERT OR UPDATE OR DELETE ON public.persona_discapacidad
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_encargado_menor
    AFTER INSERT OR UPDATE OR DELETE ON public.encargado_menor
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_programa
    AFTER INSERT OR UPDATE OR DELETE ON public.programa
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_institucion_donante
    AFTER INSERT OR UPDATE OR DELETE ON public.institucion_donante
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_unidad_medida
    AFTER INSERT OR UPDATE OR DELETE ON public.unidad_medida
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_categoria_insumo
    AFTER INSERT OR UPDATE OR DELETE ON public.categoria_insumo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_insumo
    AFTER INSERT OR UPDATE OR DELETE ON public.insumo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_presentacion_insumo
    AFTER INSERT OR UPDATE OR DELETE ON public.presentacion_insumo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_recepcion_donacion_lote
    AFTER INSERT OR UPDATE OR DELETE ON public.recepcion_donacion_lote
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_documento_recepcion
    AFTER INSERT OR UPDATE OR DELETE ON public.documento_recepcion
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_detalle_inventario_lote
    AFTER INSERT OR UPDATE OR DELETE ON public.detalle_inventario_lote
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_estado_solicitud_apoyo
    AFTER INSERT OR UPDATE OR DELETE ON public.estado_solicitud_apoyo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_solicitud_apoyo
    AFTER INSERT OR UPDATE OR DELETE ON public.solicitud_apoyo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_detalle_solicitud_apoyo
    AFTER INSERT OR UPDATE OR DELETE ON public.detalle_solicitud_apoyo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_receta_medica
    AFTER INSERT OR UPDATE OR DELETE ON public.receta_medica
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_entrega
    AFTER INSERT OR UPDATE OR DELETE ON public.entrega
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_detalle_entrega
    AFTER INSERT OR UPDATE OR DELETE ON public.detalle_entrega
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_estado_contrato_prestamo
    AFTER INSERT OR UPDATE OR DELETE ON public.estado_contrato_prestamo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_contrato_prestamo
    AFTER INSERT OR UPDATE OR DELETE ON public.contrato_prestamo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_tipo_multa_prestamo
    AFTER INSERT OR UPDATE OR DELETE ON public.tipo_multa_prestamo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_multa_prestamo
    AFTER INSERT OR UPDATE OR DELETE ON public.multa_prestamo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_tipo_evidencia_entrega
    AFTER INSERT OR UPDATE OR DELETE ON public.tipo_evidencia_entrega
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_evidencia_entrega
    AFTER INSERT OR UPDATE OR DELETE ON public.evidencia_entrega
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

COMMIT;






























-- =====================================================================
-- SISTEMA DMM - FASE 3b (v2): Triggers de logica de negocio
-- =====================================================================
-- Cambios respecto a la version anterior (rediseno cabecera/linea):
--   - fn_estado_inicial_solicitud y fn_validar_stock_medicamento se
--     MUEVEN de solicitud_apoyo a detalle_solicitud_apoyo (cada linea
--     de insumo tiene su propio estado inicial y su propio bloqueo por
--     categoria, ya no la solicitud completa).
--   - fn_recalcular_solicitud_desde_entregas se REESCRIBE con dos
--     niveles: recalcula primero la LINEA (sumando sus entregas), luego
--     deriva el estado de la CABECERA agregando el estado de TODAS sus
--     lineas (regla confirmada: la cabecera pasa a ENTREGADA cuando
--     cada linea individual esta en ENTREGADA o CANCELADA; ninguna en
--     un estado intermedio bloquea el cierre).
--   - fn_actualizar_cantidad_entregada_solicitud ahora resuelve
--     detalle_solicitud_id (no solicitud_id) desde entrega.
--   - fn_cerrar_solicitud_generica se ELIMINA: ya no existe "apoyo
--     generico sin insumo" -- detalle_solicitud_apoyo.insumo_id es
--     NOT NULL, toda linea tiene insumo obligatorio.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- fn_validar_menor_encargado: sin cambios respecto a la version
-- anterior (no depende de la estructura de solicitud_apoyo).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validar_menor_encargado()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_persona_id   integer;
    v_fecha_nac    date;
    v_cui_dpi      character varying;
    v_tiene_encargado boolean;
BEGIN
    IF TG_TABLE_NAME = 'persona' THEN
        v_persona_id := NEW.id;
        v_fecha_nac  := NEW.fecha_nacimiento;
        v_cui_dpi    := NEW.cui_dpi;
    ELSIF TG_TABLE_NAME = 'encargado_menor' THEN
        v_persona_id := COALESCE(NEW.menor_id, OLD.menor_id);
        SELECT fecha_nacimiento, cui_dpi INTO v_fecha_nac, v_cui_dpi
        FROM public.persona WHERE id = v_persona_id;
    END IF;

    IF public.fn_es_menor(v_fecha_nac) AND v_cui_dpi IS NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM public.encargado_menor
            WHERE menor_id = v_persona_id AND activo = true
        ) INTO v_tiene_encargado;

        IF NOT v_tiene_encargado THEN
            RAISE EXCEPTION
                'La persona % es menor de edad y no tiene CUI/DPI: debe vincularse a un encargado (encargado_menor) antes de finalizar la transaccion.',
                v_persona_id;
        END IF;
    END IF;

    RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_validar_menor_encargado() IS
    'RF-BEN. Verifica (al COMMIT, no antes) que todo menor sin CUI/DPI tenga al menos un encargado activo vinculado.';

CREATE CONSTRAINT TRIGGER trg_validar_menor_encargado_persona
    AFTER INSERT OR UPDATE OF fecha_nacimiento, cui_dpi ON public.persona
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_validar_menor_encargado();

CREATE CONSTRAINT TRIGGER trg_validar_menor_encargado_vinculo
    AFTER DELETE OR UPDATE OF activo ON public.encargado_menor
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION fn_validar_menor_encargado();

-- ---------------------------------------------------------------------
-- fn_estado_inicial_linea_solicitud (antes fn_estado_inicial_solicitud):
-- MOVIDA de solicitud_apoyo a detalle_solicitud_apoyo. Cada LINEA de
-- insumo dentro del tramite tiene su propio estado inicial segun stock
-- de ESE insumo especifico -- ya no existe el caso "sin insumo
-- especifico" (insumo_id es NOT NULL en la linea), asi que se elimina
-- la rama de "apoyo generico" que tenia la version anterior.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_estado_inicial_linea_solicitud()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
$function$;

COMMENT ON FUNCTION public.fn_estado_inicial_linea_solicitud() IS
    'RF-PRO/RF-INV. Fija el estado inicial de cada LINEA de la solicitud segun disponibilidad de stock de su insumo especifico.';

CREATE TRIGGER trg_estado_inicial_linea_solicitud
    BEFORE INSERT ON public.detalle_solicitud_apoyo
    FOR EACH ROW EXECUTE FUNCTION fn_estado_inicial_linea_solicitud();

-- ---------------------------------------------------------------------
-- fn_validar_stock_linea_solicitud (antes fn_validar_stock_medicamento):
-- MOVIDA de solicitud_apoyo a detalle_solicitud_apoyo. El bloqueo por
-- categoria (categoria_insumo.bloquea_solicitud_sin_stock) ahora se
-- evalua por LINEA -- si una solicitud pide Paracetamol (bloquea) y una
-- silla (no bloquea) en el mismo tramite, solo la linea de Paracetamol
-- puede impedir su propia creacion; la de la silla se crea igual.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_validar_stock_linea_solicitud()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_stock             integer;
    v_bloquea_sin_stock  boolean;
    v_nombre             character varying;
BEGIN
    SELECT ci.bloquea_solicitud_sin_stock, i.nombre
    INTO v_bloquea_sin_stock, v_nombre
    FROM public.insumo i
    JOIN public.categoria_insumo ci ON ci.id = i.categoria_id
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
$function$;

COMMENT ON FUNCTION public.fn_validar_stock_linea_solicitud() IS
    'RF-PRO. Bloquea la creacion de una LINEA de solicitud cuya categoria tiene bloquea_solicitud_sin_stock=true y stock 0 (tipicamente medicamentos). Equipos/alimentos sin stock SI se permiten (quedan PENDIENTE_ADQUISICION).';

CREATE TRIGGER trg_validar_stock_linea_solicitud
    BEFORE INSERT ON public.detalle_solicitud_apoyo
    FOR EACH ROW EXECUTE FUNCTION fn_validar_stock_linea_solicitud();

-- ---------------------------------------------------------------------
-- fn_calcular_recepcion_lote: sin cambios respecto a la version
-- anterior (no depende de la estructura de solicitud_apoyo).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_calcular_recepcion_lote()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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

    SELECT ci.requiere_fecha_caducidad, ci.requiere_codigo_fabricante
    INTO v_requiere_fecha_caducidad, v_requiere_codigo_fabricante
    FROM public.insumo i
    JOIN public.categoria_insumo ci ON ci.id = i.categoria_id
    WHERE i.id = NEW.insumo_id;

    IF v_requiere_fecha_caducidad AND NEW.fecha_caducidad IS NULL THEN
        RAISE EXCEPTION
            'El insumo % pertenece a una categoría que exige fecha de caducidad.',
            NEW.insumo_id;
    END IF;

    IF v_requiere_codigo_fabricante AND (NEW.codigo_lote_fabricante IS NULL OR length(trim(NEW.codigo_lote_fabricante)) = 0) THEN
        RAISE EXCEPTION
            'El insumo % pertenece a una categoría que exige código de lote del fabricante.',
            NEW.insumo_id;
    END IF;

    NEW.cantidad_inicial := public.fn_convertir_a_base(NEW.presentacion_recepcion_id, NEW.cantidad_recepcion_original);
    NEW.cantidad_disponible := NEW.cantidad_inicial;

    IF NEW.cantidad_inicial IS NULL OR NEW.cantidad_inicial <= 0 THEN
        RAISE EXCEPTION 'La cantidad recibida resultante es inválida (revise presentación y cantidad).';
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_calcular_recepcion_lote() IS
    'Grupo A/D. Calcula cantidad_inicial/cantidad_disponible desde la presentacion de recepcion, valida coherencia insumo-presentacion, y exige fecha_caducidad/codigo_lote_fabricante segun la configuracion de categoria_insumo.';

CREATE TRIGGER trg_calcular_recepcion_lote
    BEFORE INSERT ON public.detalle_inventario_lote
    FOR EACH ROW EXECUTE FUNCTION fn_calcular_recepcion_lote();

-- ---------------------------------------------------------------------
-- fn_calcular_cantidad_entregada: sin cambios respecto a la version
-- anterior (no depende de la estructura de solicitud_apoyo, solo de
-- presentacion_insumo/detalle_inventario_lote).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_calcular_cantidad_entregada()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_insumo_lote         integer;
    v_insumo_presentacion integer;
BEGIN
    SELECT insumo_id INTO v_insumo_lote
    FROM public.detalle_inventario_lote
    WHERE id = NEW.detalle_inventario_lote_id;

    SELECT insumo_id INTO v_insumo_presentacion
    FROM public.presentacion_insumo
    WHERE id = NEW.presentacion_despacho_id;

    IF v_insumo_presentacion IS DISTINCT FROM v_insumo_lote THEN
        RAISE EXCEPTION
            'La presentación de despacho (%) no corresponde al insumo del lote (%).',
            NEW.presentacion_despacho_id, v_insumo_lote;
    END IF;

    NEW.cantidad_entregada := public.fn_convertir_a_base(NEW.presentacion_despacho_id, NEW.cantidad_despacho_original);

    IF NEW.cantidad_entregada IS NULL OR NEW.cantidad_entregada <= 0 THEN
        RAISE EXCEPTION 'La cantidad a entregar resultante es inválida (revise presentación y cantidad).';
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_calcular_cantidad_entregada() IS
    'Grupo A. Calcula cantidad_entregada (unidad base) desde presentacion_despacho_id + cantidad_despacho_original, y valida coherencia de la presentacion con el insumo del lote.';

CREATE TRIGGER trg_calcular_cantidad_entregada
    BEFORE INSERT ON public.detalle_entrega
    FOR EACH ROW EXECUTE FUNCTION fn_calcular_cantidad_entregada();

-- ---------------------------------------------------------------------
-- fn_descontar_inventario: sin cambios.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_descontar_inventario()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
$function$;

COMMENT ON FUNCTION public.fn_descontar_inventario() IS
    'RF-ENT. Descuenta stock del lote al registrar un detalle_entrega. Usa FOR UPDATE para evitar condiciones de carrera entre entregas concurrentes del mismo lote.';

CREATE TRIGGER trg_descontar_inventario
    BEFORE INSERT ON public.detalle_entrega
    FOR EACH ROW EXECUTE FUNCTION fn_descontar_inventario();

-- ---------------------------------------------------------------------
-- fn_restaurar_inventario: sin cambios.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_restaurar_inventario()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_detalle       RECORD;
    v_lote_activo   boolean;
    v_huerfanos     integer := 0;
BEGIN
    IF OLD.activo = true AND NEW.activo = false THEN
        FOR v_detalle IN
            SELECT detalle_inventario_lote_id, cantidad_entregada
            FROM public.detalle_entrega
            WHERE entrega_id = OLD.id
              AND activo = true
        LOOP
            SELECT activo INTO v_lote_activo
            FROM public.detalle_inventario_lote
            WHERE id = v_detalle.detalle_inventario_lote_id
            FOR UPDATE;

            IF v_lote_activo IS TRUE THEN
                UPDATE public.detalle_inventario_lote
                SET cantidad_disponible = cantidad_disponible + v_detalle.cantidad_entregada
                WHERE id = v_detalle.detalle_inventario_lote_id;
            ELSE
                v_huerfanos := v_huerfanos + 1;
                RAISE WARNING
                    'Entrega %: el detalle de lote % está inactivo; % unidades NO se restauraron automáticamente y requieren revisión manual.',
                    OLD.id, v_detalle.detalle_inventario_lote_id, v_detalle.cantidad_entregada;
            END IF;
        END LOOP;

        IF v_huerfanos > 0 THEN
            UPDATE public.entrega
            SET observaciones = COALESCE(observaciones || ' | ', '') ||
                format('ADVERTENCIA: %s detalle(s) de lote inactivo(s) no se restauraron automaticamente, requiere revision manual de inventario.', v_huerfanos)
            WHERE id = OLD.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_restaurar_inventario() IS
    'RF-ENT. Al anular una entrega (activo->false), devuelve el stock a los lotes de origen. Si un detalle de lote ya esta inactivo, NO restaura automaticamente y deja advertencia visible en la entrega.';

CREATE TRIGGER trg_restaurar_inventario
    AFTER UPDATE OF activo ON public.entrega
    FOR EACH ROW
    WHEN (OLD.activo = true AND NEW.activo = false)
    EXECUTE FUNCTION fn_restaurar_inventario();

-- ---------------------------------------------------------------------
-- fn_recalcular_linea_solicitud: REESCRITA. Antes operaba directo sobre
-- solicitud_apoyo (cabecera); ahora opera sobre UNA LINEA especifica
-- (detalle_solicitud_apoyo), sumando el historial activo de entregas
-- vinculadas a ESA linea (via entrega.detalle_solicitud_id).
--
-- Al terminar, dispara el recalculo de la CABECERA (ver
-- fn_recalcular_cabecera_solicitud mas abajo), porque el estado
-- agregado del tramite depende de TODAS sus lineas, no solo de esta.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_linea_solicitud(p_detalle_solicitud_id integer)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_cantidad_requerida integer;
    v_solicitud_id        integer;
    v_total_entregado     integer;
BEGIN
    SELECT cantidad_requerida, solicitud_id INTO v_cantidad_requerida, v_solicitud_id
    FROM public.detalle_solicitud_apoyo
    WHERE id = p_detalle_solicitud_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT COALESCE(SUM(de.cantidad_entregada), 0) INTO v_total_entregado
    FROM public.detalle_entrega de
    JOIN public.entrega e ON e.id = de.entrega_id
    WHERE e.detalle_solicitud_id = p_detalle_solicitud_id
      AND de.activo = true
      AND e.activo = true;

    UPDATE public.detalle_solicitud_apoyo
    SET cantidad_entregada = v_total_entregado,
        estado_id = CASE
            WHEN v_total_entregado >= v_cantidad_requerida
                THEN (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'ENTREGADA')
            WHEN v_total_entregado > 0
                THEN (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ENTREGA_PARCIAL')
            ELSE
                estado_id  -- conserva el estado actual (PENDIENTE_ENTREGA o PENDIENTE_ADQUISICION,
                           -- segun lo haya fijado fn_estado_inicial_linea_solicitud/reversion) si no hay nada entregado
        END
    WHERE id = p_detalle_solicitud_id;

    -- El estado agregado de la cabecera depende de TODAS sus lineas.
    PERFORM public.fn_recalcular_cabecera_solicitud(v_solicitud_id);
END;
$function$;

COMMENT ON FUNCTION public.fn_recalcular_linea_solicitud(integer) IS
    'RF-ENT. Recalcula cantidad_entregada y estado_id de UNA LINEA de solicitud desde su historial activo de entregas, y dispara el recalculo de la cabecera.';

-- ---------------------------------------------------------------------
-- fn_recalcular_cabecera_solicitud: deriva el estado_id de la CABECERA
-- (solicitud_apoyo) agregando el estado de TODAS sus lineas activas.
--
-- Regla de negocio confirmada: la cabecera pasa a ENTREGADA cuando cada
-- linea individual esta en ENTREGADA o CANCELADA (ninguna en un estado
-- intermedio -- PENDIENTE_* -- bloquea el cierre). Se puede cancelar
-- una linea individual sin cancelar el resto del tramite (la cabecera
-- solo se cancela explicitamente via sp_cancelar_solicitud sobre TODAS
-- sus lineas, o queda en curso mientras alguna linea siga pendiente).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_cabecera_solicitud(p_solicitud_id integer)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    v_total_lineas          integer;
    v_lineas_cerradas       integer;  -- ENTREGADA o CANCELADA
    v_lineas_con_avance     integer;  -- al menos alguna entrega parcial
BEGIN
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE esa.nombre IN ('ENTREGADA', 'CANCELADA')),
        COUNT(*) FILTER (WHERE esa.nombre = 'PENDIENTE_ENTREGA_PARCIAL')
    INTO v_total_lineas, v_lineas_cerradas, v_lineas_con_avance
    FROM public.detalle_solicitud_apoyo dsa
    JOIN public.estado_solicitud_apoyo esa ON esa.id = dsa.estado_id
    WHERE dsa.solicitud_id = p_solicitud_id
      AND dsa.activo = true;

    IF v_total_lineas = 0 THEN
        RETURN;  -- sin lineas activas, no hay nada que derivar (caso extremo/transitorio)
    END IF;

    IF v_total_lineas = v_lineas_cerradas THEN
        -- TODAS las lineas estan ENTREGADA o CANCELADA: el tramite se cierra.
        UPDATE public.solicitud_apoyo
        SET estado_id = (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'ENTREGADA')
        WHERE id = p_solicitud_id;
    ELSIF v_lineas_con_avance > 0 OR v_lineas_cerradas > 0 THEN
        -- Al menos una linea con avance (parcial o ya cerrada) pero no todas:
        -- el tramite sigue en curso, con progreso.
        UPDATE public.solicitud_apoyo
        SET estado_id = (SELECT id FROM public.estado_solicitud_apoyo WHERE nombre = 'PENDIENTE_ENTREGA_PARCIAL')
        WHERE id = p_solicitud_id;
    END IF;
    -- Si ninguna linea tiene avance, la cabecera conserva su estado actual
    -- (fijado al crear la solicitud o por aprobacion/rechazo manual) --
    -- no se sobreescribe aqui para no interferir con el flujo de aprobacion.
END;
$function$;

COMMENT ON FUNCTION public.fn_recalcular_cabecera_solicitud(integer) IS
    'RF-PRO/RF-ENT. Deriva el estado_id de la cabecera agregando el estado de todas sus lineas: ENTREGADA cuando todas estan ENTREGADA/CANCELADA; PENDIENTE_ENTREGA_PARCIAL si hay avance parcial; sin cambio si ninguna linea tiene avance.';

-- ---------------------------------------------------------------------
-- fn_actualizar_linea_desde_entrega: trigger AFTER INSERT en
-- DETALLE_ENTREGA. Resuelve el detalle_solicitud_id afectado (via
-- entrega.detalle_solicitud_id, que ahora apunta a la LINEA, no a la
-- cabecera) y delega el calculo a fn_recalcular_linea_solicitud.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_actualizar_linea_desde_entrega()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_detalle_solicitud_id integer;
BEGIN
    SELECT e.detalle_solicitud_id INTO v_detalle_solicitud_id
    FROM public.entrega e
    WHERE e.id = NEW.entrega_id;

    IF v_detalle_solicitud_id IS NOT NULL THEN
        PERFORM public.fn_recalcular_linea_solicitud(v_detalle_solicitud_id);
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_actualizar_linea_desde_entrega() IS
    'RF-ENT. Dispara el recalculo de la LINEA de solicitud (y en cascada, de la cabecera) cuando se inserta un detalle_entrega asociado a ella.';

CREATE TRIGGER trg_actualizar_linea_desde_entrega
    AFTER INSERT ON public.detalle_entrega
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_linea_desde_entrega();

-- Nota: fn_cerrar_solicitud_generica (version anterior) se ELIMINA sin
-- reemplazo. Ya no existe el caso de "apoyo generico sin insumo
-- especifico": detalle_solicitud_apoyo.insumo_id es NOT NULL, toda
-- linea de toda solicitud tiene siempre un insumo asociado.

COMMIT;

















-- =====================================================================
-- SISTEMA DMM - Vista v_inventario_lote_fifo
-- (Se crea en este punto, adelantada de la Fase 5, porque los stored
-- procedures de la Fase 4 la necesitan para el criterio de despacho.)
-- =====================================================================
-- Resuelve el criterio de orden FIFO/FEFO de despacho sin desnormalizar
-- fecha_recepcion en detalle_inventario_lote (se mantiene 3FN estricta,
-- segun lo acordado). El orden de despacho es:
--   1. Insumos perecederos: primero el que vence mas pronto
--      (fecha_caducidad ASC, que vive en detalle_inventario_lote porque
--      es propia de cada PRODUCTO dentro del lote, no del lote completo).
--   2. Insumos NO perecederos (fecha_caducidad NULL): primero el
--      detalle que lleva mas tiempo en bodega (fecha_recepcion ASC,
--      obtenida via JOIN al lote padre recepcion_donacion_lote).
--   3. columna orden_fifo combina ambos casos en un solo criterio
--      ordenable: COALESCE(fecha_caducidad, fecha_recepcion + 100 anios)
--      -- el "+100 anios" empuja los no-perecederos al fondo SOLO
--      cuando se comparan contra perecederos con fecha real; entre ellos
--      se siguen ordenando por fecha_recepcion real de forma correcta,
--      porque la comparacion es sobre el valor absoluto de la fecha.
--
-- codigo_lote se toma del LOTE PADRE (recepcion_donacion_lote), no del
-- detalle: un mismo codigo_lote identifica todo el envio, no cada
-- producto individual dentro de el.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_inventario_lote_fifo AS
SELECT
    dl.id                    AS detalle_inventario_lote_id,
    dl.insumo_id,
    dl.recepcion_lote_id,
    rl.codigo_lote,
    dl.fecha_caducidad,
    rl.fecha_recepcion,
    dl.cantidad_inicial,
    dl.cantidad_disponible,
    dl.activo,
    -- Criterio unico de ordenamiento FIFO/FEFO:
    --   - Si tiene fecha_caducidad, se usa esa (FEFO real).
    --   - Si no (no perecedero), se usa fecha_recepcion desplazada +100
    --     anios, para que SIEMPRE quede detras de cualquier perecedero
    --     real al comparar entre insumos distintos, pero mantenga su
    --     propio orden interno correcto (mas antiguo primero) cuando se
    --     compara solo entre detalles no perecederos del mismo insumo.
    COALESCE(dl.fecha_caducidad, rl.fecha_recepcion + INTERVAL '100 years') AS orden_fifo
FROM public.detalle_inventario_lote dl
JOIN public.recepcion_donacion_lote rl ON rl.id = dl.recepcion_lote_id;

COMMENT ON VIEW public.v_inventario_lote_fifo IS
    'RF-ENT. Detalle de inventario por producto, con codigo_lote y fecha_recepcion resueltos via JOIN al lote padre (3FN), y columna orden_fifo lista para ORDER BY en el despacho de entregas.';


















-- =====================================================================
-- SISTEMA DMM - FASE 4 (v2): Stored Procedures
-- =====================================================================
-- Cambios respecto a la version anterior:
--   - sp_registrar_entrega: recibe p_detalle_solicitud_id (la LINEA
--     especifica) en vez de p_solicitud_id; valida coherencia contra el
--     insumo de esa linea. Recibe p_tipo_parentesco_receptor_id (FK) en
--     vez de p_parentesco_receptor (texto).
--   - sp_procesar_donacion_pendientes: ya NO lee asignacion_pendiente
--     (tabla eliminada) -- lee directo detalle_solicitud_apoyo filtrando
--     por estado PENDIENTE_ADQUISICION.
--   - sp_desactivar_entrega: usa fn_recalcular_linea_solicitud (nuevo
--     nombre/nivel) en vez de fn_recalcular_solicitud_desde_entregas.
--   - sp_registrar_devolucion_prestamo: usa detalle_entrega_id (no
--     entrega_id) para ubicar los detalles a restaurar; ya no escribe
--     en contrato_prestamo.observaciones (columna eliminada).
--   - sp_cancelar_solicitud: renombrado a sp_cancelar_linea_solicitud,
--     cancela UNA LINEA especifica (regla confirmada: se puede cancelar
--     un insumo individual sin cancelar todo el tramite) y dispara el
--     recalculo de la cabecera. Se agrega sp_cancelar_solicitud_completa
--     para el caso de cancelar TODAS las lineas de una vez.
--   - sp_dar_baja_insumo_vencido: sin cambios.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- sp_registrar_entrega: registra una entrega completa (cabecera +
-- detalle por lote) siguiendo FIFO/FEFO via v_inventario_lote_fifo.
--
-- p_detalle_solicitud_id (antes p_solicitud_id) identifica la LINEA
-- especifica del tramite que se esta atendiendo -- puede ser NULL para
-- entregas sin solicitud previa (ayuda directa).
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_registrar_entrega(
    IN p_detalle_solicitud_id          integer,
    IN p_persona_id                    integer,
    IN p_insumo_id                     integer,
    IN p_cantidad                      integer,
    IN p_usuario_entrega_id            integer,
    IN p_observaciones                 text DEFAULT NULL,
    IN p_persona_receptor_id           integer DEFAULT NULL,
    IN p_tipo_parentesco_receptor_id   integer DEFAULT NULL
)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_entrega_id        integer;
    v_lote               RECORD;
    v_cantidad_resta      integer;
    v_tomar               integer;
    v_stock_total          integer;
    v_insumo_linea          integer;
    v_presentacion_base_id integer;
BEGIN
    IF p_cantidad <= 0 THEN
        RAISE EXCEPTION 'La cantidad a entregar debe ser mayor a cero.';
    END IF;

    IF p_persona_receptor_id IS NOT NULL AND p_tipo_parentesco_receptor_id IS NULL THEN
        RAISE EXCEPTION 'Si la entrega la recibe un tercero, debe indicar el parentesco con el beneficiario.';
    END IF;

    -- Si viene de una linea de solicitud, el insumo entregado DEBE
    -- coincidir con el insumo de esa linea (evita registrar por error
    -- una entrega de un insumo distinto al que la persona solicito).
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

    INSERT INTO public.entrega (
        detalle_solicitud_id, persona_id, persona_receptor_id, tipo_parentesco_receptor_id,
        fecha_entrega, usuario_entrega_id, observaciones
    ) VALUES (
        p_detalle_solicitud_id, p_persona_id, p_persona_receptor_id, p_tipo_parentesco_receptor_id,
        CURRENT_DATE, p_usuario_entrega_id, p_observaciones
    ) RETURNING id INTO v_entrega_id;

    v_cantidad_resta := p_cantidad;

    FOR v_lote IN
        SELECT detalle_inventario_lote_id, cantidad_disponible
        FROM public.v_inventario_lote_fifo
        WHERE insumo_id = p_insumo_id
          AND activo = true
          AND cantidad_disponible > 0
        ORDER BY orden_fifo ASC
    LOOP
        EXIT WHEN v_cantidad_resta = 0;

        v_tomar := LEAST(v_lote.cantidad_disponible, v_cantidad_resta);

        INSERT INTO public.detalle_entrega (
            entrega_id, detalle_inventario_lote_id, presentacion_despacho_id, cantidad_despacho_original
        ) VALUES (
            v_entrega_id, v_lote.detalle_inventario_lote_id, v_presentacion_base_id, v_tomar
        );

        v_cantidad_resta := v_cantidad_resta - v_tomar;
    END LOOP;

    IF v_cantidad_resta > 0 THEN
        RAISE EXCEPTION 'No se pudo cubrir la cantidad completa. Faltaron: % unidades.',
            v_cantidad_resta;
    END IF;
END;
$procedure$;

COMMENT ON PROCEDURE public.sp_registrar_entrega(integer, integer, integer, integer, integer, text, integer, integer) IS
    'RF-ENT. Registra una entrega completa, despachando por FIFO/FEFO via v_inventario_lote_fifo. Valida coherencia con la LINEA de solicitud si se indica. Acepta receptor opcional distinto al beneficiario (entrega a familiar).';

-- ---------------------------------------------------------------------
-- sp_procesar_donacion_pendientes: al llegar stock nuevo de un insumo,
-- resuelve la lista de espera en orden de llegada (created_at ASC de
-- la LINEA, ya no de asignacion_pendiente -- tabla eliminada).
--
-- El backend lo invoca explicitamente tras registrar un nuevo
-- detalle_inventario_lote (decision de diseno: no es automatico via
-- trigger).
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_procesar_donacion_pendientes(
    IN p_insumo_id          integer,
    IN p_recepcion_lote_id  integer
)
LANGUAGE plpgsql
AS $procedure$
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
$procedure$;

COMMENT ON PROCEDURE public.sp_procesar_donacion_pendientes(integer, integer) IS
    'RF-INV. Resuelve la lista de espera de un insumo en orden FIFO de creacion de linea, cuando llega stock nuevo. Ya no depende de asignacion_pendiente (tabla eliminada) -- opera directo sobre detalle_solicitud_apoyo.';

-- ---------------------------------------------------------------------
-- sp_desactivar_entrega: anula una entrega completa (cabecera + todos
-- sus detalles), disparando la restauracion de inventario, y recalcula
-- la LINEA de solicitud asociada (si existe) -- que a su vez recalcula
-- la cabecera en cascada.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_desactivar_entrega(
    IN p_entrega_id    integer,
    IN p_usuario_id     integer,
    IN p_motivo          text DEFAULT NULL
)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_entrega   RECORD;
BEGIN
    SELECT * INTO v_entrega
    FROM public.entrega
    WHERE id = p_entrega_id
      AND activo = true;

    IF NOT FOUND THEN
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

    UPDATE public.detalle_entrega
    SET activo = false
    WHERE entrega_id = p_entrega_id;

    IF v_entrega.detalle_solicitud_id IS NOT NULL THEN
        PERFORM public.fn_recalcular_linea_solicitud(v_entrega.detalle_solicitud_id);
    END IF;
END;
$procedure$;

COMMENT ON PROCEDURE public.sp_desactivar_entrega(integer, integer, text) IS
    'RF-ENT. Anula una entrega, restaura inventario y recalcula la linea de solicitud asociada (y en cascada, la cabecera).';

-- ---------------------------------------------------------------------
-- sp_registrar_devolucion_prestamo: Grupo B (PREGUNTAS_DMM).
-- Registra la devolucion de un equipo prestado. La entrega original NO
-- se desactiva (se conserva el historial): solo se devuelve el stock a
-- los mismos lotes de origen y se cierra el contrato como DEVUELTO.
--
-- Cambio respecto a la version anterior: usa detalle_entrega_id (no
-- entrega_id, columna eliminada de contrato_prestamo) para ubicar el
-- detalle de inventario a restaurar. Ya no escribe en
-- contrato_prestamo.observaciones (columna eliminada) -- el motivo/
-- estado de la devolucion se refleja via estado_id.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_registrar_devolucion_prestamo(
    IN p_contrato_id   integer,
    IN p_usuario_id     integer
)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_contrato      RECORD;
    v_lote_activo   boolean;
    v_cantidad      integer;
    v_huerfano      boolean := false;
BEGIN
    SELECT cp.*, de.detalle_inventario_lote_id, de.cantidad_entregada
    INTO v_contrato
    FROM public.contrato_prestamo cp
    JOIN public.detalle_entrega de ON de.id = cp.detalle_entrega_id
    WHERE cp.id = p_contrato_id
      AND cp.activo = true;

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

    SELECT activo INTO v_lote_activo
    FROM public.detalle_inventario_lote
    WHERE id = v_contrato.detalle_inventario_lote_id
    FOR UPDATE;

    IF v_lote_activo IS TRUE THEN
        UPDATE public.detalle_inventario_lote
        SET cantidad_disponible = cantidad_disponible + v_contrato.cantidad_entregada
        WHERE id = v_contrato.detalle_inventario_lote_id;
    ELSE
        v_huerfano := true;
        RAISE WARNING
            'Devolución de contrato %: el lote % está inactivo; % unidades requieren revisión manual.',
            p_contrato_id, v_contrato.detalle_inventario_lote_id, v_contrato.cantidad_entregada;
    END IF;

    UPDATE public.contrato_prestamo
    SET fecha_devolucion_real = CURRENT_DATE,
        estado_id = (SELECT id FROM public.estado_contrato_prestamo WHERE nombre = 'DEVUELTO')
    WHERE id = p_contrato_id;

    IF v_huerfano THEN
        RAISE NOTICE 'Contrato % marcado como devuelto, pero requiere revision manual de inventario (lote de origen inactivo).', p_contrato_id;
    END IF;
END;
$procedure$;

COMMENT ON PROCEDURE public.sp_registrar_devolucion_prestamo(integer, integer) IS
    'Grupo B. Registra la devolucion de un equipo prestado: devuelve stock al lote de origen (via detalle_entrega_id) y cierra el contrato como DEVUELTO. No desactiva la entrega (se conserva el historial). No aplica a contratos de renovacion (detalle_entrega_id NULL).';

-- ---------------------------------------------------------------------
-- sp_cancelar_linea_solicitud (antes sp_cancelar_solicitud): cancela
-- UNA LINEA especifica de una solicitud (regla confirmada: se puede
-- cancelar un insumo individual sin cancelar el resto del tramite).
-- Dispara el recalculo de la cabecera al final.
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_cancelar_linea_solicitud(
    IN p_detalle_solicitud_id   integer,
    IN p_usuario_id              integer,
    IN p_motivo                   text DEFAULT NULL
)
LANGUAGE plpgsql
AS $procedure$
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
$procedure$;

COMMENT ON PROCEDURE public.sp_cancelar_linea_solicitud(integer, integer, text) IS
    'Grupo D. Cancela UNA LINEA especifica de una solicitud (un insumo dentro del tramite), sin afectar las demas lineas. Dispara el recalculo de la cabecera.';

-- ---------------------------------------------------------------------
-- sp_cancelar_solicitud_completa: cancela TODAS las lineas activas y no
-- cerradas de una solicitud de una sola vez (ej. el beneficiario ya no
-- necesita nada de lo pedido en el tramite completo).
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_cancelar_solicitud_completa(
    IN p_solicitud_id   integer,
    IN p_usuario_id      integer,
    IN p_motivo           text DEFAULT NULL
)
LANGUAGE plpgsql
AS $procedure$
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
$procedure$;

COMMENT ON PROCEDURE public.sp_cancelar_solicitud_completa(integer, integer, text) IS
    'Grupo D. Cancela todas las lineas activas (no entregadas ni ya canceladas) de una solicitud de una sola vez, reutilizando sp_cancelar_linea_solicitud por cada una.';

-- ---------------------------------------------------------------------
-- sp_dar_baja_insumo_vencido: sin cambios respecto a la version
-- anterior (no depende de la estructura de solicitud_apoyo).
-- ---------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE public.sp_dar_baja_insumo_vencido(
    IN p_detalle_inventario_lote_id    integer,
    IN p_usuario_id                     integer,
    IN p_motivo                          text
)
LANGUAGE plpgsql
AS $procedure$
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
$procedure$;

COMMENT ON PROCEDURE public.sp_dar_baja_insumo_vencido(integer, integer, text) IS
    'Grupo D. Da de baja un detalle_inventario_lote completo (vencido o dañado, se desecha). Pone cantidad_disponible en 0 y desactiva el lote, dejando motivo en observaciones.';

COMMIT;
















-- =====================================================================
-- SISTEMA DMM - FASE 5 (v2): Vistas de negocio
-- =====================================================================
-- v_inventario_lote_fifo ya se creo en la Fase 4 (04a_vista_fifo.sql).
--
-- Cambios respecto a la version anterior:
--   - v_stock_insumo, v_stock_insumo_presentaciones, v_semaforo_inventario,
--     v_reporte_stock_por_categoria: sin cambios (no dependen de
--     solicitud_apoyo).
--   - v_lista_espera: REESCRITA. Ya no usa asignacion_pendiente (tabla
--     eliminada) -- ahora consulta directo detalle_solicitud_apoyo
--     filtrando por PENDIENTE_ADQUISICION.
--   - v_persona_edad, v_reporte_personas_atendidas,
--     v_reporte_poblacion_beneficiada: ajustadas para usar genero_id
--     (FK a tipo_genero) en vez de la columna de texto eliminada.
--   - v_reporte_personas_atendidas: el JOIN a programa ahora pasa por
--     detalle_solicitud_apoyo -> solicitud_apoyo (via entrega.detalle_solicitud_id).
--   - v_solicitudes_activas: REESCRITA a nivel de LINEA (antes mostraba
--     una fila por solicitud con un solo insumo; ahora una solicitud
--     puede tener varias lineas, asi que la vista expone cada linea con
--     el estado global de su cabecera tambien visible).
-- =====================================================================

BEGIN;

CREATE OR REPLACE VIEW public.v_stock_insumo AS
SELECT
    i.id                        AS insumo_id,
    i.nombre                    AS insumo_nombre,
    i.es_perecedero,
    ci.nombre                   AS categoria_nombre,
    ci.requiere_fecha_caducidad,
    ci.requiere_codigo_fabricante,
    ci.bloquea_solicitud_sin_stock,
    um.nombre                   AS unidad_base_nombre,
    COALESCE(SUM(dl.cantidad_disponible) FILTER (WHERE dl.activo = true), 0)::integer AS stock_total,
    MIN(dl.fecha_caducidad) FILTER (WHERE dl.activo = true AND dl.cantidad_disponible > 0) AS proxima_caducidad,
    public.fn_semaforo_caducidad(
        MIN(dl.fecha_caducidad) FILTER (WHERE dl.activo = true AND dl.cantidad_disponible > 0)
    ) AS semaforo
FROM public.insumo i
JOIN public.categoria_insumo ci ON ci.id = i.categoria_id
JOIN public.unidad_medida um ON um.id = i.unidad_medida_base_id
LEFT JOIN public.detalle_inventario_lote dl ON dl.insumo_id = i.id
WHERE i.activo = true
GROUP BY i.id, i.nombre, i.es_perecedero, ci.nombre, ci.requiere_fecha_caducidad,
         ci.requiere_codigo_fabricante, ci.bloquea_solicitud_sin_stock, um.nombre;

COMMENT ON VIEW public.v_stock_insumo IS
    'RF-INV. Stock total por insumo (suma de detalles de lote activos, en unidad base), semaforo del detalle mas proximo a vencer, y reglas de negocio heredadas de su categoria.';

CREATE OR REPLACE VIEW public.v_stock_insumo_presentaciones AS
SELECT
    i.id                    AS insumo_id,
    i.nombre                AS insumo_nombre,
    vs.stock_total           AS stock_total_unidad_base,
    pi.id                    AS presentacion_id,
    um.nombre                AS presentacion_nombre,
    pi.factor_a_base,
    FLOOR(vs.stock_total / pi.factor_a_base)::integer          AS stock_en_presentacion,
    (vs.stock_total - FLOOR(vs.stock_total / pi.factor_a_base) * pi.factor_a_base)::integer AS residuo_unidad_base
FROM public.insumo i
JOIN public.v_stock_insumo vs ON vs.insumo_id = i.id
JOIN public.presentacion_insumo pi ON pi.insumo_id = i.id AND pi.activo = true
JOIN public.unidad_medida um ON um.id = pi.unidad_medida_id
WHERE i.activo = true;

COMMENT ON VIEW public.v_stock_insumo_presentaciones IS
    'Grupo A. Stock de cada insumo expresado en cada una de sus presentaciones definidas (ej. tabletas Y cajas), con residuo si no es multiplo exacto.';

CREATE OR REPLACE VIEW public.v_semaforo_inventario AS
SELECT
    dl.id               AS detalle_inventario_lote_id,
    i.id                AS insumo_id,
    i.nombre            AS insumo_nombre,
    rl.codigo_lote,
    dl.fecha_caducidad,
    rl.fecha_recepcion,
    dl.cantidad_disponible,
    dl.cantidad_inicial,
    public.fn_semaforo_caducidad(dl.fecha_caducidad) AS semaforo
FROM public.detalle_inventario_lote dl
JOIN public.insumo i ON i.id = dl.insumo_id
JOIN public.recepcion_donacion_lote rl ON rl.id = dl.recepcion_lote_id
WHERE dl.activo = true;

COMMENT ON VIEW public.v_semaforo_inventario IS
    'RF-INV-02. Cada producto (detalle) de lote activo con su clasificacion de semaforo de caducidad (VENCIDO/ROJO/AMARILLO/VERDE/GRIS) y el codigo del lote padre al que pertenece.';

-- ---------------------------------------------------------------------
-- v_lista_espera: REESCRITA. Ya no depende de asignacion_pendiente
-- (tabla eliminada) -- consulta directo detalle_solicitud_apoyo,
-- filtrando por lineas en PENDIENTE_ADQUISICION o
-- PENDIENTE_ENTREGA_PARCIAL (parcialmente asignadas, aun esperando mas
-- stock), ordenadas por antiguedad de la LINEA (created_at).
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_lista_espera AS
SELECT
    dsa.id                          AS detalle_solicitud_id,
    dsa.solicitud_id,
    p.id                             AS persona_id,
    p.nombres || ' ' || p.apellidos  AS persona_nombre_completo,
    i.nombre                         AS insumo_nombre,
    dsa.cantidad_requerida,
    dsa.cantidad_entregada,
    esa.nombre                       AS estado,
    dsa.created_at                   AS fecha_ingreso_espera,
    (CURRENT_DATE - dsa.created_at::date) AS dias_esperando
FROM public.detalle_solicitud_apoyo dsa
JOIN public.solicitud_apoyo sa ON sa.id = dsa.solicitud_id
JOIN public.persona p ON p.id = sa.persona_id
JOIN public.insumo i ON i.id = dsa.insumo_id
JOIN public.estado_solicitud_apoyo esa ON esa.id = dsa.estado_id
WHERE dsa.activo = true
  AND esa.nombre IN ('PENDIENTE_ADQUISICION', 'PENDIENTE_ENTREGA_PARCIAL')
ORDER BY dsa.created_at ASC;

COMMENT ON VIEW public.v_lista_espera IS
    'RF-INV. Lista de espera legible por LINEA de solicitud, ordenada FIFO por fecha de creacion de la linea. Ya no depende de asignacion_pendiente (tabla eliminada).';

-- ---------------------------------------------------------------------
-- v_persona_edad: ajustada para usar genero_id (FK a tipo_genero) en
-- vez de la columna de texto eliminada.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_persona_edad AS
SELECT
    p.id,
    p.nombres,
    p.apellidos,
    p.fecha_nacimiento,
    public.fn_calcular_edad(p.fecha_nacimiento) AS edad_actual,
    public.fn_es_menor(p.fecha_nacimiento)      AS es_menor,
    public.fn_es_adulto_mayor(p.fecha_nacimiento) AS es_adulto_mayor,
    tg.nombre       AS genero,
    c.nombre        AS comunidad_nombre,
    c.ubicacion     AS comunidad_ubicacion,
    m.nombre        AS municipio_nombre,
    d.nombre        AS departamento_nombre,
    p.cui_dpi,
    p.activo
FROM public.persona p
LEFT JOIN public.tipo_genero tg ON tg.id = p.genero_id
LEFT JOIN public.comunidad c ON c.id = p.comunidad_id
LEFT JOIN public.municipio m ON m.id = c.municipio_id
LEFT JOIN public.departamento d ON d.id = m.departamento_id;

COMMENT ON VIEW public.v_persona_edad IS
    'RF-BEN. Personas con edad, condicion de menor y adulto mayor calculadas en tiempo real (no almacenadas), genero resuelto via catalogo, y jerarquia geografica completa.';

-- ---------------------------------------------------------------------
-- v_reporte_personas_atendidas: ajustada. El JOIN a programa ahora pasa
-- por detalle_solicitud_apoyo -> solicitud_apoyo (via
-- entrega.detalle_solicitud_id, que apunta a la LINEA, no a la
-- cabecera). genero resuelto via catalogo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_reporte_personas_atendidas AS
SELECT
    e.id                                AS entrega_id,
    e.fecha_entrega,
    p.id                                AS persona_id,
    p.nombres || ' ' || p.apellidos     AS persona_nombre_completo,
    public.fn_edad_en_fecha(p.fecha_nacimiento, e.fecha_entrega) AS edad_a_la_entrega,
    tg.nombre                           AS genero,
    c.nombre                            AS comunidad_nombre,
    m.nombre                            AS municipio_nombre,
    depto.nombre                        AS departamento_nombre,
    pr.nombre                           AS programa_nombre,
    i.nombre                            AS insumo_nombre,
    de.cantidad_entregada,
    de.cantidad_despacho_original,
    um.nombre                           AS unidad_despacho,
    (
        SELECT string_agg(disc.nombre, ', ' ORDER BY disc.nombre)
        FROM public.persona_discapacidad pd
        JOIN public.discapacidad disc ON disc.id = pd.discapacidad_id
        WHERE pd.persona_id = p.id AND pd.activo = true
    )                                    AS discapacidades,
    u.username                          AS usuario_entrega
FROM public.entrega e
JOIN public.persona p ON p.id = e.persona_id
LEFT JOIN public.tipo_genero tg ON tg.id = p.genero_id
LEFT JOIN public.comunidad c ON c.id = p.comunidad_id
LEFT JOIN public.municipio m ON m.id = c.municipio_id
LEFT JOIN public.departamento depto ON depto.id = m.departamento_id
LEFT JOIN public.detalle_solicitud_apoyo dsa ON dsa.id = e.detalle_solicitud_id
LEFT JOIN public.solicitud_apoyo sa ON sa.id = dsa.solicitud_id
LEFT JOIN public.programa pr ON pr.id = sa.programa_id
JOIN public.usuario u ON u.id = e.usuario_entrega_id
JOIN public.detalle_entrega de ON de.entrega_id = e.id AND de.activo = true
JOIN public.detalle_inventario_lote dl ON dl.id = de.detalle_inventario_lote_id
JOIN public.insumo i ON i.id = dl.insumo_id
JOIN public.presentacion_insumo pi ON pi.id = de.presentacion_despacho_id
JOIN public.unidad_medida um ON um.id = pi.unidad_medida_id
WHERE e.activo = true;

COMMENT ON VIEW public.v_reporte_personas_atendidas IS
    'RF-REP. Base de reportes: una fila por item entregado (entrega x detalle), con edad calculada a la fecha de la entrega, genero via catalogo, y discapacidades agregadas para no duplicar filas.';

-- ---------------------------------------------------------------------
-- v_solicitudes_activas: REESCRITA a nivel de LINEA. Antes una fila era
-- una solicitud completa con un solo insumo; ahora una solicitud puede
-- tener varias lineas, asi que la vista expone cada linea individual
-- (con su propio insumo/cantidad/estado) junto con el estado global de
-- la cabecera para contexto.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_solicitudes_activas AS
SELECT
    sa.id                             AS solicitud_id,
    dsa.id                            AS detalle_solicitud_id,
    p.id                              AS persona_id,
    p.nombres || ' ' || p.apellidos   AS persona_nombre_completo,
    pr.nombre                         AS programa_nombre,
    i.nombre                          AS insumo_nombre,
    dsa.cantidad_requerida,
    dsa.cantidad_entregada,
    sa.fecha_solicitud,
    esa_linea.nombre                  AS estado_linea,
    esa_cabecera.nombre               AS estado_cabecera,
    sa.requiere_aprobacion,
    sa.aprobada,
    sa.fecha_aprobacion,
    ua.username                       AS aprobado_por_username
FROM public.solicitud_apoyo sa
JOIN public.detalle_solicitud_apoyo dsa ON dsa.solicitud_id = sa.id AND dsa.activo = true
JOIN public.persona p ON p.id = sa.persona_id
JOIN public.programa pr ON pr.id = sa.programa_id
JOIN public.insumo i ON i.id = dsa.insumo_id
JOIN public.estado_solicitud_apoyo esa_linea ON esa_linea.id = dsa.estado_id
JOIN public.estado_solicitud_apoyo esa_cabecera ON esa_cabecera.id = sa.estado_id
LEFT JOIN public.usuario ua ON ua.id = sa.aprobado_por
WHERE sa.activo = true
  AND esa_linea.nombre NOT IN ('ENTREGADA', 'CANCELADA');

COMMENT ON VIEW public.v_solicitudes_activas IS
    'RF-PRO. Lineas de solicitud en curso (no entregadas ni canceladas), con nombres legibles y el estado de la cabecera para contexto del tramite completo.';

CREATE OR REPLACE VIEW public.v_reporte_stock_por_categoria AS
SELECT
    ci.id                       AS categoria_id,
    ci.nombre                   AS categoria_nombre,
    COUNT(DISTINCT i.id)        AS cantidad_tipos_insumo,
    COALESCE(SUM(dl.cantidad_disponible) FILTER (WHERE dl.activo = true), 0)::integer AS unidades_totales_disponibles,
    COUNT(DISTINCT dl.id) FILTER (
        WHERE dl.activo = true AND dl.cantidad_disponible > 0
        AND public.fn_semaforo_caducidad(dl.fecha_caducidad) IN ('ROJO', 'VENCIDO')
    ) AS lotes_urgentes_o_vencidos
FROM public.categoria_insumo ci
LEFT JOIN public.insumo i ON i.categoria_id = ci.id AND i.activo = true
LEFT JOIN public.detalle_inventario_lote dl ON dl.insumo_id = i.id
WHERE ci.activo = true
GROUP BY ci.id, ci.nombre
ORDER BY ci.nombre;

COMMENT ON VIEW public.v_reporte_stock_por_categoria IS
    'Grupo E / RF-REP. Cantidad de tipos de insumo y unidades totales disponibles por categoria, mas conteo de lotes en estado urgente o vencido.';

-- ---------------------------------------------------------------------
-- v_reporte_poblacion_beneficiada: ajustada. genero resuelto via
-- catalogo; el JOIN a programa pasa por detalle_solicitud_apoyo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_reporte_poblacion_beneficiada AS
SELECT
    depto.nombre                                       AS departamento_nombre,
    m.nombre                                            AS municipio_nombre,
    c.nombre                                            AS comunidad_nombre,
    pr.nombre                                           AS programa_nombre,
    tg.nombre                                            AS genero,
    CASE
        WHEN public.fn_es_adulto_mayor(p.fecha_nacimiento) THEN 'ADULTO_MAYOR'
        WHEN public.fn_es_menor(p.fecha_nacimiento) THEN 'MENOR'
        ELSE 'ADULTO'
    END                                                  AS grupo_etario,
    (EXISTS (
        SELECT 1 FROM public.persona_discapacidad pd
        WHERE pd.persona_id = p.id AND pd.activo = true
    ))                                                   AS tiene_discapacidad,
    COUNT(DISTINCT p.id)                                 AS personas_unicas_beneficiadas,
    COUNT(DISTINCT e.id)                                 AS total_entregas,
    DATE_TRUNC('month', e.fecha_entrega)::date           AS mes
FROM public.entrega e
JOIN public.persona p ON p.id = e.persona_id
LEFT JOIN public.tipo_genero tg ON tg.id = p.genero_id
LEFT JOIN public.comunidad c ON c.id = p.comunidad_id
LEFT JOIN public.municipio m ON m.id = c.municipio_id
LEFT JOIN public.departamento depto ON depto.id = m.departamento_id
LEFT JOIN public.detalle_solicitud_apoyo dsa ON dsa.id = e.detalle_solicitud_id
LEFT JOIN public.solicitud_apoyo sa ON sa.id = dsa.solicitud_id
LEFT JOIN public.programa pr ON pr.id = sa.programa_id
WHERE e.activo = true
GROUP BY
    depto.nombre, m.nombre, c.nombre, pr.nombre, tg.nombre,
    grupo_etario, tiene_discapacidad, DATE_TRUNC('month', e.fecha_entrega);

COMMENT ON VIEW public.v_reporte_poblacion_beneficiada IS
    'Grupo E / RF-REP. Poblacion beneficiada agregada por ubicacion, programa, genero, grupo etario y discapacidad, con corte mensual -- base para el reporte general y comparativos anuales.';

COMMIT;






INSERT INTO public.rol (nombre, descripcion, activo)
SELECT * FROM (VALUES
  ('EMPLEADO_DMM', 'Operacion diaria: beneficiarios, solicitudes, inventario, entregas.', true),
  ('DIRECTORA', 'Permisos equivalentes a Administrador, incluida gestion de catalogos.', true),
  ('ALCALDE', 'Acceso exclusivo de solo lectura al modulo de reportes.', true),
  ('ADMINISTRADOR', 'Gestion de usuarios, configuracion y catalogos.', true)
) AS nuevos_roles(nombre, descripcion, activo)
WHERE NOT EXISTS (
  SELECT 1 FROM public.rol WHERE rol.nombre = nuevos_roles.nombre
);



select * from rol;
SELECT * FROM usuario;



INSERT INTO public.usuario (username, password_hash, rol_id, activo)
VALUES ('jonathan', '$2b$10$wu/L/nm4YMzjvHv0TcgCe.RhOTy9CdEAPZGHJaFfAuyLGoKDUwNFu', 1, true);






SELECT id, nombre FROM public.tipo_genero ORDER BY id;

SELECT id, nombre FROM public.tipo_parentesco ORDER BY id;

































-- =====================================================================
-- MIGRACIÓN: mover requiere_fecha_caducidad, requiere_codigo_fabricante
-- y bloquea_solicitud_sin_stock de categoria_insumo a insumo.
-- Elimina insumo.es_perecedero.
-- Cambio incremental, no requiere recrear la base de datos.
-- =====================================================================

BEGIN;

-- 1. Agregar las 3 columnas nuevas a insumo (con default, para no
--    romper filas existentes)
ALTER TABLE public.insumo
    ADD COLUMN requiere_fecha_caducidad    boolean NOT NULL DEFAULT false,
    ADD COLUMN requiere_codigo_fabricante  boolean NOT NULL DEFAULT false,
    ADD COLUMN bloquea_solicitud_sin_stock boolean NOT NULL DEFAULT false;

-- 2. Copiar los valores actuales desde categoria_insumo hacia cada
--    insumo, para no perder la configuración que ya existía
UPDATE public.insumo i
SET requiere_fecha_caducidad    = ci.requiere_fecha_caducidad,
    requiere_codigo_fabricante  = ci.requiere_codigo_fabricante,
    bloquea_solicitud_sin_stock = ci.bloquea_solicitud_sin_stock
FROM public.categoria_insumo ci
WHERE ci.id = i.categoria_id;

-- 3. Guardar la definición de v_stock_insumo_presentaciones para
--    recrearla despues (depende de v_stock_insumo, que vamos a
--    redefinir). Se elimina temporalmente junto con v_stock_insumo
--    para poder soltar las columnas viejas de categoria_insumo sin
--    CASCADE.
DROP VIEW IF EXISTS public.v_stock_insumo_presentaciones;
DROP VIEW IF EXISTS public.v_stock_insumo;

-- 4. Ahora si, quitar las 3 columnas viejas de categoria_insumo (ya
--    no hay ninguna vista que dependa de ellas)
ALTER TABLE public.categoria_insumo
    DROP COLUMN requiere_fecha_caducidad,
    DROP COLUMN requiere_codigo_fabricante,
    DROP COLUMN bloquea_solicitud_sin_stock;

-- 5. Quitar es_perecedero de insumo (redundante con
--    requiere_fecha_caducidad)
ALTER TABLE public.insumo
    DROP COLUMN es_perecedero;

-- 6. Actualizar fn_validar_stock_linea_solicitud: lee bloquea_solicitud_sin_stock
--    directo de insumo, sin JOIN a categoria_insumo
CREATE OR REPLACE FUNCTION public.fn_validar_stock_linea_solicitud()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
$function$;

COMMENT ON FUNCTION public.fn_validar_stock_linea_solicitud() IS
    'RF-PRO. Bloquea la creacion de una LINEA de solicitud cuyo insumo tiene bloquea_solicitud_sin_stock=true y stock 0 (tipicamente medicamentos). Equipos/alimentos sin stock SI se permiten (quedan PENDIENTE_ADQUISICION).';

-- 7. Actualizar fn_calcular_recepcion_lote: lee requiere_fecha_caducidad
--    y requiere_codigo_fabricante directo de insumo, sin JOIN
CREATE OR REPLACE FUNCTION public.fn_calcular_recepcion_lote()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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

    NEW.cantidad_inicial := public.fn_convertir_a_base(NEW.presentacion_recepcion_id, NEW.cantidad_recepcion_original);
    NEW.cantidad_disponible := NEW.cantidad_inicial;

    IF NEW.cantidad_inicial IS NULL OR NEW.cantidad_inicial <= 0 THEN
        RAISE EXCEPTION 'La cantidad recibida resultante es inválida (revise presentación y cantidad).';
    END IF;

    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_calcular_recepcion_lote() IS
    'Grupo A/D. Calcula cantidad_inicial/cantidad_disponible desde la presentacion de recepcion, valida coherencia insumo-presentacion, y exige fecha_caducidad/codigo_lote_fabricante segun la configuracion propia del insumo (requiere_fecha_caducidad/requiere_codigo_fabricante viven en insumo, no en categoria_insumo).';

-- 8. Recrear v_stock_insumo: lee las 3 banderas de insumo, sin
--    es_perecedero
CREATE OR REPLACE VIEW public.v_stock_insumo AS
SELECT
    i.id                        AS insumo_id,
    i.nombre                    AS insumo_nombre,
    ci.nombre                   AS categoria_nombre,
    i.requiere_fecha_caducidad,
    i.requiere_codigo_fabricante,
    i.bloquea_solicitud_sin_stock,
    um.nombre                   AS unidad_base_nombre,
    COALESCE(SUM(dl.cantidad_disponible) FILTER (WHERE dl.activo = true), 0)::integer AS stock_total,
    MIN(dl.fecha_caducidad) FILTER (WHERE dl.activo = true AND dl.cantidad_disponible > 0) AS proxima_caducidad,
    public.fn_semaforo_caducidad(
        MIN(dl.fecha_caducidad) FILTER (WHERE dl.activo = true AND dl.cantidad_disponible > 0)
    ) AS semaforo
FROM public.insumo i
JOIN public.categoria_insumo ci ON ci.id = i.categoria_id
JOIN public.unidad_medida um ON um.id = i.unidad_medida_base_id
LEFT JOIN public.detalle_inventario_lote dl ON dl.insumo_id = i.id
WHERE i.activo = true
GROUP BY i.id, i.nombre, ci.nombre, i.requiere_fecha_caducidad,
         i.requiere_codigo_fabricante, i.bloquea_solicitud_sin_stock, um.nombre;

COMMENT ON VIEW public.v_stock_insumo IS
    'RF-INV. Stock total por insumo (suma de detalles de lote activos, en unidad base), semaforo del detalle mas proximo a vencer, y reglas de negocio propias del insumo (requiere_fecha_caducidad/requiere_codigo_fabricante/bloquea_solicitud_sin_stock viven en insumo, no en categoria_insumo).';

-- 9. Recrear v_stock_insumo_presentaciones (se elimino en el paso 3
--    porque dependia de v_stock_insumo). Definicion sin cambios
--    respecto a la que ya existia.
CREATE OR REPLACE VIEW public.v_stock_insumo_presentaciones AS
SELECT
    i.id                    AS insumo_id,
    i.nombre                AS insumo_nombre,
    vs.stock_total           AS stock_total_unidad_base,
    pi.id                    AS presentacion_id,
    um.nombre                AS presentacion_nombre,
    pi.factor_a_base,
    FLOOR(vs.stock_total / pi.factor_a_base)::integer          AS stock_en_presentacion,
    (vs.stock_total - FLOOR(vs.stock_total / pi.factor_a_base) * pi.factor_a_base)::integer AS residuo_unidad_base
FROM public.insumo i
JOIN public.v_stock_insumo vs ON vs.insumo_id = i.id
JOIN public.presentacion_insumo pi ON pi.insumo_id = i.id AND pi.activo = true
JOIN public.unidad_medida um ON um.id = pi.unidad_medida_id
WHERE i.activo = true;

COMMENT ON VIEW public.v_stock_insumo_presentaciones IS
    'Grupo A. Stock de cada insumo expresado en cada una de sus presentaciones definidas (ej. tabletas Y cajas), con residuo si no es multiplo exacto.';

COMMIT;





















-- =====================================================================
-- MIGRACIÓN: factor de conversión pasa a vivir por LOTE, no fijo por
-- insumo. Se elimina por completo el factor de presentacion_insumo
-- (era solo un valor de precarga de UI, no una regla de negocio real;
-- esa responsabilidad queda del lado del frontend). Permite ademas que
-- un mismo insumo tenga lotes con distinto contenido por presentacion
-- (ej. frascos de 50ml y de 100ml).
-- Cambio incremental, no requiere recrear la base de datos.
-- =====================================================================

BEGIN;

-- 1. Agregar unidades_por_presentacion_lote a detalle_inventario_lote.
--    Nombre elegido para que sea autoexplicativo: "cuantas unidades
--    base equivale 1 unidad de la presentacion en que llego ESTE
--    lote" (ej. 50 tabletas por frasco en este lote especifico).
--    Se agrega nullable primero para poder rellenar filas existentes.
ALTER TABLE public.detalle_inventario_lote
    ADD COLUMN unidades_por_presentacion_lote numeric(12,4);

-- 2. Rellenar la columna nueva de las filas existentes con el factor
--    que tenía su presentacion_recepcion_id (mejor estimado disponible
--    para datos ya cargados, antes de eliminar esa columna)
UPDATE public.detalle_inventario_lote dl
SET unidades_por_presentacion_lote = pi.factor_a_base
FROM public.presentacion_insumo pi
WHERE pi.id = dl.presentacion_recepcion_id;

-- 3. Ahora que ya no hay nulos, hacerla NOT NULL y agregar su CHECK
ALTER TABLE public.detalle_inventario_lote
    ALTER COLUMN unidades_por_presentacion_lote SET NOT NULL,
    ADD CONSTRAINT detalle_inventario_lote_unidades_presentacion_check CHECK (unidades_por_presentacion_lote > 0);

-- 4. Eliminar v_stock_insumo_presentaciones temporalmente: depende de
--    presentacion_insumo.factor_a_base, que estamos por eliminar. Se
--    recrea mas abajo con la nueva logica (aproximada, sin ese campo).
DROP VIEW IF EXISTS public.v_stock_insumo_presentaciones;

-- 5. Eliminar por completo el factor de presentacion_insumo (ya no es
--    necesario -- ninguna regla de negocio depende de el; un valor de
--    precarga en el formulario, si se quiere, lo resuelve el frontend
--    consultando el ultimo lote recibido de ese insumo/presentacion)
ALTER TABLE public.presentacion_insumo
    DROP COLUMN factor_a_base;

-- 6. Actualizar fn_convertir_a_base: ya no tiene de donde leer un
--    factor generico (se elimino de presentacion_insumo). Se marca
--    como obsoleta -- ya no hay una fuente de verdad de conversion sin
--    conocer el lote especifico.
DROP FUNCTION IF EXISTS public.fn_convertir_a_base(integer, numeric);

-- 7. Actualizar fn_calcular_recepcion_lote: usa
--    NEW.unidades_por_presentacion_lote en vez de un factor generico
CREATE OR REPLACE FUNCTION public.fn_calcular_recepcion_lote()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
$function$;

COMMENT ON FUNCTION public.fn_calcular_recepcion_lote() IS
    'Grupo A/D. Calcula cantidad_inicial/cantidad_disponible usando unidades_por_presentacion_lote propio de este lote, valida coherencia insumo-presentacion, y exige fecha_caducidad/codigo_lote_fabricante segun la configuracion propia del insumo.';

-- 8. Actualizar fn_calcular_cantidad_entregada: usa
--    unidades_por_presentacion_lote del lote de origen especifico
--    cuando el despacho NO es en la presentacion default; si es en la
--    default, la conversion es directa (factor 1, sin depender del lote)
CREATE OR REPLACE FUNCTION public.fn_calcular_cantidad_entregada()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
$function$;

COMMENT ON FUNCTION public.fn_calcular_cantidad_entregada() IS
    'Grupo A. Calcula cantidad_entregada (unidad base). Si el despacho es en la presentacion default, la conversion es directa (factor 1). Si es en una presentacion no default, usa unidades_por_presentacion_lote del LOTE DE ORIGEN especifico, porque el mismo insumo puede tener lotes con contenido de presentacion distinto.';

-- 9. Recrear v_stock_insumo_presentaciones SIN factor generico: ahora
--    muestra, por presentacion, el promedio ponderado real segun los
--    lotes activos existentes (calculo honesto, no un numero fijo de
--    catalogo que ya no existe)
CREATE OR REPLACE VIEW public.v_stock_insumo_presentaciones AS
SELECT
    i.id                    AS insumo_id,
    i.nombre                AS insumo_nombre,
    vs.stock_total           AS stock_total_unidad_base,
    pi.id                    AS presentacion_id,
    um.nombre                AS presentacion_nombre,
    ROUND(AVG(dl.unidades_por_presentacion_lote), 4) AS unidades_por_presentacion_promedio,
    COUNT(dl.id)             AS lotes_considerados
FROM public.insumo i
JOIN public.v_stock_insumo vs ON vs.insumo_id = i.id
JOIN public.presentacion_insumo pi ON pi.insumo_id = i.id AND pi.activo = true
JOIN public.unidad_medida um ON um.id = pi.unidad_medida_id
LEFT JOIN public.detalle_inventario_lote dl
    ON dl.insumo_id = i.id
    AND dl.presentacion_recepcion_id = pi.id
    AND dl.activo = true
    AND dl.cantidad_disponible > 0
GROUP BY i.id, i.nombre, vs.stock_total, pi.id, um.nombre;

COMMENT ON VIEW public.v_stock_insumo_presentaciones IS
    'Grupo A. Para cada insumo y presentacion, muestra el promedio de unidades_por_presentacion_lote de los lotes activos con stock disponible en esa presentacion (y cuantos lotes se consideraron). Es informativo/aproximado: si hay lotes con distinto contenido por presentacion, no representa un valor unico exacto. No usar para decidir cantidades de despacho -- eso se calcula contra el lote real de origen.';

COMMIT;


















-- ====================================================================
-- MIGRACIÓN: agrega catálogo de marcas y su vínculo por lote.
-- La marca es un dato del LOTE recibido, no del insumo (un mismo
-- insumo puede llegar de marcas distintas segun quien done). Opcional,
-- aplica por igual a cualquier tipo de insumo, sin regla condicional
-- por categoria.
-- Cambio incremental, no requiere recrear la base de datos.
-- =====================================================================

BEGIN;

-- 1. Catálogo de marcas
CREATE TABLE public.marca_insumo
(
    id              serial PRIMARY KEY,
    nombre          character varying(150) NOT NULL,
    activo          boolean NOT NULL DEFAULT true,
    created_at      timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      timestamp,
    created_by      integer,
    updated_by      integer,
    CONSTRAINT marca_insumo_nombre_key UNIQUE (nombre),
    CONSTRAINT fk_mi_created_by FOREIGN KEY (created_by) REFERENCES public.usuario (id),
    CONSTRAINT fk_mi_updated_by FOREIGN KEY (updated_by) REFERENCES public.usuario (id)
);

-- 2. Vínculo opcional desde detalle_inventario_lote: la marca es un
--    dato de ESTE lote especifico, no del insumo -- un mismo insumo
--    puede llegar en donaciones de marcas distintas.
ALTER TABLE public.detalle_inventario_lote
    ADD COLUMN marca_id integer,
    ADD CONSTRAINT fk_dil_marca FOREIGN KEY (marca_id)
        REFERENCES public.marca_insumo (id) ON UPDATE NO ACTION ON DELETE RESTRICT;

CREATE INDEX idx_detalle_inventario_marca
    ON public.detalle_inventario_lote (marca_id) WHERE marca_id IS NOT NULL;

-- 3. Trigger de auditoria y updated_at para el catalogo nuevo (mismo
--    patron que el resto de catalogos del sistema)
CREATE TRIGGER trg_updated_at_marca_insumo
    BEFORE UPDATE ON public.marca_insumo
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_auditoria_marca_insumo
    AFTER INSERT OR UPDATE OR DELETE ON public.marca_insumo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

COMMIT;










-- Zona horaria de la base ACTUAL, sea cual sea su nombre. Se usa un bloque DO
-- porque ALTER DATABASE no acepta una expresion en el nombre, y escribirlo a
-- mano hace que quien monte otro entorno ajuste la base equivocada.
--
-- Solo afecta a sesiones NUEVAS: hay que reconectar (reiniciar el backend,
-- cerrar y reabrir pgAdmin) para que surta efecto.
DO $zona$
BEGIN
    EXECUTE format(
        'ALTER DATABASE %I SET timezone = %L',
        current_database(), 'America/Guatemala'
    );
END
$zona$;






SELECT current_setting('TimeZone'), CURRENT_DATE, now();








-- Sustituye el timestamp por el momento en que corriste el ALTER
WITH corte AS (SELECT TIMESTAMP '2026-08-10 00:00' AS aplicado)
SELECT 'entrega' AS tabla, id, fecha_entrega AS fecha, created_at FROM public.entrega, corte
WHERE created_at < aplicado AND created_at::time < TIME '06:00'
UNION ALL
SELECT 'recepcion_donacion_lote', id, fecha_recepcion, created_at FROM public.recepcion_donacion_lote, corte
WHERE created_at < aplicado AND created_at::time < TIME '06:00'
UNION ALL
SELECT 'solicitud_apoyo', id, fecha_solicitud, created_at FROM public.solicitud_apoyo, corte
WHERE created_at < aplicado AND created_at::time < TIME '06:00'
UNION ALL
SELECT 'contrato_prestamo', id, fecha_inicio, created_at FROM public.contrato_prestamo, corte
WHERE created_at < aplicado AND created_at::time < TIME '06:00'
UNION ALL
SELECT 'multa_prestamo', id, fecha_aplicacion, created_at FROM public.multa_prestamo, corte
WHERE created_at < aplicado AND created_at::time < TIME '06:00'
ORDER BY tabla, id;












-- El caso mas usado: historial de una ficha concreta
-- (GET /api/auditoria/:tabla/:registroId) y el filtro por tabla.
CREATE INDEX IF NOT EXISTS idx_auditoria_tabla_registro
  ON public.auditoria_log (tabla_afectada, registro_id);

-- El listado ordena por fecha_hora DESC y filtra por rango de fechas.
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha
  ON public.auditoria_log (fecha_hora DESC);

-- Filtro por autor. Parcial: las filas sin usuario (inserciones por SQL directo
-- sin app.usuario_id) no se buscan nunca por este camino.
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario
  ON public.auditoria_log (usuario_id)
  WHERE usuario_id IS NOT NULL;






DROP TRIGGER IF EXISTS trg_auditoria_sesion ON public.sesion;

-- El alta de sesion (login) se audita siempre: es el registro de acceso.
CREATE TRIGGER trg_auditoria_sesion_insert
AFTER INSERT ON public.sesion
FOR EACH ROW
EXECUTE FUNCTION public.fn_auditoria();

-- El UPDATE solo se audita si cambio algo distinto del latido. Se comparan las
-- filas como jsonb quitando las tres columnas que el latido mueve:
-- ultima_actividad, y updated_at/updated_by que arrastran el trigger de
-- updated_at y el propio backend.
CREATE TRIGGER trg_auditoria_sesion_update
AFTER UPDATE ON public.sesion
FOR EACH ROW
WHEN (
  to_jsonb(OLD) - 'ultima_actividad' - 'updated_at' - 'updated_by'
  IS DISTINCT FROM
  to_jsonb(NEW) - 'ultima_actividad' - 'updated_at' - 'updated_by'
)
EXECUTE FUNCTION public.fn_auditoria();






















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
            PASSWORD 'dmm2026';
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

GRANT CONNECT ON DATABASE "dmm_usumatlan_db" TO dmm_app;
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


select * from persona;

select * from documento_persona;













SELECT tableowner, count(*) AS tablas
FROM pg_tables WHERE schemaname = 'public'
GROUP BY tableowner;

SELECT nspname AS esquema, pg_get_userbyid(nspowner) AS dueño,
       has_schema_privilege('dmm_app', 'public', 'CREATE') AS puede_crear
FROM pg_namespace WHERE nspname = 'public';


REVOKE CREATE ON SCHEMA public FROM dmm_app;
ALTER TABLE public.sesion OWNER TO postgres;



SELECT datname, pg_get_userbyid(datdba) AS dueno_bd
FROM pg_database WHERE datname = current_database();

-- NOTA: el cambio de propietario de la base NO puede hacerse desde aqui.
-- `ALTER DATABASE ... OWNER TO` exige estar conectado a OTRA base, asi que
-- corriendolo dentro de este script siempre falla. Es un paso previo: ver el
-- encabezado del archivo, seccion "Antes de ejecutar".


-- (idem para la base de pruebas: paso previo, no parte de este script)


SELECT tablename, tableowner FROM pg_tables
WHERE schemaname = 'public' AND tableowner <> 'postgres';
















-- ============================================================================
-- 13_fix_recalculo_al_anular_entrega.sql
--
-- PROBLEMA (detectado por tests/negocio/lista-espera.test.ts)
--
-- Al anular una entrega, `cantidad_entregada` de la linea vuelve a 0
-- correctamente, pero el `estado_id` se queda en ENTREGADA.
--
-- La causa esta en el CASE de `fn_recalcular_linea_solicitud`: cuando el total
-- entregado es 0, la rama ELSE conserva el estado actual. El comentario
-- original lo explica -- "conserva el estado actual (PENDIENTE_ENTREGA o
-- PENDIENTE_ADQUISICION) si no hay nada entregado" -- y para una linea que
-- nunca recibio nada eso es correcto. Lo que no se contemplo es la REGRESION:
-- si la linea estaba ENTREGADA y la entrega se anula, el estado previo que se
-- conserva es justamente ENTREGADA.
--
-- CONSECUENCIA
--
-- La linea queda marcada como entregada con 0 unidades entregadas. Como
-- `v_lista_espera` solo muestra PENDIENTE_ADQUISICION y
-- PENDIENTE_ENTREGA_PARCIAL, esa persona desaparece de toda lista de
-- pendientes; y como `fn_recalcular_cabecera_solicitud` cuenta ENTREGADA como
-- linea cerrada, la solicitud completa se marca como entregada.
--
-- Es decir: se registra una entrega por error, se anula, y el beneficiario
-- queda fuera del sistema como si ya hubiera recibido su insumo. En silencio.
--
-- La cabecera tiene el mismo hueco: si todas sus lineas vuelven a un estado
-- pendiente, ninguna rama del IF se cumple y la solicitud conserva ENTREGADA.
--
-- CORRECCION
--
-- Ambas funciones pasan a recalcular tambien "hacia atras". Los estados
-- terminales por decision humana (CANCELADA, RECHAZADA, APROBADA) NO se tocan:
-- una linea cancelada no debe resucitar porque se anule una entrega.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Linea de solicitud
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_linea_solicitud(
    p_detalle_solicitud_id integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
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
    WHERE e.detalle_solicitud_id = p_detalle_solicitud_id
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
        --      pendiente, o desaparece de la lista de espera. Este es el caso
        --      que faltaba.
        IF v_estado_actual IN ('ENTREGADA', 'PENDIENTE_ENTREGA_PARCIAL') THEN
            -- Se recalcula por stock, igual que al crear la linea, porque el
            -- inventario pudo cambiar desde entonces.
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
$function$;

COMMENT ON FUNCTION public.fn_recalcular_linea_solicitud(integer) IS
    'RF-PRO/RF-ENT. Recalcula cantidad_entregada y estado de una LINEA a partir de sus entregas activas. Soporta la REGRESION: si se anulan las entregas, la linea vuelve a PENDIENTE_ENTREGA/PENDIENTE_ADQUISICION segun stock, en vez de quedarse en ENTREGADA con 0 unidades. Los estados terminales por decision humana (CANCELADA, RECHAZADA, APROBADA) no se alteran.';

-- ---------------------------------------------------------------------
-- 2. Cabecera de solicitud
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_recalcular_cabecera_solicitud(
    p_solicitud_id integer
)
RETURNS void
LANGUAGE plpgsql
AS $function$
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
$function$;

COMMENT ON FUNCTION public.fn_recalcular_cabecera_solicitud(integer) IS
    'RF-PRO/RF-ENT. Deriva el estado de la cabecera agregando el de todas sus lineas: ENTREGADA cuando todas estan ENTREGADA/CANCELADA; PENDIENTE_ENTREGA_PARCIAL si hay avance; y PENDIENTE_ENTREGA/PENDIENTE_ADQUISICION cuando ninguna linea tiene avance (caso de anulacion). RECHAZADA no se deriva: es decision de direccion.';

COMMIT;

-- ============================================================================
-- DATOS YA AFECTADOS
--
-- Si en la base real se anulo alguna entrega antes de aplicar esto, quedaron
-- lineas ENTREGADA con cantidad_entregada = 0, invisibles en la lista de
-- espera. Para encontrarlas:
--
--   SELECT dsa.id, dsa.solicitud_id, p.nombres || ' ' || p.apellidos AS persona,
--          i.nombre AS insumo, dsa.cantidad_requerida
--   FROM public.detalle_solicitud_apoyo dsa
--   JOIN public.estado_solicitud_apoyo esa ON esa.id = dsa.estado_id
--   JOIN public.solicitud_apoyo sa ON sa.id = dsa.solicitud_id
--   JOIN public.persona p ON p.id = sa.persona_id
--   JOIN public.insumo i ON i.id = dsa.insumo_id
--   WHERE esa.nombre = 'ENTREGADA'
--     AND dsa.cantidad_entregada = 0
--     AND dsa.activo = true;
--
-- Para repararlas, basta con forzar el recalculo ya corregido:
--
--   SELECT public.fn_recalcular_linea_solicitud(id)
--   FROM public.detalle_solicitud_apoyo dsa
--   WHERE dsa.activo = true
--     AND dsa.cantidad_entregada = 0
--     AND dsa.estado_id = (SELECT id FROM public.estado_solicitud_apoyo
--                          WHERE nombre = 'ENTREGADA');
--
-- Revise el listado antes de ejecutar la reparacion.
-- ============================================================================