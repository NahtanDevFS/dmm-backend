import { poolOwner, idCatalogo } from "./bd.js";

/**
 * Constructores de escenarios para las pruebas de reglas de negocio.
 *
 * Sin esto cada prueba necesitaria veinte lineas de INSERT (comunidad ->
 * persona -> unidad -> categoria -> insumo -> presentacion -> institucion ->
 * recepcion -> lote) antes de poder afirmar nada, y la regla que se esta
 * probando quedaria enterrada.
 *
 * Todo se inserta con `poolOwner` y `usuario_id` explicito. No se usa
 * `withUserTransaction` a proposito: aqui se esta MONTANDO el escenario, no
 * ejerciendo el codigo de la aplicacion. Lo que se ejerce se invoca en cada
 * prueba.
 */

export async function crearUsuario(sufijo = "fixture"): Promise<number> {
  const rolId = await idCatalogo("rol", "ADMINISTRADOR");
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.usuario (username, password_hash, rol_id, activo)
     VALUES ($1, 'x', $2, true)
     ON CONFLICT (username) DO UPDATE SET activo = true
     RETURNING id`,
    [`test_${sufijo}`, rolId],
  );
  return rows[0].id;
}

export async function crearComunidad(usuarioId: number): Promise<number> {
  const dep = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.departamento (nombre, created_by) VALUES ('Zacapa', $1)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [usuarioId],
  );
  const mun = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.municipio (departamento_id, nombre, created_by)
     VALUES ($1, 'Usumatlan', $2)
     ON CONFLICT (nombre, departamento_id) DO UPDATE SET activo = true RETURNING id`,
    [dep.rows[0].id, usuarioId],
  );
  const com = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.comunidad (municipio_id, nombre, created_by)
     VALUES ($1, 'Centro', $2)
     ON CONFLICT (nombre, municipio_id) DO UPDATE SET activo = true RETURNING id`,
    [mun.rows[0].id, usuarioId],
  );
  return com.rows[0].id;
}

export interface OpcionesPersona {
  nombres?: string;
  apellidos?: string;
  /** Por defecto una fecha de persona adulta. */
  fechaNacimiento?: string;
  cuiDpi?: string | null;
  comunidadId?: number | null;
}

export async function crearPersona(
  usuarioId: number,
  opciones: OpcionesPersona = {},
): Promise<number> {
  const {
    nombres = "Persona",
    apellidos = "De Prueba",
    fechaNacimiento = "1990-01-01",
    cuiDpi = null,
    comunidadId = null,
  } = opciones;

  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.persona
       (cui_dpi, nombres, apellidos, fecha_nacimiento, comunidad_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [cuiDpi, nombres, apellidos, fechaNacimiento, comunidadId, usuarioId],
  );
  return rows[0].id;
}

export interface OpcionesInsumo {
  nombre?: string;
  requiereFechaCaducidad?: boolean;
  requiereCodigoFabricante?: boolean;
  bloqueaSolicitudSinStock?: boolean;
}

export interface InsumoCreado {
  insumoId: number;
  categoriaId: number;
  unidadId: number;
  /** Presentacion por defecto (es_default = true). */
  presentacionId: number;
}

export async function crearInsumo(
  usuarioId: number,
  opciones: OpcionesInsumo = {},
): Promise<InsumoCreado> {
  const {
    nombre = `Insumo ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    requiereFechaCaducidad = false,
    requiereCodigoFabricante = false,
    bloqueaSolicitudSinStock = false,
  } = opciones;

  const cat = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.categoria_insumo (nombre, created_by) VALUES ('General', $1)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [usuarioId],
  );
  const uni = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.unidad_medida (nombre, created_by) VALUES ('Unidad', $1)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [usuarioId],
  );

  const ins = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.insumo
       (categoria_id, unidad_medida_base_id, nombre,
        requiere_fecha_caducidad, requiere_codigo_fabricante,
        bloquea_solicitud_sin_stock, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      cat.rows[0].id,
      uni.rows[0].id,
      nombre,
      requiereFechaCaducidad,
      requiereCodigoFabricante,
      bloqueaSolicitudSinStock,
      usuarioId,
    ],
  );

  const pres = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.presentacion_insumo
       (insumo_id, unidad_medida_id, es_default, created_by)
     VALUES ($1, $2, true, $3)
     RETURNING id`,
    [ins.rows[0].id, uni.rows[0].id, usuarioId],
  );

  return {
    insumoId: ins.rows[0].id,
    categoriaId: cat.rows[0].id,
    unidadId: uni.rows[0].id,
    presentacionId: pres.rows[0].id,
  };
}

export async function crearRecepcion(usuarioId: number): Promise<number> {
  const inst = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.institucion_donante (nombre, created_by)
     VALUES ('Donante de prueba', $1)
     ON CONFLICT (nombre) DO UPDATE SET activo = true RETURNING id`,
    [usuarioId],
  );
  const { rows } = await poolOwner.query<{ id: number }>(
    `INSERT INTO public.recepcion_donacion_lote (institucion_id, created_by)
     VALUES ($1, $2) RETURNING id`,
    [inst.rows[0].id, usuarioId],
  );
  return rows[0].id;
}

export interface OpcionesLote {
  /** Cantidad en la presentacion de recepcion, NO en unidades base. */
  cantidad?: number;
  /** Multiplicador: unidades base por cada unidad de la presentacion. */
  unidadesPorPresentacion?: number;
  fechaCaducidad?: string | null;
  codigoFabricante?: string | null;
  recepcionId?: number;
}

export interface LoteCreado {
  loteId: number;
  cantidadInicial: number;
  cantidadDisponible: number;
}

/**
 * Crea un lote. `cantidad_inicial` y `cantidad_disponible` NO se envian: las
 * calcula el trigger `fn_calcular_recepcion_lote` como
 * FLOOR(cantidad * unidades_por_presentacion). Se devuelven tal como quedaron
 * en la base, para que las pruebas afirmen sobre el valor real y no el esperado.
 */
export async function crearLote(
  usuarioId: number,
  insumo: InsumoCreado,
  opciones: OpcionesLote = {},
): Promise<LoteCreado> {
  const {
    cantidad = 10,
    unidadesPorPresentacion = 1,
    fechaCaducidad = null,
    codigoFabricante = null,
    recepcionId,
  } = opciones;

  const recepcion = recepcionId ?? (await crearRecepcion(usuarioId));

  const { rows } = await poolOwner.query<{
    id: number;
    cantidad_inicial: number;
    cantidad_disponible: number;
  }>(
    `INSERT INTO public.detalle_inventario_lote
       (insumo_id, recepcion_lote_id, presentacion_recepcion_id,
        cantidad_recepcion_original, unidades_por_presentacion_lote,
        fecha_caducidad, codigo_lote_fabricante, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, cantidad_inicial, cantidad_disponible`,
    [
      insumo.insumoId,
      recepcion,
      insumo.presentacionId,
      cantidad,
      unidadesPorPresentacion,
      fechaCaducidad,
      codigoFabricante,
      usuarioId,
    ],
  );

  return {
    loteId: rows[0].id,
    cantidadInicial: rows[0].cantidad_inicial,
    cantidadDisponible: rows[0].cantidad_disponible,
  };
}

export async function stockDisponible(loteId: number): Promise<number> {
  const { rows } = await poolOwner.query<{ cantidad_disponible: number }>(
    `SELECT cantidad_disponible FROM public.detalle_inventario_lote WHERE id = $1`,
    [loteId],
  );
  return rows[0]?.cantidad_disponible ?? -1;
}

/** Fecha ISO desplazada respecto a hoy, para caducidades. */
export function enDias(dias: number): string {
  const f = new Date();
  f.setDate(f.getDate() + dias);
  return f.toISOString().slice(0, 10);
}
