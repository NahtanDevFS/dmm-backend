import { z } from "zod";
import { paginacionShape } from "../../lib/paginacion.js";

const fechaSchema = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida");

/** Igual que fechaSchema, pero con mensaje propio cuando el campo no viene. */
const fechaPactadaSchema = z
  .string({ error: "Debe indicar la fecha de devolución pactada" })
  .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida");

export const crearContratoSchema = z.object({
  // Un contrato nuevo siempre nace de una entrega física. Las renovaciones se
  // crean por POST /:id/renovar, porque el CHECK contrato_origen_check exige
  // exactamente uno de detalle_entrega_id / contrato_anterior_id.
  detalle_entrega_id: z
    .number({ error: "Debe indicar el renglón de entrega prestado" })
    .int()
    .positive("Debe indicar el renglón de entrega prestado"),
  fecha_devolucion_pactada: fechaPactadaSchema,
  fecha_inicio: fechaSchema.optional(),
});

export const renovarContratoSchema = z.object({
  fecha_devolucion_pactada: fechaPactadaSchema,
});

export const editarContratoSchema = z.object({
  fecha_devolucion_pactada: fechaSchema.optional(),
});

export const listarContratosQuerySchema = z.object({
  estado: z
    .enum(["VIGENTE", "DEVUELTO", "VENCIDO", "EXTENDIDO"], {
      error: "El estado debe ser VIGENTE, DEVUELTO, VENCIDO o EXTENDIDO",
    })
    .optional(),
  personaId: z.coerce.number().int().positive().optional(),
  incluirInactivos: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  ...paginacionShape,
});

export const aplicarMultaSchema = z.object({
  tipo_multa_id: z
    .number({ error: "Debe indicar el tipo de multa" })
    .int()
    .positive("Debe indicar el tipo de multa"),
  // Si no se envía, se usa el monto_sugerido del tipo de multa.
  monto: z.number().min(0, "El monto no puede ser negativo").optional(),
  motivo: z.string().trim().max(2000).nullable().optional(),
  fecha_aplicacion: fechaSchema.optional(),
});

export const editarMultaSchema = z.object({
  monto: z.number().min(0, "El monto no puede ser negativo").optional(),
  motivo: z.string().trim().max(2000).nullable().optional(),
});

export const pagarMultaSchema = z.object({
  fecha_pago: fechaSchema.optional(),
});

export const crearEvidenciaContratoSchema = z.object({
  tipo_evidencia_id: z.coerce
    .number({ error: "tipo_evidencia_id es requerido" })
    .int()
    .positive("tipo_evidencia_id es requerido"),
  observaciones: z.string().trim().max(2000).optional(),
});
