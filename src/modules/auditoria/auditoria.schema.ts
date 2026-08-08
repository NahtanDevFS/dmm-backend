import { z } from "zod";
import { paginacionShape } from "../../lib/paginacion.js";

export const listarAuditoriaQuerySchema = z.object({
  tabla: z.string().trim().min(1).max(50).optional(),
  registroId: z.coerce.number().int().positive().optional(),
  usuarioId: z.coerce.number().int().positive().optional(),
  accion: z
    .enum(["INSERT", "UPDATE", "DELETE"], {
      error: "La acción debe ser INSERT, UPDATE o DELETE",
    })
    .optional(),
  desde: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha 'desde' inválida")
    .optional(),
  hasta: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha 'hasta' inválida")
    .optional(),
  // Mismo sobre y mismos topes que el resto de los listados del sistema.
  ...paginacionShape,
});
