import { z } from "zod";
import { telefonoSchema, telefonoOpcionalSchema } from "../../lib/telefono.js";
import type { CatalogoSimpleConfig } from "./catalogo-simple.config.js";

const baseShape = {
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es requerido")
    .max(150, "El nombre es demasiado largo"),
};

/** El esquema se arma acumulando el *shape* y creando el objeto una sola vezal final */
export function buildCrearSchema(config: CatalogoSimpleConfig) {
  const shape: Record<string, z.ZodTypeAny> = { ...baseShape };

// `descripcion` solo se acepta si la tabla realmente tiene la columna
  if (config.tieneDescripcion) {
    shape.descripcion = z.string().trim().max(2000).nullable().optional();
  }

  const correoSchema = z.string().trim().max(200).email("Correo inválido");

  /** Deja pasar el campo vacío y lo guarda como null en vez de "" */
  const opcional = <T extends z.ZodTypeAny>(esquema: T) =>
    z
      .union([esquema, z.literal(""), z.null()])
      .transform((v) => (v === "" ? null : v))
      .optional();

  for (const campo of config.camposExtra ?? []) {
    if (campo.tipo === "telefono") {
      shape[campo.nombre] = campo.requerido
        ? telefonoSchema
        : telefonoOpcionalSchema;
    } else if (campo.tipo === "correo") {
      shape[campo.nombre] = campo.requerido
        ? correoSchema
        : opcional(correoSchema);
    } else {
      const base = z.string().trim().max(200);
      shape[campo.nombre] = campo.requerido ? base : opcional(base);
    }
  }

// El shape se arma dinámicamente y el tipo estático se perdería
  return z.object(shape as z.ZodRawShape) as unknown as z.ZodObject<{
    nombre: z.ZodType<string>;
  }> &
    z.ZodType<{ nombre: string } & Record<string, unknown>>;
}

export function buildEditarSchema(config: CatalogoSimpleConfig) {
  return buildCrearSchema(config).partial();
}
