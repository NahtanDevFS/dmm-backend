import { z } from "zod";

/**
 * Cuántas unidades base contiene la presentación, de forma NOMINAL: "una caja
 * son 100 tabletas". Sirve para convertir cuando alguien pide "2 cajas" en una
 * solicitud; el dato real de cada envío vive en
 * detalle_inventario_lote.unidades_por_presentacion_lote y puede diferir.
 *
 * La presentación predeterminada expresa la unidad base, así que su factor
 * tiene que ser 1. Eso se valida en el controlador, donde se sabe si
 * es_default quedó activo.
 */
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
