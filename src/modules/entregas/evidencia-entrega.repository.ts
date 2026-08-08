import prisma from "../../db/prisma.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface EvidenciaEntregaRow {
  id: number;
  entrega_id: number;
  tipo_evidencia_id: number;
  ruta_archivo: string;
  observaciones: string | null;
  activo: boolean;
}

const SELECT_PUBLICO = {
  id: true,
  entrega_id: true,
  tipo_evidencia_id: true,
  ruta_archivo: true,
  observaciones: true,
  activo: true,
} as const;

export async function listarEvidenciasDeEntrega(
  entregaId: number,
): Promise<EvidenciaEntregaRow[]> {
  return prisma.evidencia_entrega.findMany({
    where: { entrega_id: entregaId, activo: true },
    select: SELECT_PUBLICO,
    orderBy: { id: "asc" },
  });
}

export async function buscarEvidenciaPorId(
  id: number,
): Promise<EvidenciaEntregaRow | null> {
  return prisma.evidencia_entrega.findUnique({
    where: { id },
    select: SELECT_PUBLICO,
  });
}

export async function crearEvidenciaEntrega(
  usuarioId: number,
  datos: {
    entregaId: number;
    tipoEvidenciaId: number;
    rutaArchivo: string;
    observaciones?: string | null;
  },
): Promise<EvidenciaEntregaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<EvidenciaEntregaRow>(
      `INSERT INTO public.evidencia_entrega
         (entrega_id, tipo_evidencia_id, ruta_archivo, observaciones, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, entrega_id, tipo_evidencia_id, ruta_archivo, observaciones, activo`,
      [
        datos.entregaId,
        datos.tipoEvidenciaId,
        datos.rutaArchivo,
        datos.observaciones ?? null,
        usuarioId,
      ],
    );
    return result.rows[0];
  });
}

/** Borrado lógico: el archivo queda en disco, igual que el resto de adjuntos. */
export async function eliminarEvidenciaEntrega(
  usuarioId: number,
  id: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.evidencia_entrega SET activo = false, updated_by = $1 WHERE id = $2`,
      [usuarioId, id],
    );
  });
}
