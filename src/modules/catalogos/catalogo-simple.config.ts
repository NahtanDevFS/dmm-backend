export interface DependenciaCatalogo {
  tablaDependiente: string;
  columnaFk: string;
  mensajeBloqueo: string;
}

export interface CatalogoSimpleConfig {
  slug: string;
  prismaModel:
    | "discapacidad"
    | "programa"
    | "institucion_donante"
    | "categoria_insumo"
    | "marca_insumo"
    | "unidad_medida";
  tableName: string;
  /**
   * No todas las tablas de catálogo tienen columna `descripcion`: hoy solo
   * `programa` la tiene. Cuando es `false` la columna se omite del select,
   * del insert, del update y del schema de validación — antes se asumía
   * presente en todos y rompía con `no existe la columna «descripcion»`.
   */
  tieneDescripcion: boolean;
  /**
   * Tablas que impiden desactivar el registro si tienen filas activas
   * apuntándolo (RF-CAT-03). Se evalúan en orden y gana el primer bloqueo,
   * así que conviene poner primero la dependencia más explicativa para el
   * usuario. Lista vacía = nada bloquea la desactivación.
   */
  dependencias: DependenciaCatalogo[];
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
    dependencias: [
      {
        tablaDependiente: "persona_discapacidad",
        columnaFk: "discapacidad_id",
        mensajeBloqueo:
          "No se puede desactivar: hay personas activas registradas con esta discapacidad.",
      },
    ],
  },
  programas: {
    slug: "programas",
    prismaModel: "programa",
    tableName: "programa",
    tieneDescripcion: true,
    dependencias: [
      {
        tablaDependiente: "solicitud_apoyo",
        columnaFk: "programa_id",
        mensajeBloqueo:
          "No se puede desactivar: existen solicitudes de apoyo activas asociadas a este programa.",
      },
    ],
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
    dependencias: [
      {
        tablaDependiente: "insumo",
        columnaFk: "categoria_id",
        mensajeBloqueo:
          "No se puede desactivar: existen insumos activos asignados a esta categoría.",
      },
    ],
  },
  // Tabla nueva del esquema v3. La marca se declara por lote recibido, no por
  // insumo: la FK vive en detalle_inventario_lote.marca_id.
  "marcas-insumo": {
    slug: "marcas-insumo",
    prismaModel: "marca_insumo",
    tableName: "marca_insumo",
    tieneDescripcion: false,
    dependencias: [
      {
        tablaDependiente: "detalle_inventario_lote",
        columnaFk: "marca_id",
        mensajeBloqueo:
          "No se puede desactivar: existen lotes de inventario activos registrados con esta marca.",
      },
    ],
  },
  // Dos dependencias: la unidad puede estar en uso como unidad base de un
  // insumo o como unidad de una de sus presentaciones.
  "unidades-medida": {
    slug: "unidades-medida",
    prismaModel: "unidad_medida",
    tableName: "unidad_medida",
    tieneDescripcion: false,
    dependencias: [
      {
        tablaDependiente: "insumo",
        columnaFk: "unidad_medida_base_id",
        mensajeBloqueo:
          "No se puede desactivar: existen insumos activos que la usan como unidad de medida base.",
      },
      {
        tablaDependiente: "presentacion_insumo",
        columnaFk: "unidad_medida_id",
        mensajeBloqueo:
          "No se puede desactivar: existen presentaciones de insumo activas que usan esta unidad de medida.",
      },
    ],
  },
  "instituciones-donantes": {
    slug: "instituciones-donantes",
    prismaModel: "institucion_donante",
    tableName: "institucion_donante",
    tieneDescripcion: false,
    dependencias: [
      {
        tablaDependiente: "recepcion_donacion_lote",
        columnaFk: "institucion_id",
        mensajeBloqueo:
          "No se puede desactivar: existen recepciones de donación activas registradas para esta institución.",
      },
    ],
    camposExtra: [
      { nombre: "telefono", tipo: "string", requerido: false },
      { nombre: "correo", tipo: "string", requerido: false },
    ],
  },
};
