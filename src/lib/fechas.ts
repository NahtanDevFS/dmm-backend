import { z } from "zod";

/** true si `valor` es YYYY-MM-DD y el día existe en el calendario. Date.parse no sirve para esto: acepta "2025-02-31" (lo corre al 3 de marzo), "2024-9-01" y hasta "hola 1" */
export function esFechaCalendario(valor: string): boolean {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!partes) return false;
  const [anio, mes, dia] = partes.slice(1).map(Number);
  // Date.UTC normaliza los desbordes (31 de febrero → 3 de marzo): si al
  // volver a leerla no coinciden los componentes, el día no existía
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

/** Fecha de calendario en formato YYYY-MM-DD, el mismo que envían los <input type="date"> del frontend */
export function fechaSchema(
  mensaje = "Fecha inválida: use el formato AAAA-MM-DD con un día que exista",
  opciones?: { error?: string },
) {
  return z.string(opciones).refine(esFechaCalendario, mensaje);
}

/** Para objetos con `desde` y `hasta` opcionales: rechaza el rango invertido. Solo compara si ambas son fechas válidas (si no, ya las reporta su propio campo); con el formato YYYY-MM-DD comparar las cadenas equivale a comparar las fechas */
export function rangoValido(datos: { desde?: string; hasta?: string }): boolean {
  const { desde, hasta } = datos;
  if (!desde || !hasta) return true;
  if (!esFechaCalendario(desde) || !esFechaCalendario(hasta)) return true;
  return desde <= hasta;
}

export const MENSAJE_RANGO_INVERTIDO = {
  message: "La fecha 'desde' no puede ser posterior a 'hasta'",
  path: ["hasta"],
};
