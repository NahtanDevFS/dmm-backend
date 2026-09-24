import { z } from "zod";
import { fechaSchema as fechaCalendario } from "../../lib/fechas.js";

const fechaSchema = fechaCalendario();
import { paginacionShape } from "../../lib/paginacion.js";


/** Igual que fechaSchema, pero con mensaje propio cuando el campo no viene */
const fechaPactadaSchema = fechaCalendario(undefined, {
  error: "Debe indicar la fecha de devolución pactada",
});

/** Un préstamo registrado de una vez: la entrega del equipo y su contrato */
export const crearPrestamoDirectoSchema = z.object({
  persona_id: z.number().int().positive("Debe indicar la persona"),
  insumo_id: z.number().int().positive("Debe indicar el equipo"),
  fecha_devolucion_pactada: fechaSchema,
  observaciones: z.string().trim().max(2000).nullable().optional(),
  /** La unidad concreta que se lleva, cuando el equipo tiene número de serie */
  detalle_inventario_lote_id: z.number().int().positive().nullable().optional(),
});

export const crearContratoSchema = z.object({
// Un contrato nuevo siempre nace de una entrega física
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

/** Cerrar un préstamo que no terminó bien */
export const cerrarContratoSchema = z.object({
  motivo: z.string().trim().min(5, "Explique brevemente el motivo").max(2000),
});

export const listarContratosQuerySchema = z.object({
  estado: z
    .enum(["VIGENTE", "DEVUELTO", "VENCIDO", "EXTENDIDO", "NO_DEVUELTO"], {
      error:
        "El estado debe ser VIGENTE, DEVUELTO, VENCIDO, EXTENDIDO o NO_DEVUELTO",
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
// Si no se envía, se usa el monto_sugerido del tipo de multa
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
