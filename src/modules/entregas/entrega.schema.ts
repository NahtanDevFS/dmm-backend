import { z } from "zod";
import { paginacionShape } from "../../lib/paginacion.js";

/**
 * Un insumo dentro de una entrega. `detalle_solicitud_id` con valor significa
 * que este renglón despacha una línea de solicitud; en null, que es entrega
 * directa de medicina o comida.
 */
export const renglonEntregaSchema = z.object({
  insumo_id: z.number().int().positive("insumo_id es requerido"),
  cantidad: z
    .number()
    .int()
    .positive("La cantidad a entregar debe ser mayor que cero"),
  detalle_solicitud_id: z.number().int().positive().nullable().optional(),
});

export const registrarEntregaSchema = z
  .object({
    persona_id: z.number().int().positive("persona_id es requerido"),
    insumos: z
      .array(renglonEntregaSchema)
      .min(1, "Debe indicar al menos un insumo")
      .max(20, "Demasiados insumos en una sola entrega"),
    // Receptor distinto al beneficiario (RF-ENT-05).
    persona_receptor_id: z.number().int().positive().nullable().optional(),
    tipo_parentesco_receptor_id: z
      .number()
      .int()
      .positive()
      .nullable()
      .optional(),
    observaciones: z.string().trim().max(2000).nullable().optional(),
  })
  .refine(
    (d) =>
      d.persona_receptor_id == null || d.tipo_parentesco_receptor_id != null,
    {
      message:
        "Si la entrega la recibe un tercero, debe indicar el parentesco con el beneficiario",
      path: ["tipo_parentesco_receptor_id"],
    },
  )
  .refine(
    (d) => new Set(d.insumos.map((i) => i.insumo_id)).size === d.insumos.length,
    {
      message:
        "Un mismo insumo no puede repetirse en la entrega: sume las cantidades en un solo renglón",
      path: ["insumos"],
    },
  )
  .refine(
    // Regla de origen único: o todos los renglones despachan una solicitud, o
    // ninguno. Se valida también en la base; aquí se adelanta el mensaje para
    // no gastar una transacción en algo que ya se sabe mal.
    (d) =>
      d.insumos.every((i) => i.detalle_solicitud_id == null) ||
      d.insumos.every((i) => i.detalle_solicitud_id != null),
    {
      message:
        "Una entrega no puede mezclar insumos de una solicitud con insumos de entrega directa. Regístrelas por separado",
      path: ["insumos"],
    },
  );

/** Mismo cuerpo para anular una entrega completa o un solo renglón. */
export const anularEntregaSchema = z.object({
  motivo: z
    .string({ error: "Debe indicar el motivo de la anulación" })
    .trim()
    .min(1, "Debe indicar el motivo de la anulación")
    .max(500),
});

export const listarEntregasQuerySchema = z.object({
  personaId: z.coerce.number().int().positive().optional(),
  insumoId: z.coerce.number().int().positive().optional(),
  desde: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha 'desde' inválida")
    .optional(),
  hasta: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha 'hasta' inválida")
    .optional(),
  incluirAnuladas: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  ...paginacionShape,
});

export const crearEvidenciaSchema = z.object({
  tipo_evidencia_id: z.coerce
    .number({ error: "tipo_evidencia_id es requerido" })
    .int()
    .positive("tipo_evidencia_id es requerido"),
  observaciones: z.string().trim().max(2000).optional(),
});

export const fifoQuerySchema = z.object({
  insumoId: z.coerce
    .number({ error: "Debe indicar el insumo (insumoId)" })
    .int()
    .positive("Debe indicar el insumo (insumoId)"),
});
