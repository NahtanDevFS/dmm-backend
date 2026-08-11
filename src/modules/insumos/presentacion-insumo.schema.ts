import { z } from "zod";

export const crearPresentacionSchema = z.object({
  unidad_medida_id: z
    .number()
    .int()
    .positive("unidad_medida_id es requerido"),
  es_default: z.boolean().optional(),
});

export const editarPresentacionSchema = z.object({
  unidad_medida_id: z.number().int().positive().optional(),
  es_default: z.boolean().optional(),
});
