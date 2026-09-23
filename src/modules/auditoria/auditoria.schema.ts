import { z } from "zod";
import { fechaSchema, rangoValido, MENSAJE_RANGO_INVERTIDO } from "../../lib/fechas.js";
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
  desde: fechaSchema("Fecha 'desde' inválida: use el formato AAAA-MM-DD").optional(),
  hasta: fechaSchema("Fecha 'hasta' inválida: use el formato AAAA-MM-DD").optional(),
// Mismo sobre y mismos topes que el resto de los listados del sistema
  ...paginacionShape,
}).refine(rangoValido, MENSAJE_RANGO_INVERTIDO);
