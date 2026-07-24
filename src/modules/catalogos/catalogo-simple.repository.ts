import type { PoolClient } from "pg";
import prisma from "../../db/prisma.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";
import type { CatalogoSimpleConfig } from "./catalogo-simple.config.js";

export interface CatalogoSimpleRow {
  id: number;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  [campoExtra: string]: unknown;
}

function columnasPublicas(config: CatalogoSimpleConfig): string[] {
  return [
    "id",
    "nombre",
    "descripcion",
    "activo",
    ...(config.camposExtra ?? []).map((c) => c.nombre),
  ];
}

function selectPublico(config: CatalogoSimpleConfig): Record<string, true> {
  return Object.fromEntries(columnasPublicas(config).map((c) => [c, true]));
}

export async function listarCatalogoSimple(
  config: CatalogoSimpleConfig,
  incluirInactivos: boolean,
): Promise<CatalogoSimpleRow[]> {
  const model = (prisma as any)[config.prismaModel];
  return model.findMany({
    where: incluirInactivos ? {} : { activo: true },
    orderBy: { nombre: "asc" },
    select: selectPublico(config),
  });
}

export async function buscarCatalogoSimplePorId(
  config: CatalogoSimpleConfig,
  id: number,
): Promise<CatalogoSimpleRow | null> {
  const model = (prisma as any)[config.prismaModel];
  return model.findUnique({ where: { id }, select: selectPublico(config) });
}

export async function existeNombreDuplicado(
  config: CatalogoSimpleConfig,
  nombre: string,
  excluirId?: number,
): Promise<boolean> {
  const model = (prisma as any)[config.prismaModel];
  const existente = await model.findUnique({
    where: { nombre },
    select: { id: true },
  });
  if (!existente) return false;
  if (excluirId !== undefined && existente.id === excluirId) return false;
  return true;
}

export async function tieneDependenciasActivas(
  config: CatalogoSimpleConfig,
  id: number,
  client: PoolClient,
): Promise<boolean> {
  if (!config.dependencia) return false;
  const { tablaDependiente, columnaFk } = config.dependencia;
  const result = await client.query(
    `SELECT 1 FROM public.${tablaDependiente}
     WHERE ${columnaFk} = $1 AND activo = true
     LIMIT 1`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function crearCatalogoSimple(
  config: CatalogoSimpleConfig,
  usuarioId: number,
  datos: { nombre: string; descripcion?: string | null; [k: string]: unknown },
): Promise<CatalogoSimpleRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const camposExtra = config.camposExtra ?? [];
    const columnas = [
      "nombre",
      "descripcion",
      "created_by",
      ...camposExtra.map((c) => c.nombre),
    ];
    const valores = [
      datos.nombre,
      datos.descripcion ?? null,
      usuarioId,
      ...camposExtra.map((c) => datos[c.nombre] ?? null),
    ];
    const placeholders = valores.map((_, i) => `$${i + 1}`).join(", ");

    const result = await client.query<CatalogoSimpleRow>(
      `INSERT INTO public.${config.tableName} (${columnas.join(", ")})
       VALUES (${placeholders})
       RETURNING ${columnasPublicas(config).join(", ")}`,
      valores,
    );
    return result.rows[0];
  });
}

export async function editarCatalogoSimple(
  config: CatalogoSimpleConfig,
  usuarioId: number,
  id: number,
  datos: { nombre?: string; descripcion?: string | null; [k: string]: unknown },
): Promise<CatalogoSimpleRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const camposExtra = config.camposExtra ?? [];
    const camposEditables = [
      "nombre",
      "descripcion",
      ...camposExtra.map((c) => c.nombre),
    ];

    const sets: string[] = [];
    const valores: unknown[] = [];
    let i = 1;

    for (const campo of camposEditables) {
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

    const result = await client.query<CatalogoSimpleRow>(
      `UPDATE public.${config.tableName}
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING ${columnasPublicas(config).join(", ")}`,
      valores,
    );
    return result.rows[0];
  });
}

export async function cambiarEstadoCatalogoSimple(
  config: CatalogoSimpleConfig,
  usuarioId: number,
  id: number,
  nuevoEstado: boolean,
): Promise<CatalogoSimpleRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<CatalogoSimpleRow>(
      `UPDATE public.${config.tableName}
       SET activo = $1, updated_by = $2
       WHERE id = $3
       RETURNING ${columnasPublicas(config).join(", ")}`,
      [nuevoEstado, usuarioId, id],
    );
    return result.rows[0];
  });
}
