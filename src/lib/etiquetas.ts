/**
 * Texto legible de los valores de catálogo que la base guarda como
 * identificador (FEMENINO, ADULTO_MAYOR), para los archivos que genera el
 * backend: las exportaciones a Excel y PDF.
 *
 * La API en JSON los sigue devolviendo tal cual, porque los filtros y las
 * funciones SQL comparan con el identificador; en pantalla los traduce el
 * frontend (dmm-frontend/src/lib/etiquetas.ts). Si se agrega o cambia una
 * etiqueta aquí, cámbiela también allá para que la pantalla y el archivo
 * digan lo mismo.
 */
const ETIQUETAS: Record<string, string> = {
  // género
  MASCULINO: "Masculino",
  FEMENINO: "Femenino",
  OTRO: "Otro",
  PREFIERE_NO_DECIR: "Prefiere no decir",
  // grupo etario
  MENOR: "Menor de edad",
  ADULTO: "Adulto",
  ADULTO_MAYOR: "Adulto mayor",
  // parentesco
  MADRE: "Madre",
  PADRE: "Padre",
  HIJO_A: "Hijo(a)",
  HERMANO_A: "Hermano(a)",
  ABUELO_A: "Abuelo(a)",
  TIO_A: "Tío(a)",
  CONYUGE: "Cónyuge",
  // estados de solicitud
  PENDIENTE_ADQUISICION: "Pendiente de adquisición",
  PENDIENTE_ENTREGA: "Pendiente de entrega",
  PENDIENTE_ENTREGA_PARCIAL: "Pendiente de entrega (parcial)",
  APROBADA: "Aprobada",
  RECHAZADA: "Rechazada",
  ENTREGADA: "Entregada",
  CANCELADA: "Cancelada",
  // estados de contrato de préstamo
  VIGENTE: "Vigente",
  DEVUELTO: "Devuelto",
  VENCIDO: "Vencido",
  EXTENDIDO: "Extendido (renovado)",
  NO_DEVUELTO: "No devuelto",
  // modalidad de solicitud
  DONACION: "Donación",
  PRESTAMO: "Préstamo",
};

const IDENTIFICADOR = /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/;

export function etiquetaDe(valor: string): string {
  const conocida = ETIQUETAS[valor];
  if (conocida) return conocida;
  // Un identificador nuevo que nadie agregó al mapa se vuelve legible igual
  if (IDENTIFICADOR.test(valor)) {
    const texto = valor.replace(/_A$/, "(A)").replace(/_/g, " ").toLowerCase();
    return texto.charAt(0).toUpperCase() + texto.slice(1);
  }
  return valor;
}

/** Columnas de reporte que traen un identificador de catálogo. Los nombres de personas o comunidades no se tocan. */
export function esColumnaDeCatalogo(campo: string): boolean {
  return /genero|grupo_etario|parentesco|estado|modalidad|rol/i.test(campo);
}
