import { z } from "zod";

/**
 * Paginación uniforme para los listados de negocio.
 *
 * Regla del proyecto, aplicada a propósito y no por omisión:
 *
 * - **Listados de negocio paginados**: personas, insumos, recepciones,
 *   solicitudes, entregas, contratos, usuarios y auditoría. Crecen sin techo con
 *   el uso, así que devuelven siempre el mismo sobre con `total` y `hay_mas`.
 * - **Catálogos de selección sin paginar**: discapacidades, programas, unidades
 *   de medida, marcas, categorías, tipos de… y la geografía. Están acotados por
 *   naturaleza (decenas de filas) y su único consumidor es un `<select>` del
 *   frontend, que necesita la lista completa. Paginarlos solo agregaría fricción.
 *
 * Los reportes tampoco se paginan: se consumen enteros para exportarlos a Excel
 * o PDF, y ya traen su propio sobre con los filtros aplicados.
 */

/** Tope por página. Evita que un `limite=999999` se convierta en un volcado. */
export const LIMITE_MAXIMO = 200;
export const LIMITE_POR_DEFECTO = 50;

/**
 * Fragmento para mezclar en el schema de query de cada listado:
 * `z.object({ ...misFiltros, ...paginacionShape })`.
 */
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

/**
 * Arma el sobre. `hay_mas` se calcula aquí para que el frontend no tenga que
 * repetir la aritmética en cada pantalla.
 */
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

/**
 * Cláusula LIMIT/OFFSET para consultas con `pg`, a partir del número de
 * parámetros ya usados. Devuelve también los valores a concatenar, para que el
 * repositorio no tenga que llevar la cuenta de los `$n` a mano.
 */
export function limitOffset(
  paginacion: Paginacion,
  parametrosUsados: number,
): { clausula: string; valores: number[] } {
  return {
    clausula: `LIMIT $${parametrosUsados + 1} OFFSET $${parametrosUsados + 2}`,
    valores: [paginacion.limite, paginacion.desplazamiento],
  };
}
