/** Escapa los comodines de LIKE/ILIKE para que la búsqueda sea literal: sin esto, buscar "_" devolvía todos los registros y "50%" cualquier texto que empezara por 50. Se usa la barra invertida, que es el carácter de escape por defecto de PostgreSQL, así que no hace falta cláusula ESCAPE */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, "\\$&");
}

/** Patrón que encuentra `texto` literal en cualquier posición */
export function patronContiene(texto: string): string {
  return `%${escaparLike(texto)}%`;
}
