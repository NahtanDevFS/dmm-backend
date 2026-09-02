import prisma from "../../db/prisma.js";
import { withUserTransaction } from "../../db/withUserTransaction.js";

export interface EvidenciaContratoRow {
  id: number;
  contrato_prestamo_id: number;
  tipo_evidencia_id: number;
  ruta_archivo: string;
  observaciones: string | null;
  activo: boolean;
}

const SELECT_PUBLICO = {
  id: true,
  contrato_prestamo_id: true,
  tipo_evidencia_id: true,
  ruta_archivo: true,
  observaciones: true,
  activo: true,
} as const;

export async function listarEvidenciasDeContrato(
  contratoId: number,
): Promise<EvidenciaContratoRow[]> {
  return prisma.evidencia_contrato_prestamo.findMany({
    where: { contrato_prestamo_id: contratoId, activo: true },
    select: SELECT_PUBLICO,
    orderBy: { id: "asc" },
  });
}

export async function buscarEvidenciaContratoPorId(
  id: number,
): Promise<EvidenciaContratoRow | null> {
  return prisma.evidencia_contrato_prestamo.findUnique({
    where: { id },
    select: SELECT_PUBLICO,
  });
}

export async function existeTipoEvidenciaContratoActivo(
  id: number,
): Promise<boolean> {
  const tipo = await prisma.tipo_evidencia_contrato.findUnique({
    where: { id },
    select: { activo: true },
  });
  return tipo?.activo === true;
}

export async function crearEvidenciaContrato(
  usuarioId: number,
  datos: {
    contratoId: number;
    tipoEvidenciaId: number;
    rutaArchivo: string;
    observaciones?: string | null;
  },
): Promise<EvidenciaContratoRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<EvidenciaContratoRow>(
      `INSERT INTO public.evidencia_contrato_prestamo
         (contrato_prestamo_id, tipo_evidencia_id, ruta_archivo, observaciones, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, contrato_prestamo_id, tipo_evidencia_id, ruta_archivo, observaciones, activo`,
      [
        datos.contratoId,
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
export async function eliminarEvidenciaContrato(
  usuarioId: number,
  id: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.evidencia_contrato_prestamo SET activo = false, updated_by = $1 WHERE id = $2`,
      [usuarioId, id],
    );
  });
}
