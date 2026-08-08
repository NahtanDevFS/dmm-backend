import prisma from "../../db/prisma.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface RecetaMedicaRow {
  id: number;
  solicitud_id: number;
  ruta_archivo: string;
  fecha_emision: Date | null;
  observaciones: string | null;
  activo: boolean;
}

const SELECT_PUBLICO = {
  id: true,
  solicitud_id: true,
  ruta_archivo: true,
  fecha_emision: true,
  observaciones: true,
  activo: true,
} as const;

export async function listarRecetasDeSolicitud(
  solicitudId: number,
): Promise<RecetaMedicaRow[]> {
  return prisma.receta_medica.findMany({
    where: { solicitud_id: solicitudId, activo: true },
    select: SELECT_PUBLICO,
    orderBy: { id: "asc" },
  });
}

export async function buscarRecetaPorId(
  id: number,
): Promise<RecetaMedicaRow | null> {
  return prisma.receta_medica.findUnique({
    where: { id },
    select: SELECT_PUBLICO,
  });
}

export async function crearRecetaMedica(
  usuarioId: number,
  datos: {
    solicitudId: number;
    rutaArchivo: string;
    fechaEmision?: string | null;
    observaciones?: string | null;
  },
): Promise<RecetaMedicaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<RecetaMedicaRow>(
      `INSERT INTO public.receta_medica
         (solicitud_id, ruta_archivo, fecha_emision, observaciones, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, solicitud_id, ruta_archivo, fecha_emision, observaciones, activo`,
      [
        datos.solicitudId,
        datos.rutaArchivo,
        datos.fechaEmision ?? null,
        datos.observaciones ?? null,
        usuarioId,
      ],
    );
    return result.rows[0];
  });
}

/**
 * Borrado lógico: el archivo permanece en disco, igual que documento_persona y
 * documento_recepcion. La FK de detalle_solicitud_apoyo.receta_medica_id es
 * ON DELETE SET NULL, pero al no borrar la fila el vínculo se conserva.
 */
export async function eliminarRecetaMedica(
  usuarioId: number,
  id: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.receta_medica SET activo = false, updated_by = $1 WHERE id = $2`,
      [usuarioId, id],
    );
  });
}
