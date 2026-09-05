import { z } from "zod";
import { paginacionShape } from "../../lib/paginacion.js";

const fechaSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida");

export const crearRecepcionSchema = z.object({
  institucion_id: z.number().int().positive("institucion_id es requerido"),
  codigo_lote: z.string().trim().max(50).nullable().optional(),
  // La BD tiene CHECK fecha_recepcion <= CURRENT_DATE y default CURRENT_DATE.
  fecha_recepcion: fechaSchema.optional(),
  observaciones_generales: z.string().trim().max(2000).nullable().optional(),
});

export const editarRecepcionSchema = crearRecepcionSchema.partial();

export const listarRecepcionesQuerySchema = z.object({
  institucionId: z.coerce.number().int().positive().optional(),
  incluirInactivas: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  ...paginacionShape,
});

/**
 * Renglón de inventario. No incluye `cantidad_inicial` ni
 * `cantidad_disponible`: las calcula el trigger trg_calcular_recepcion_lote
 * como FLOOR(cantidad_recepcion_original * unidades_por_presentacion_lote).
 */
/**
 * Ingreso de unidades identificables: una fila por número de serie.
 *
 * No pide cantidad —la da la lista de series— ni unidades por presentación:
 * cada unidad es una. Pedir la cantidad además de las series permitiría que
 * se contradijeran.
 */
export const crearUnidadesSchema = z.object({
  insumo_id: z.number().int().positive("insumo_id es requerido"),
  presentacion_recepcion_id: z
    .number()
    .int()
    .positive("presentacion_recepcion_id es requerido"),
  marca_id: z.number().int().positive().nullable().optional(),
  fecha_caducidad: fechaSchema.nullable().optional(),
  observaciones: z.string().trim().max(2000).nullable().optional(),
  series: z
    .array(
      z.string().trim().min(1, "El número de serie no puede ir vacío").max(50),
    )
    .min(1, "Indique al menos un número de serie")
    .max(200, "Demasiadas unidades en un solo ingreso")
    .refine(
      (lista) =>
        new Set(lista.map((s) => s.trim().toUpperCase())).size === lista.length,
      "Hay números de serie repetidos en la lista",
    ),
});

export const crearLoteSchema = z.object({
  insumo_id: z.number().int().positive("insumo_id es requerido"),
  presentacion_recepcion_id: z
    .number()
    .int()
    .positive("presentacion_recepcion_id es requerido"),
  cantidad_recepcion_original: z
    .number()
    .positive("La cantidad recibida debe ser mayor que cero"),
  unidades_por_presentacion_lote: z
    .number()
    .positive("Las unidades por presentación deben ser mayores que cero"),
  marca_id: z.number().int().positive().nullable().optional(),
  codigo_lote_fabricante: z.string().trim().max(100).nullable().optional(),
  fecha_caducidad: fechaSchema.nullable().optional(),
  observaciones: z.string().trim().max(2000).nullable().optional(),
});

export const darBajaLoteSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(1, "Debe indicar el motivo de la baja")
    .max(500),
});

export const semaforoQuerySchema = z.object({
  insumoId: z.coerce.number().int().positive().optional(),
  semaforo: z
    .enum(["VENCIDO", "ROJO", "AMARILLO", "VERDE", "GRIS"], {
      error: "El semáforo debe ser VENCIDO, ROJO, AMARILLO, VERDE o GRIS",
    })
    .optional(),
});

export const crearDocumentoRecepcionSchema = z.object({
  descripcion: z.string().trim().max(255).optional(),
});
