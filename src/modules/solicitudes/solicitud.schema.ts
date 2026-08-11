import { z } from "zod";
import { paginacionShape } from "../../lib/paginacion.js";

const fechaSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida");

const lineaSchema = z.object({
  insumo_id: z.number().int().positive("insumo_id es requerido"),
  cantidad_requerida: z
    .number()
    .int()
    .positive("La cantidad requerida debe ser mayor que cero"),
});

export const crearSolicitudSchema = z.object({
  persona_id: z.number().int().positive("persona_id es requerido"),
  programa_id: z.number().int().positive("programa_id es requerido"),
  // La BD tiene CHECK fecha_solicitud <= CURRENT_DATE y default CURRENT_DATE.
  fecha_solicitud: fechaSchema.optional(),
  requiere_aprobacion: z.boolean().optional(),
  observaciones_trabajo_social: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional(),
  lineas: z
    .array(lineaSchema)
    .min(1, "La solicitud debe incluir al menos un insumo"),
});

export const editarSolicitudSchema = z.object({
  programa_id: z.number().int().positive().optional(),
  requiere_aprobacion: z.boolean().optional(),
  observaciones_trabajo_social: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional(),
});

export const agregarLineaSchema = lineaSchema;

export const editarLineaSchema = z.object({
  cantidad_requerida: z
    .number()
    .int()
    .positive("La cantidad requerida debe ser mayor que cero")
    .optional(),
  receta_medica_id: z.number().int().positive().nullable().optional(),
});

export const motivoSchema = z.object({
  motivo: z.string().trim().max(500).optional(),
});

export const rechazarSchema = z.object({
  motivo: z
    .string({ error: "Debe indicar el motivo del rechazo" })
    .trim()
    .min(1, "Debe indicar el motivo del rechazo")
    .max(500),
});

export const listarSolicitudesQuerySchema = z.object({
  personaId: z.coerce.number().int().positive().optional(),
  programaId: z.coerce.number().int().positive().optional(),
  estadoLinea: z
    .enum(
      [
        "PENDIENTE_ADQUISICION",
        "PENDIENTE_ENTREGA",
        "PENDIENTE_ENTREGA_PARCIAL",
        "APROBADA",
        "RECHAZADA",
        "ENTREGADA",
        "CANCELADA",
      ],
      { error: "El estado indicado no es válido" },
    )
    .optional(),
  soloPendientesAprobacion: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  ...paginacionShape,
});

export const crearRecetaSchema = z.object({
  fecha_emision: fechaSchema.optional(),
  observaciones: z.string().trim().max(2000).optional(),
});
