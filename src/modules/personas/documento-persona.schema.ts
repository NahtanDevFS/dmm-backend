import { z } from "zod";

export const crearDocumentoPersonaSchema = z.object({
  tipoDocumentoId: z.coerce.number().int().positive(),
  numeroDocumento: z.string().trim().max(100).optional(),
  observaciones: z.string().trim().max(2000).optional(),
});
