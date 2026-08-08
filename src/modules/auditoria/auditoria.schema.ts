import { z } from "zod";

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
  // La tabla ya pasa de 1900 filas y solo crece: la paginación no es opcional.
  limite: z.coerce
    .number()
    .int()
    .min(1, "El límite debe ser al menos 1")
    .max(200, "El límite máximo es 200")
    .optional()
    .transform((v) => v ?? 50),
  desplazamiento: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .transform((v) => v ?? 0),
});
