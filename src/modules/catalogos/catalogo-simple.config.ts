export interface CatalogoSimpleConfig {
  slug: string;
  prismaModel:
    | "discapacidad"
    | "programa"
    | "institucion_donante"
    | "categoria_insumo";
  tableName: string;
  /**
   * No todas las tablas de catálogo tienen columna `descripcion`: hoy solo
   * `programa` la tiene. Cuando es `false` la columna se omite del select,
   * del insert, del update y del schema de validación — antes se asumía
   * presente en todos y rompía con `no existe la columna «descripcion»`.
   */
  tieneDescripcion: boolean;
  dependencia: {
    tablaDependiente: string;
    columnaFk: string;
    mensajeBloqueo: string;
  } | null;
  camposExtra?: Array<{
    nombre: string;
    tipo: "string";
    requerido: boolean;
  }>;
}

export const CATALOGOS_SIMPLES: Record<string, CatalogoSimpleConfig> = {
  discapacidades: {
    slug: "discapacidades",
    prismaModel: "discapacidad",
    tableName: "discapacidad",
    tieneDescripcion: false,
    dependencia: {
      tablaDependiente: "persona_discapacidad",
      columnaFk: "discapacidad_id",
      mensajeBloqueo:
        "No se puede desactivar: hay personas activas registradas con esta discapacidad.",
    },
  },
  programas: {
    slug: "programas",
    prismaModel: "programa",
    tableName: "programa",
    tieneDescripcion: true,
    dependencia: {
      tablaDependiente: "solicitud_apoyo",
      columnaFk: "programa_id",
      mensajeBloqueo:
        "No se puede desactivar: existen solicitudes de apoyo activas asociadas a este programa.",
    },
  },
  // Antes era un módulo a medida por sus 3 flags booleanos. El esquema v3 los
  // movió a `insumo` (los leen fn_calcular_recepcion_lote y
  // fn_validar_stock_linea_solicitud), así que la tabla quedó como un catálogo
  // simple más y encaja en este molde.
  "categorias-insumo": {
    slug: "categorias-insumo",
    prismaModel: "categoria_insumo",
    tableName: "categoria_insumo",
    tieneDescripcion: false,
    dependencia: {
      tablaDependiente: "insumo",
      columnaFk: "categoria_id",
      mensajeBloqueo:
        "No se puede desactivar: existen insumos activos asignados a esta categoría.",
    },
  },
  "instituciones-donantes": {
    slug: "instituciones-donantes",
    prismaModel: "institucion_donante",
    tableName: "institucion_donante",
    tieneDescripcion: false,
    dependencia: {
      tablaDependiente: "recepcion_donacion_lote",
      columnaFk: "institucion_id",
      mensajeBloqueo:
        "No se puede desactivar: existen recepciones de donación activas registradas para esta institución.",
    },
    camposExtra: [
      { nombre: "telefono", tipo: "string", requerido: false },
      { nombre: "correo", tipo: "string", requerido: false },
    ],
  },
};
