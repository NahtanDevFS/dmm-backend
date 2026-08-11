import type { PoolClient } from "pg";
import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface CategoriaInsumoRow {
  id: number;
  nombre: string;
  requiere_fecha_caducidad: boolean;
  requiere_codigo_fabricante: boolean;
  bloquea_solicitud_sin_stock: boolean;
  activo: boolean;
}

//Columnas de negocio expuestas en la API
const SELECT_PUBLICO = {
  id: true,
  nombre: true,
  requiere_fecha_caducidad: true,
  requiere_codigo_fabricante: true,
  bloquea_solicitud_sin_stock: true,
  activo: true,
} as const;

export async function listarCategoriasInsumo(
  incluirInactivas: boolean,
): Promise<CategoriaInsumoRow[]> {
  return prisma.categoria_insumo.findMany({
    where: incluirInactivas ? {} : { activo: true },
    orderBy: { nombre: "asc" },
    select: SELECT_PUBLICO,
  });
}

export async function buscarCategoriaInsumoPorId(
  id: number,
): Promise<CategoriaInsumoRow | null> {
  return prisma.categoria_insumo.findUnique({
    where: { id },
    select: SELECT_PUBLICO,
  });
}

export async function existeNombreDuplicado(
  nombre: string,
  excluirId?: number,
): Promise<boolean> {
  const existente = await prisma.categoria_insumo.findUnique({
    where: { nombre },
    select: { id: true },
  });
  if (!existente) return false;
  if (excluirId !== undefined && existente.id === excluirId) return false;
  return true;
}

export async function tieneInsumosActivos(
  id: number,
  client: PoolClient,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM public.insumo WHERE categoria_id = $1 AND activo = true LIMIT 1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function crearCategoriaInsumo(
  usuarioId: number,
  datos: {
    nombre: string;
    requiere_fecha_caducidad?: boolean;
    requiere_codigo_fabricante?: boolean;
    bloquea_solicitud_sin_stock?: boolean;
  },
): Promise<CategoriaInsumoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<CategoriaInsumoRow>(
      `INSERT INTO public.categoria_insumo
         (nombre, requiere_fecha_caducidad, requiere_codigo_fabricante, bloquea_solicitud_sin_stock, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, requiere_fecha_caducidad, requiere_codigo_fabricante, bloquea_solicitud_sin_stock, activo`,
      [
        datos.nombre,
        datos.requiere_fecha_caducidad ?? false,
        datos.requiere_codigo_fabricante ?? false,
        datos.bloquea_solicitud_sin_stock ?? false,
        usuarioId,
      ],
    );
    return result.rows[0];
  });
}

export async function editarCategoriaInsumo(
  usuarioId: number,
  id: number,
  datos: {
    nombre?: string;
    requiere_fecha_caducidad?: boolean;
    requiere_codigo_fabricante?: boolean;
    bloquea_solicitud_sin_stock?: boolean;
  },
): Promise<CategoriaInsumoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of [
      "nombre",
      "requiere_fecha_caducidad",
      "requiere_codigo_fabricante",
      "bloquea_solicitud_sin_stock",
    ] as const) {
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

    const result = await client.query<CategoriaInsumoRow>(
      `UPDATE public.categoria_insumo
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING id, nombre, requiere_fecha_caducidad, requiere_codigo_fabricante, bloquea_solicitud_sin_stock, activo`,
      valores,
    );
    return result.rows[0];
  });
}

export async function cambiarEstadoCategoriaInsumo(
  usuarioId: number,
  id: number,
  nuevoEstado: boolean,
): Promise<CategoriaInsumoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<CategoriaInsumoRow>(
      `UPDATE public.categoria_insumo
       SET activo = $1, updated_by = $2
       WHERE id = $3
       RETURNING id, nombre, requiere_fecha_caducidad, requiere_codigo_fabricante, bloquea_solicitud_sin_stock, activo`,
      [nuevoEstado, usuarioId, id],
    );
    return result.rows[0];
  });
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
