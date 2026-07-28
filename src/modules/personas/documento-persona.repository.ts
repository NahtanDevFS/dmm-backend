import { withUserTransaction } from "../../db/withUserTransaction.js";
import prisma from "../../db/prisma.js";

export interface DocumentoPersonaRow {
  id: number;
  persona_id: number;
  tipo_documento_id: number;
  numero_documento: string | null;
  ruta_archivo: string | null;
  observaciones: string | null;
  activo: boolean;
}

const SELECT_PUBLICO = {
  id: true,
  persona_id: true,
  tipo_documento_id: true,
  numero_documento: true,
  ruta_archivo: true,
  observaciones: true,
  activo: true,
} as const;

export async function listarDocumentosDePersona(
  personaId: number,
): Promise<DocumentoPersonaRow[]> {
  return prisma.documento_persona.findMany({
    where: { persona_id: personaId, activo: true },
    select: SELECT_PUBLICO,
    orderBy: { id: "asc" },
  });
}

export async function buscarDocumentoPorId(
  id: number,
): Promise<DocumentoPersonaRow | null> {
  return prisma.documento_persona.findUnique({
    where: { id },
    select: SELECT_PUBLICO,
  });
}

export async function crearDocumentoPersona(
  usuarioId: number,
  datos: {
    personaId: number;
    tipoDocumentoId: number;
    numeroDocumento?: string | null;
    rutaArchivo: string;
    observaciones?: string | null;
  },
): Promise<DocumentoPersonaRow> {
  return withUserTransaction(usuarioId, async (client) => {
    const result = await client.query<DocumentoPersonaRow>(
      `INSERT INTO public.documento_persona
         (persona_id, tipo_documento_id, numero_documento, ruta_archivo, observaciones, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, persona_id, tipo_documento_id, numero_documento, ruta_archivo, observaciones, activo`,
      [
        datos.personaId,
        datos.tipoDocumentoId,
        datos.numeroDocumento ?? null,
        datos.rutaArchivo,
        datos.observaciones ?? null,
        usuarioId,
      ],
    );
    return result.rows[0];
  });
}

export async function eliminarDocumentoPersona(
  usuarioId: number,
  id: number,
): Promise<void> {
  await withUserTransaction(usuarioId, async (client) => {
    await client.query(
      `UPDATE public.documento_persona SET activo = false, updated_by = $1 WHERE id = $2`,
      [usuarioId, id],
    );
  });
}
