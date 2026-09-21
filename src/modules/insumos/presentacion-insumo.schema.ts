import { z } from "zod";

/** Cuántas unidades base contiene la presentación, de forma NOMINAL: "una caja son 100 tabletas" */
const factorSchema = z
  .number()
  .positive("El factor debe ser mayor que cero")
  .max(1000000, "El factor es demasiado grande");

export const crearPresentacionSchema = z.object({
  unidad_medida_id: z.number().int().positive("unidad_medida_id es requerido"),
  es_default: z.boolean().optional(),
  unidades_por_presentacion: factorSchema.optional(),
});

export const editarPresentacionSchema = z.object({
  unidad_medida_id: z.number().int().positive().optional(),
  es_default: z.boolean().optional(),
  unidades_por_presentacion: factorSchema.optional(),
});
