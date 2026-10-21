/*
 * Categorías de insumo cuya entrega exige receta médica.
 *
 * Va en configuración y no en una columna mientras no se quiera tocar la base.
 * Se identifica por id y no por nombre: los nombres de categoría se pueden
 * editar desde Catálogos, el id no. «Medicamentos» es el id 1 tanto en
 * desarrollo como en producción, por eso es el valor por omisión; si hiciera
 * falta otra categoría, se agrega en el .env separada por coma:
 *
 *     CATEGORIAS_CON_RECETA=1,7
 *
 * Cuando se decida llevarlo a la base (una casilla «Requiere receta» por
 * insumo o categoría), basta con reemplazar requiereReceta y la expresión SQL
 * de abajo; quien los usa no cambia.
 */
export const CATEGORIAS_CON_RECETA: number[] = (
  process.env.CATEGORIAS_CON_RECETA ?? "1"
)
  .split(",")
  .map((parte) => Number(parte.trim()))
  .filter((id) => Number.isInteger(id) && id > 0);

export function requiereReceta(categoriaId: number | null | undefined): boolean {
  return categoriaId != null && CATEGORIAS_CON_RECETA.includes(categoriaId);
}

/** Nombre del tipo de evidencia de la receta. Es un catálogo de sistema: el
 *  código lo compara por nombre y no se edita desde Catálogos. */
export const TIPO_EVIDENCIA_RECETA = "RECETA_MEDICA";
