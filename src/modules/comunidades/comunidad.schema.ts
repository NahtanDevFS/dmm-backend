import { z } from "zod";

export const crearComunidadSchema = z.object({
  municipio_id: z.number().int().positive("municipio_id es requerido"),
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es requerido")
    .max(100, "El nombre es demasiado largo"),
  ubicacion: z.string().trim().max(255).nullable().optional(),
});

export const editarComunidadSchema = crearComunidadSchema.partial();
