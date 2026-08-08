import { z } from "zod";
import { paginacionShape } from "../../lib/paginacion.js";

/**
 * Requisitos mínimos de contraseña. No los impone la base de datos (guarda un
 * hash, no puede juzgar la fuerza del original) y hasta ahora los usuarios se
 * creaban por SQL directo sin ninguna validación, así que es aquí donde toca.
 *
 * 8 caracteres con al menos una letra y un dígito: suficiente para descartar
 * "admin" o "123456" sin volver el alta impracticable para la DMM.
 */
const passwordSchema = z
  .string({ error: "La contraseña es requerida" })
  .min(8, "La contraseña debe tener al menos 8 caracteres")
  .max(72, "La contraseña no puede exceder 72 caracteres") // límite de bcrypt
  .refine((v) => /[a-zA-Z]/.test(v), "La contraseña debe incluir una letra")
  .refine((v) => /\d/.test(v), "La contraseña debe incluir un número");

const usernameSchema = z
  .string({ error: "El nombre de usuario es requerido" })
  .trim()
  .min(3, "El nombre de usuario debe tener al menos 3 caracteres")
  .max(50, "El nombre de usuario es demasiado largo")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "El nombre de usuario solo admite letras, números, punto, guion y guion bajo",
  );

export const crearUsuarioSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  rol_id: z
    .number({ error: "Debe indicar el rol" })
    .int()
    .positive("Debe indicar el rol"),
});

export const editarUsuarioSchema = z.object({
  username: usernameSchema.optional(),
  rol_id: z.number().int().positive().optional(),
});

/** Cambio de contraseña propio: exige la actual para evitar el secuestro de una sesión abierta. */
export const cambiarPasswordPropiaSchema = z.object({
  password_actual: z
    .string({ error: "Debe indicar su contraseña actual" })
    .min(1, "Debe indicar su contraseña actual"),
  password_nueva: passwordSchema,
});

/** Reseteo por administrador: no pide la actual, porque el admin no la conoce. */
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
