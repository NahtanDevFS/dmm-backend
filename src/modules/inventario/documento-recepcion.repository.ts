import prisma from "../../db/prisma.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface DocumentoRecepcionRow {
  id: number;
  recepcion_lote_id: number;
  ruta_archivo: string;
  descripcion: string | null;
  activo: boolean;
}

const SELECT_PUBLICO = {
  id: true,
  recepcion_lote_id: true,
  ruta_archivo: true,
  descripcion: true,
  activo: true,
} as const;

export async function listarDocumentosDeRecepcion(
  recepcionId: number,
): Promise<DocumentoRecepcionRow[]> {
  return prisma.documento_recepcion.findMany({
    where: { recepcion_lote_id: recepcionId, activo: true },
    select: SELECT_PUBLICO,
    orderBy: { id: "asc" },
  });
}

export async function buscarDocumentoRecepcionPorId(
  id: number,
): Promise<DocumentoRecepcionRow | null> {
  return prisma.documento_recepcion.findUnique({
    where: { id },
    select: SELECT_PUBLICO,
  });
}

export async function crearDocumentoRecepcion(
  usuarioId: number,
  datos: {
    recepcionId: number;
    rutaArchivo: string;
    descripcion?: string | null;
  },
): Promise<DocumentoRecepcionRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<DocumentoRecepcionRow>(
      `INSERT INTO public.documento_recepcion
         (recepcion_lote_id, ruta_archivo, descripcion, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, recepcion_lote_id, ruta_archivo, descripcion, activo`,
      [
        datos.recepcionId,
        datos.rutaArchivo,
        datos.descripcion ?? null,
        usuarioId,
      ],
    );
    return result.rows[0];
  });
}

/** Borrado lógico: el archivo permanece en disco, igual que documento_persona. */
export async function eliminarDocumentoRecepcion(
  usuarioId: number,
  id: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.documento_recepcion
       SET activo = false, updated_by = $1
       WHERE id = $2`,
      [usuarioId, id],
    );
  });
}
