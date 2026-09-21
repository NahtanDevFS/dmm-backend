import { z } from "zod";

/** Paginación uniforme para los listados de negocio */

/** Tope por página */
export const LIMITE_MAXIMO = 200;
export const LIMITE_POR_DEFECTO = 50;

/** Fragmento para mezclar en el schema de query de cada listado:`z */
export const paginacionShape = {
  limite: z.coerce
    .number()
    .int()
    .min(1, "El límite debe ser al menos 1")
    .max(LIMITE_MAXIMO, `El límite máximo es ${LIMITE_MAXIMO}`)
    .optional()
    .transform((v) => v ?? LIMITE_POR_DEFECTO),
  desplazamiento: z.coerce
    .number()
    .int()
    .min(0, "El desplazamiento no puede ser negativo")
    .optional()
    .transform((v) => v ?? 0),
};

export interface Paginacion {
  limite: number;
  desplazamiento: number;
}

export interface RespuestaPaginada<T> {
  total: number;
  limite: number;
  desplazamiento: number;
  hay_mas: boolean;
  datos: T[];
}

/** Arma el sobre */
export function paginar<T>(
  filas: T[],
  total: number,
  paginacion: Paginacion,
): RespuestaPaginada<T> {
  return {
    total,
    limite: paginacion.limite,
    desplazamiento: paginacion.desplazamiento,
    hay_mas: paginacion.desplazamiento + filas.length < total,
    datos: filas,
  };
}

/** Cláusula LIMIT/OFFSET para consultas con `pg`, a partir del número deparámetros ya usados */
export function limitOffset(
  paginacion: Paginacion,
  parametrosUsados: number,
): { clausula: string; valores: number[] } {
  return {
    clausula: `LIMIT $${parametrosUsados + 1} OFFSET $${parametrosUsados + 2}`,
    valores: [paginacion.limite, paginacion.desplazamiento],
  };
}
