import { z } from "zod";

const fecha = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida");

const formato = z
  .enum(["json", "xlsx", "pdf"], {
    error: "El formato debe ser json, xlsx o pdf",
  })
  .optional()
  .transform((v) => v ?? "json");

const genero = z
  .enum(["MASCULINO", "FEMENINO", "OTRO", "PREFIERE_NO_DECIR"], {
    error: "El género no es válido",
  })
  .optional();

export const personasAtendidasQuerySchema = z.object({
  desde: fecha.optional(),
  hasta: fecha.optional(),
  comunidadId: z.coerce.number().int().positive().optional(),
  discapacidadId: z.coerce.number().int().positive().optional(),
  programaId: z.coerce.number().int().positive().optional(),
  genero,
  // Rango sobre `edad_a_la_entrega`, que la vista calcula con fn_edad_en_fecha:
  // es la edad que la persona tenía el día de la entrega, no la de hoy.
  edadMin: z.coerce.number().int().min(0).max(120).optional(),
  edadMax: z.coerce.number().int().min(0).max(120).optional(),
  soloAdultoMayor: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  soloConDiscapacidad: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  formato,
});

export const stockPorCategoriaQuerySchema = z.object({
  categoriaId: z.coerce.number().int().positive().optional(),
  soloConUrgentes: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  formato,
});

export const poblacionBeneficiadaQuerySchema = z.object({
  desde: fecha.optional(),
  hasta: fecha.optional(),
  comunidadId: z.coerce.number().int().positive().optional(),
  programaId: z.coerce.number().int().positive().optional(),
  genero,
  grupoEtario: z
    .enum(["MENOR", "ADULTO", "ADULTO_MAYOR"], {
      error: "El grupo etario debe ser MENOR, ADULTO o ADULTO_MAYOR",
    })
    .optional(),
  soloConDiscapacidad: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  formato,
});
