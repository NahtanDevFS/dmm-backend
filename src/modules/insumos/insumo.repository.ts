import type { PoolClient } from "pg";
import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface InsumoRow {
  id: number;
  categoria_id: number;
  unidad_medida_base_id: number;
  nombre: string;
  descripcion: string | null;
  requiere_fecha_caducidad: boolean;
  requiere_codigo_fabricante: boolean;
  bloquea_solicitud_sin_stock: boolean;
  /**
   * Si cada unidad es una pieza identificable con su propio número de serie.
   * Cambia cómo se ingresa —una fila por serie, no un lote con cantidad— y
   * permite elegir qué unidad concreta se entrega.
   */
  serie_por_unidad: boolean;
  activo: boolean;
}

/** Stock agregado tal como lo expone la vista v_stock_insumo. */
export interface StockInsumoRow {
  insumo_id: number;
  insumo_nombre: string;
  categoria_nombre: string;
  unidad_base_nombre: string;
  requiere_fecha_caducidad: boolean;
  requiere_codigo_fabricante: boolean;
  bloquea_solicitud_sin_stock: boolean;
  stock_total: number;
  proxima_caducidad: Date | null;
  semaforo: string | null;
}

/** Una fila del listado de stock: lo de la vista más la categoría por id. */
export interface StockInsumoListadoRow extends StockInsumoRow {
  categoria_id: number;
  /**
   * Si la categoría admite préstamo. Sin esto la pantalla ofrecería prestar
   * paracetamol: prestar solo tiene sentido con lo que se devuelve.
   */
  permite_prestamo: boolean;
  /** Si cada unidad tiene su propia serie y se elige al entregar. */
  serie_por_unidad: boolean;
}

export interface StockPresentacionRow {
  presentacion_id: number;
  presentacion_nombre: string;
  unidades_por_presentacion_promedio: string | null;
  lotes_considerados: string;
}

//Columnas de negocio expuestas en la API (sin columnas de auditoría)
const SELECT_PUBLICO = {
  id: true,
  categoria_id: true,
  unidad_medida_base_id: true,
  nombre: true,
  descripcion: true,
  requiere_fecha_caducidad: true,
  requiere_codigo_fabricante: true,
  bloquea_solicitud_sin_stock: true,
  serie_por_unidad: true,
  activo: true,
} as const;

const COLUMNAS_RETURNING = Object.keys(SELECT_PUBLICO).join(", ");

const CAMPOS_EDITABLES = [
  "categoria_id",
  "unidad_medida_base_id",
  "nombre",
  "descripcion",
  "requiere_fecha_caducidad",
  "requiere_codigo_fabricante",
  "bloquea_solicitud_sin_stock",
  "serie_por_unidad",
] as const;

export async function listarInsumos(params: {
  categoriaId?: number;
  busqueda?: string;
  incluirInactivos: boolean;
  limite: number;
  desplazamiento: number;
}): Promise<{ total: number; filas: InsumoRow[] }> {
  const { categoriaId, busqueda, incluirInactivos } = params;
  const where = {
    ...(incluirInactivos ? {} : { activo: true }),
    ...(categoriaId !== undefined ? { categoria_id: categoriaId } : {}),
    ...(busqueda
      ? { nombre: { contains: busqueda, mode: "insensitive" as const } }
      : {}),
  };

  const [total, filas] = await Promise.all([
    prisma.insumo.count({ where }),
    prisma.insumo.findMany({
      where,
      orderBy: { nombre: "asc" },
      select: SELECT_PUBLICO,
      take: params.limite,
      skip: params.desplazamiento,
    }),
  ]);

  return { total, filas };
}

export async function buscarInsumoPorId(id: number): Promise<InsumoRow | null> {
  return prisma.insumo.findUnique({ where: { id }, select: SELECT_PUBLICO });
}

/**
 * Unicidad compuesta (nombre, categoria_id): el mismo nombre puede repetirse
 * en categorías distintas, así que el duplicado se valida siempre contra una
 * categoría concreta.
 */
export async function existeNombreDuplicadoEnCategoria(
  nombre: string,
  categoriaId: number,
  excluirId?: number,
): Promise<boolean> {
  const existente = await prisma.insumo.findFirst({
    where: { nombre, categoria_id: categoriaId },
    select: { id: true },
  });
  if (!existente) return false;
  if (excluirId !== undefined && existente.id === excluirId) return false;
  return true;
}

export async function existeCategoriaInsumoActiva(
  id: number,
): Promise<boolean> {
  const categoria = await prisma.categoria_insumo.findUnique({
    where: { id },
    select: { activo: true },
  });
  return categoria?.activo === true;
}

export async function existeUnidadMedidaActiva(id: number): Promise<boolean> {
  const unidad = await prisma.unidad_medida.findUnique({
    where: { id },
    select: { activo: true },
  });
  return unidad?.activo === true;
}

export async function tieneLineasDeSolicitudActivas(
  id: number,
  client: PoolClient,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM public.detalle_solicitud_apoyo
     WHERE insumo_id = $1 AND activo = true
     LIMIT 1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function tieneStockDisponible(
  id: number,
  client: PoolClient,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM public.detalle_inventario_lote
     WHERE insumo_id = $1 AND activo = true AND cantidad_disponible > 0
     LIMIT 1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function crearInsumo(
  usuarioId: number,
  datos: Record<string, unknown>,
): Promise<InsumoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const campos = CAMPOS_EDITABLES.filter((c) => c in datos);
    const columnas = [...campos, "created_by"];
    const valores = [...campos.map((c) => datos[c]), usuarioId];
    const placeholders = valores.map((_, i) => `$${i + 1}`).join(", ");

    const result = await client.query<InsumoRow>(
      `INSERT INTO public.insumo (${columnas.join(", ")})
       VALUES (${placeholders})
       RETURNING ${COLUMNAS_RETURNING}`,
      valores,
    );
    return result.rows[0];
  });
}

export async function editarInsumo(
  usuarioId: number,
  id: number,
  datos: Record<string, unknown>,
): Promise<InsumoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of CAMPOS_EDITABLES) {
      if (campo in datos) {
        sets.push(`${campo} = $${i}`);
        valores.push(datos[campo]);
        i += 1;
      }
    }

    sets.push(`updated_by = $${i}`);
    valores.push(usuarioId);
    i += 1;

    valores.push(id);

    const result = await client.query<InsumoRow>(
      `UPDATE public.insumo
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING ${COLUMNAS_RETURNING}`,
      valores,
    );
    return result.rows[0];
  });
}

export async function cambiarEstadoInsumo(
  usuarioId: number,
  id: number,
  nuevoEstado: boolean,
): Promise<InsumoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<InsumoRow>(
      `UPDATE public.insumo
       SET activo = $1, updated_by = $2
       WHERE id = $3
       RETURNING ${COLUMNAS_RETURNING}`,
      [nuevoEstado, usuarioId, id],
    );
    return result.rows[0];
  });
}

/**
 * La vista v_stock_insumo filtra por `insumo.activo = true`, así que un insumo
 * desactivado no aparece aunque conserve existencias. En ese caso se devuelve
 * el total con fn_stock_disponible y sin datos de caducidad, en vez de
 * reimplementar aquí la agregación de la vista.
 */
export async function obtenerStockInsumo(
  id: number,
): Promise<StockInsumoRow | null> {
  const result = await pool.query<StockInsumoRow>(
    `SELECT insumo_id, insumo_nombre, categoria_nombre, unidad_base_nombre,
            requiere_fecha_caducidad, requiere_codigo_fabricante,
            bloquea_solicitud_sin_stock, stock_total, proxima_caducidad, semaforo
     FROM public.v_stock_insumo
     WHERE insumo_id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Stock de todos los insumos de una sola vez, tal como lo expone
 * v_stock_insumo. Existe para las pantallas que necesitan mostrar las
 * existencias *antes* de que el usuario elija —el desplegable de la entrega
 * directa, sobre todo—: preguntar insumo por insumo obligaría a una llamada
 * por opción y quien atiende no podría contestar "sí hay" sin abrir nada.
 *
 * La vista filtra por `insumo.activo = true`, así que los desactivados no
 * aparecen. Es lo correcto aquí: no se entrega lo que está dado de baja.
 */
export async function listarStockInsumos(params: {
  categoriaId?: number;
  busqueda?: string;
}): Promise<StockInsumoListadoRow[]> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];

  if (params.categoriaId !== undefined) {
    valores.push(params.categoriaId);
    condiciones.push(`i.categoria_id = $${valores.length}`);
  }
  if (params.busqueda) {
    valores.push(`%${params.busqueda}%`);
    condiciones.push(`v.insumo_nombre ILIKE $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  // La vista no expone categoria_id, solo el nombre. Se une con insumo para
  // poder filtrar y agrupar por id, que es lo que usa el frontend.
  const result = await pool.query<StockInsumoListadoRow>(
    `SELECT v.insumo_id, v.insumo_nombre, i.categoria_id, v.categoria_nombre,
            ci.permite_prestamo, i.serie_por_unidad,
            v.unidad_base_nombre, v.requiere_fecha_caducidad,
            v.requiere_codigo_fabricante, v.bloquea_solicitud_sin_stock,
            v.stock_total, v.proxima_caducidad, v.semaforo
     FROM public.v_stock_insumo v
     JOIN public.insumo i ON i.id = v.insumo_id
     JOIN public.categoria_insumo ci ON ci.id = i.categoria_id
     ${where}
     ORDER BY v.categoria_nombre, v.insumo_nombre`,
    valores,
  );
  return result.rows;
}

/**
 * Unidades identificables disponibles de un insumo, una por número de serie.
 *
 * Es lo que se le muestra a quien entrega para que elija la pieza que tiene
 * en la mano. Sin esto, FEFO elegiría una por su cuenta y el registro diría
 * una serie mientras la persona se lleva otra —que en préstamos importa,
 * porque hay que saber cuál silla devolver.
 *
 * Devuelve vacío para insumos que no llevan serie: ahí la unidad concreta no
 * significa nada y el reparto automático es lo correcto.
 */
export interface UnidadDisponibleRow {
  detalle_inventario_lote_id: number;
  insumo_id: number;
  insumo_nombre: string;
  numero_serie: string | null;
  codigo_envio: string | null;
  fecha_recepcion: Date;
  institucion_nombre: string;
  marca_nombre: string | null;
  cantidad_disponible: number;
}

export async function listarUnidadesDisponibles(
  insumoId: number,
): Promise<UnidadDisponibleRow[]> {
  const result = await pool.query<UnidadDisponibleRow>(
    `SELECT detalle_inventario_lote_id, insumo_id, insumo_nombre, numero_serie,
            codigo_envio, fecha_recepcion, institucion_nombre, marca_nombre,
            cantidad_disponible
     FROM public.v_unidades_disponibles
     WHERE insumo_id = $1
     ORDER BY numero_serie`,
    [insumoId],
  );
  return result.rows;
}

export async function obtenerStockTotalInsumo(id: number): Promise<number> {
  const result = await pool.query<{ stock: number }>(
    `SELECT public.fn_stock_disponible($1) AS stock`,
    [id],
  );
  return result.rows[0]?.stock ?? 0;
}

export async function obtenerStockPorPresentacion(
  id: number,
): Promise<StockPresentacionRow[]> {
  const result = await pool.query<StockPresentacionRow>(
    `SELECT presentacion_id, presentacion_nombre,
            unidades_por_presentacion_promedio, lotes_considerados
     FROM public.v_stock_insumo_presentaciones
     WHERE insumo_id = $1
     ORDER BY presentacion_nombre`,
    [id],
  );
  return result.rows;
}

//Usado por el controller para validar dependencias sin abrir una transacción de escritura
export async function withReadClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
