import { z } from "zod";
import { paginacionShape } from "../../lib/paginacion.js";

/** Requisitos mínimos de contraseña */
const passwordSchema = z
  .string({ error: "La contraseña es requerida" })
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(72, "La contraseña no puede exceder 72 caracteres") // límite de bcrypt
  .refine((v) => /[a-zA-Z]/.test(v), "La contraseña debe incluir una letra")
  .refine((v) => /\d/.test(v), "La contraseña debe incluir un número");

/** Identificador de acceso, no el nombre de la persona: para eso está`nombre_completo` */
const usernameSchema = z
  .string({ error: "El nombre de usuario es requerido" })
  .trim()
  .min(3, "El nombre de usuario debe tener al menos 3 caracteres")
  .max(50, "El nombre de usuario es demasiado largo")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "El nombre de usuario no admite tildes, ñ, espacios ni otros signos: use letras sin acento, números, punto, guion o guion bajo. El nombre con tildes va en el campo de nombre completo.",
  );

/** El nombre de la persona, que sí se escribe como se escribe */
const nombreCompletoSchema = z
  .string()
  .trim()
  .min(3, "El nombre completo debe tener al menos 3 caracteres")
  .max(150, "El nombre completo es demasiado largo");

/** De qué programa es encargada */
const programaSchema = z.number().int().positive().nullable().optional();

export const crearUsuarioSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  rol_id: z
    .number({ error: "Debe indicar el rol" })
    .int()
    .positive("Debe indicar el rol"),
  nombre_completo: nombreCompletoSchema,
  programa_id: programaSchema,
});

export const editarUsuarioSchema = z.object({
  username: usernameSchema.optional(),
  rol_id: z.number().int().positive().optional(),
  nombre_completo: nombreCompletoSchema.optional(),
  programa_id: programaSchema,
});

/** Cambio de contraseña propio: exige la actual para evitar el secuestro de una sesión abierta */
export const cambiarPasswordPropiaSchema = z.object({
  password_actual: z
    .string({ error: "Debe indicar su contraseña actual" })
    .min(1, "Debe indicar su contraseña actual"),
  password_nueva: passwordSchema,
});

/** Reseteo por administrador: no pide la actual, porque el admin no la conoce */
export const resetearPasswordSchema = z.object({
  password_nueva: passwordSchema,
});

export const listarUsuariosQuerySchema = z.object({
  rolId: z.coerce.number().int().positive().optional(),
  busqueda: z.string().trim().min(1).optional(),
  incluirInactivos: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  ...paginacionShape,
});
