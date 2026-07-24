import { z } from "zod";

export const crearCategoriaInsumoSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es requerido")
    .max(100, "El nombre es demasiado largo"),
  requiere_fecha_caducidad: z.boolean().optional(),
  requiere_codigo_fabricante: z.boolean().optional(),
  bloquea_solicitud_sin_stock: z.boolean().optional(),
});

export const editarCategoriaInsumoSchema = crearCategoriaInsumoSchema.partial();
