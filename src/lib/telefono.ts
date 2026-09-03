import { z } from "zod";

/**
 * Teléfono guatemalteco.
 *
 * Son ocho dígitos. Se aceptan espacios, guiones y el prefijo +502 al
 * escribir —así se dictan y así los copian de una libreta— pero se guardan
 * normalizados a los ocho dígitos solos, para que buscar un número no
 * dependa de cómo lo escribió quien lo registró.
 *
 * No se valida el primer dígito (3/4/5 móvil, 2/6/7 fijo): la asignación de
 * rangos cambia con el tiempo y rechazar un número real que ya está en una
 * ficha de papel es peor que aceptar uno improbable.
 */
export const telefonoSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, "").replace(/^\+?502/, ""))
  .refine(
    (v) => /^\d{8}$/.test(v),
    "El teléfono debe tener 8 dígitos (por ejemplo, 5512 3344)",
  );

/** Igual, pero admite vacío: el campo existe y puede quedarse sin llenar. */
export const telefonoOpcionalSchema = z
  .union([telefonoSchema, z.literal(""), z.null()])
  .transform((v) => (v === "" ? null : v))
  .optional();
