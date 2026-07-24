import type { PoolClient } from "pg";
import prisma from "../../db/prisma.js";
import { pool } from "../../db/pool.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface ComunidadRow {
  id: number;
  municipio_id: number;
  nombre: string;
  ubicacion: string | null;
  activo: boolean;
}

//Columnas de negocio expuestas en la API
const SELECT_PUBLICO = {
  id: true,
  municipio_id: true,
  nombre: true,
  ubicacion: true,
  activo: true,
} as const;

export async function listarComunidades(params: {
  municipioId?: number;
  incluirInactivas: boolean;
}): Promise<ComunidadRow[]> {
  const { municipioId, incluirInactivas } = params;
  return prisma.comunidad.findMany({
    where: {
      ...(incluirInactivas ? {} : { activo: true }),
      ...(municipioId !== undefined ? { municipio_id: municipioId } : {}),
    },
    orderBy: { nombre: "asc" },
    select: SELECT_PUBLICO,
  });
}

export async function buscarComunidadPorId(
  id: number,
): Promise<ComunidadRow | null> {
  return prisma.comunidad.findUnique({ where: { id }, select: SELECT_PUBLICO });
}

export async function existeNombreDuplicadoEnMunicipio(
  nombre: string,
  municipioId: number,
  excluirId?: number,
): Promise<boolean> {
  const existente = await prisma.comunidad.findFirst({
    where: { nombre, municipio_id: municipioId },
    select: { id: true },
  });
  if (!existente) return false;
  if (excluirId !== undefined && existente.id === excluirId) return false;
  return true;
}

export async function tienePersonasActivas(
  id: number,
  client: PoolClient,
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM public.persona WHERE comunidad_id = $1 AND activo = true LIMIT 1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function crearComunidad(
  usuarioId: number,
  datos: { municipio_id: number; nombre: string; ubicacion?: string | null },
): Promise<ComunidadRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<ComunidadRow>(
      `INSERT INTO public.comunidad (municipio_id, nombre, ubicacion, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, municipio_id, nombre, ubicacion, activo`,
      [datos.municipio_id, datos.nombre, datos.ubicacion ?? null, usuarioId],
    );
    return result.rows[0];
  });
}

export async function editarComunidad(
  usuarioId: number,
  id: number,
  datos: { municipio_id?: number; nombre?: string; ubicacion?: string | null },
): Promise<ComunidadRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of ["municipio_id", "nombre", "ubicacion"] as const) {
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

    const result = await client.query<ComunidadRow>(
      `UPDATE public.comunidad
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING id, municipio_id, nombre, ubicacion, activo`,
      valores,
    );
    return result.rows[0];
  });
}

export async function cambiarEstadoComunidad(
  usuarioId: number,
  id: number,
  nuevoEstado: boolean,
): Promise<ComunidadRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<ComunidadRow>(
      `UPDATE public.comunidad
       SET activo = $1, updated_by = $2
       WHERE id = $3
       RETURNING id, municipio_id, nombre, ubicacion, activo`,
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
