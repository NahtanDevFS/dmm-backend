import prisma from "../../db/prisma.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

/**
 * El legajo escaneado de una solicitud: los formularios firmados en papel,
 * recetas, constancias, cualquier respaldo.
 *
 * Va por SOLICITUD y no por cada formulario llenado porque en la práctica los
 * tres formularios de una silla de ruedas son un solo expediente, y quien los
 * busca los busca juntos. `formulario_id` permite decir a cuál corresponde
 * cada escaneo, pero es opcional: hay documentos del legajo que no son
 * ninguno de los formularios, y forzar una clasificación que no existe
 * empuja a elegir cualquiera con tal de poder guardar.
 */
export interface DocumentoSolicitudRow {
  id: number;
  solicitud_id: number;
  formulario_id: number | null;
  ruta_archivo: string;
  descripcion: string | null;
  observaciones: string | null;
  activo: boolean;
}

const SELECT_PUBLICO = {
  id: true,
  solicitud_id: true,
  formulario_id: true,
  ruta_archivo: true,
  descripcion: true,
  observaciones: true,
  activo: true,
} as const;

export async function listarDocumentosDeSolicitud(
  solicitudId: number,
): Promise<DocumentoSolicitudRow[]> {
  return prisma.documento_solicitud.findMany({
    where: { solicitud_id: solicitudId, activo: true },
    select: SELECT_PUBLICO,
    orderBy: { id: "asc" },
  });
}

export async function buscarDocumentoSolicitudPorId(
  id: number,
): Promise<DocumentoSolicitudRow | null> {
  return prisma.documento_solicitud.findUnique({
    where: { id },
    select: SELECT_PUBLICO,
  });
}

export async function crearDocumentoSolicitud(
  usuarioId: number,
  datos: {
    solicitudId: number;
    formularioId?: number | null;
    rutaArchivo: string;
    descripcion?: string | null;
    observaciones?: string | null;
  },
): Promise<DocumentoSolicitudRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<DocumentoSolicitudRow>(
      `INSERT INTO public.documento_solicitud
         (solicitud_id, formulario_id, ruta_archivo, descripcion,
          observaciones, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, solicitud_id, formulario_id, ruta_archivo, descripcion,
                 observaciones, activo`,
      [
        datos.solicitudId,
        datos.formularioId ?? null,
        datos.rutaArchivo,
        datos.descripcion ?? null,
        datos.observaciones ?? null,
        usuarioId,
      ],
    );
    return result.rows[0];
  });
}

/**
 * Borrado lógico, igual que documento_persona y documento_recepcion: el
 * archivo permanece en disco. Un documento retirado de la vista puede haber
 * respaldado una aprobación que ya ocurrió, y borrarlo de verdad dejaría esa
 * decisión sin sustento.
 */
export async function eliminarDocumentoSolicitud(
  usuarioId: number,
  id: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.documento_solicitud
       SET activo = false, updated_by = $1
       WHERE id = $2`,
      [usuarioId, id],
    );
  });
}
