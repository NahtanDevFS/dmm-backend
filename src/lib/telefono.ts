import { z } from "zod";

/** Teléfono guatemalteco */
export const telefonoSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, "").replace(/^\+?502/, ""))
  .refine(
    (v) => /^\d{8}$/.test(v),
    "El teléfono debe tener 8 dígitos (por ejemplo, 5512 3344)",
  );

/** Igual, pero admite vacío: el campo existe y puede quedarse sin llenar */
export const telefonoOpcionalSchema = z
  .union([telefonoSchema, z.literal(""), z.null()])
  .transform((v) => (v === "" ? null : v))
  .optional();
