import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface PresentacionInsumoRow {
  id: number;
  insumo_id: number;
  unidad_medida_id: number;
  es_default: boolean;
  activo: boolean;
}

const COLUMNAS = "id, insumo_id, unidad_medida_id, es_default, activo";

/**
 * Se consulta con `pg` en vez de Prisma a propósito: el índice único parcial
 * `idx_presentacion_default_unica` (insumo_id WHERE es_default = true) hace que
 * la introspección de Prisma marque `insumo_id` como único y modele la relación
 * insumo→presentaciones como 1:1, cuando en realidad es 1:N.
 */
export async function listarPresentacionesDeInsumo(params: {
  insumoId: number;
  incluirInactivas: boolean;
}): Promise<PresentacionInsumoRow[]> {
  const { insumoId, incluirInactivas } = params;
  const result = await pool.query<PresentacionInsumoRow>(
    `SELECT ${COLUMNAS}
     FROM public.presentacion_insumo
     WHERE insumo_id = $1 ${incluirInactivas ? "" : "AND activo = true"}
     ORDER BY es_default DESC, id`,
    [insumoId],
  );
  return result.rows;
}

export async function buscarPresentacionPorId(
  id: number,
): Promise<PresentacionInsumoRow | null> {
  const result = await pool.query<PresentacionInsumoRow>(
    `SELECT ${COLUMNAS} FROM public.presentacion_insumo WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function existeUnidadEnInsumo(
  insumoId: number,
  unidadMedidaId: number,
  excluirId?: number,
): Promise<boolean> {
  const result = await pool.query<{ id: number }>(
    `SELECT id FROM public.presentacion_insumo
     WHERE insumo_id = $1 AND unidad_medida_id = $2
     LIMIT 1`,
    [insumoId, unidadMedidaId],
  );
  const existente = result.rows[0];
  if (!existente) return false;
  if (excluirId !== undefined && existente.id === excluirId) return false;
  return true;
}

export async function contarPresentacionesActivas(
  insumoId: number,
): Promise<number> {
  const result = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.presentacion_insumo
     WHERE insumo_id = $1 AND activo = true`,
    [insumoId],
  );
  return result.rows[0]?.n ?? 0;
}

export async function tieneLotesActivos(
  id: number,
  client: PoolClient,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM public.detalle_inventario_lote
     WHERE presentacion_recepcion_id = $1 AND activo = true
     LIMIT 1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Desmarca la presentación default vigente del insumo. Obligatorio antes de
 * marcar otra: `idx_presentacion_default_unica` es un índice único parcial no
 * diferible, así que dos filas con es_default = true para el mismo insumo son
 * rechazadas por Postgres incluso dentro de la misma transacción.
 */
async function desmarcarDefaultVigente(
  client: PoolClient,
  insumoId: number,
  usuarioId: number,
  excluirId?: number,
): Promise<void> {
  await client.query(
    `UPDATE public.presentacion_insumo
     SET es_default = false, updated_by = $2
     WHERE insumo_id = $1 AND es_default = true
       ${excluirId !== undefined ? "AND id <> $3" : ""}`,
    excluirId !== undefined
      ? [insumoId, usuarioId, excluirId]
      : [insumoId, usuarioId],
  );
}

export async function crearPresentacion(
  usuarioId: number,
  insumoId: number,
  datos: { unidad_medida_id: number; es_default: boolean },
): Promise<PresentacionInsumoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    if (datos.es_default) {
      await desmarcarDefaultVigente(client, insumoId, usuarioId);
    }

    const result = await client.query<PresentacionInsumoRow>(
      `INSERT INTO public.presentacion_insumo
         (insumo_id, unidad_medida_id, es_default, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNAS}`,
      [insumoId, datos.unidad_medida_id, datos.es_default, usuarioId],
    );
    return result.rows[0];
  });
}

export async function editarPresentacion(
  usuarioId: number,
  id: number,
  insumoId: number,
  datos: { unidad_medida_id?: number; es_default?: boolean },
): Promise<PresentacionInsumoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    if (datos.es_default === true) {
      await desmarcarDefaultVigente(client, insumoId, usuarioId, id);
    }

    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of ["unidad_medida_id", "es_default"] as const) {
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

    const result = await client.query<PresentacionInsumoRow>(
      `UPDATE public.presentacion_insumo
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING ${COLUMNAS}`,
      valores,
    );
    return result.rows[0];
  });
}

export async function cambiarEstadoPresentacion(
  usuarioId: number,
  id: number,
  nuevoEstado: boolean,
): Promise<PresentacionInsumoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<PresentacionInsumoRow>(
      `UPDATE public.presentacion_insumo
       SET activo = $1, updated_by = $2
       WHERE id = $3
       RETURNING ${COLUMNAS}`,
      [nuevoEstado, usuarioId, id],
    );
    return result.rows[0];
  });
}
