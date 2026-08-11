import { z } from "zod";
import type { CatalogoSimpleConfig } from "./catalogo-simple.config.js";

const baseShape = {
  nombre: z
    .string()
    .trim()
    .min(1, "El nombre es requerido")
    .max(150, "El nombre es demasiado largo"),
};

export function buildCrearSchema(config: CatalogoSimpleConfig) {
  let schema = z.object(baseShape);

  // `descripcion` solo se acepta si la tabla realmente tiene la columna.
  if (config.tieneDescripcion) {
    schema = schema.extend({
      descripcion: z.string().trim().max(2000).nullable().optional(),
    }) as typeof schema;
  }

  for (const campo of config.camposExtra ?? []) {
    const base = z.string().trim().max(200);
    schema = schema.extend({
      [campo.nombre]: campo.requerido ? base : base.nullable().optional(),
    }) as typeof schema;
  }

  return schema;
}

export function buildEditarSchema(config: CatalogoSimpleConfig) {
  return buildCrearSchema(config).partial();
}
