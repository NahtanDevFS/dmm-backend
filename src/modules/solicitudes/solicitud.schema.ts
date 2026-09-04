import { z } from "zod";
import { paginacionShape } from "../../lib/paginacion.js";

const fechaSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida");

const lineaSchema = z
  .object({
    insumo_id: z.number().int().positive("insumo_id es requerido"),
    /**
     * En unidad base. Opcional si se pide por presentación: en ese caso el
     * backend la calcula, para que el número guardado no dependa de que el
     * cliente haya multiplicado bien.
     */
    cantidad_requerida: z
      .number()
      .int()
      .positive("La cantidad requerida debe ser mayor que cero")
      .optional(),
    /** Cómo se expresó el pedido: "2 cajas". Ambas o ninguna. */
    presentacion_solicitud_id: z.number().int().positive().optional(),
    cantidad_presentacion: z
      .number()
      .positive("La cantidad debe ser mayor que cero")
      .optional(),
    /**
     * Bajo qué figura se entrega este insumo: donación definitiva o préstamo.
     * Decide qué formularios se exigen, y no se puede cambiar después — la
     * base lo impide con un trigger. Si la figura cambia, es otra solicitud.
     */
    modalidad_solicitud_id: z
      .number()
      .int()
      .positive("Debe indicar la modalidad (donación o préstamo)"),
  })
  .refine(
    (d) =>
      (d.presentacion_solicitud_id == null) ===
      (d.cantidad_presentacion == null),
    {
      message:
        "Indique la presentación y su cantidad juntas, o ninguna de las dos",
      path: ["cantidad_presentacion"],
    },
  )
  .refine(
    (d) => d.cantidad_requerida != null || d.presentacion_solicitud_id != null,
    {
      message: "Indique la cantidad, en unidad base o por presentación",
      path: ["cantidad_requerida"],
    },
  );

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

/**
 * Documento del legajo. `formulario_id` es opcional a propósito: no todo lo
 * que se adjunta es uno de los formularios.
 */
export const crearDocumentoSolicitudSchema = z.object({
  formulario_id: z.coerce.number().int().positive().optional(),
  descripcion: z.string().trim().max(255).optional(),
  observaciones: z.string().trim().max(2000).optional(),
});

export const crearRecetaSchema = z.object({
  fecha_emision: fechaSchema.optional(),
  observaciones: z.string().trim().max(2000).optional(),
});
