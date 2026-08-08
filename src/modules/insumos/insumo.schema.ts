import { z } from "zod";

export const crearInsumoSchema = z.object({
  categoria_id: z.number().int().positive("categoria_id es requerido"),
  unidad_medida_base_id: z
    .number()
    .int()
    .positive("unidad_medida_base_id es requerido"),
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es requerido")
    .max(150, "El nombre es demasiado largo"),
  descripcion: z.string().trim().max(2000).nullable().optional(),
  // Los tres flags viven en `insumo` desde el esquema v3: los leen
  // fn_calcular_recepcion_lote (caducidad y código de fabricante) y
  // fn_validar_stock_linea_solicitud (bloqueo sin stock).
  requiere_fecha_caducidad: z.boolean().optional(),
  requiere_codigo_fabricante: z.boolean().optional(),
  bloquea_solicitud_sin_stock: z.boolean().optional(),
});

export const editarInsumoSchema = crearInsumoSchema.partial();

export const listarInsumosQuerySchema = z.object({
  categoriaId: z.coerce.number().int().positive().optional(),
  busqueda: z.string().trim().min(1).optional(),
  incluirInactivos: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});
