import type { Rol } from "../../config/roles.js";
import { LECTURA_CATALOGOS_REPORTE, OPERACION } from "../../config/roles.js";

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
    | "unidad_medida"
    | "grado_academico"
    | "ocupacion";
  tableName: string;
  /** No todas las tablas de catálogo tienen columna `descripcion`: hoy solo `programa` la tiene */
  tieneDescripcion: boolean;
  /** Quien puede LEER el catalogo */
  rolesLectura: Rol[];
  /** Tablas que impiden desactivar el registro si tienen filas activas apuntándolo (RF-CAT-03) */
  dependencias: DependenciaCatalogo[];
  camposExtra?: Array<{
    nombre: string;
    /** "telefono" y "correo" no son solo texto libre: se validan con su formato */
    tipo: "string" | "telefono" | "correo";
    requerido: boolean;
  }>;
}

export const CATALOGOS_SIMPLES: Record<string, CatalogoSimpleConfig> = {
  /** Escolaridad y ocupación son administrables a propósito: ningún código seramifica sobre sus valores, son etiquetas descriptivas del estudiosocioeconómico */
  "grados-academicos": {
    slug: "grados-academicos",
    prismaModel: "grado_academico",
    tableName: "grado_academico",
    tieneDescripcion: false,
    rolesLectura: OPERACION,
    dependencias: [
      {
        tablaDependiente: "persona",
        columnaFk: "grado_academico_id",
        mensajeBloqueo:
          "No se puede desactivar: hay personas activas registradas con este grado académico.",
      },
    ],
  },
  ocupaciones: {
    slug: "ocupaciones",
    prismaModel: "ocupacion",
    tableName: "ocupacion",
    tieneDescripcion: false,
    rolesLectura: OPERACION,
    dependencias: [
      {
        tablaDependiente: "persona",
        columnaFk: "ocupacion_id",
        mensajeBloqueo:
          "No se puede desactivar: hay personas activas registradas con esta ocupación.",
      },
    ],
  },
  discapacidades: {
    slug: "discapacidades",
    prismaModel: "discapacidad",
    tableName: "discapacidad",
    tieneDescripcion: false,
    rolesLectura: LECTURA_CATALOGOS_REPORTE,
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
    rolesLectura: LECTURA_CATALOGOS_REPORTE,
    dependencias: [
      {
        tablaDependiente: "solicitud_apoyo",
        columnaFk: "programa_id",
        mensajeBloqueo:
          "No se puede desactivar: existen solicitudes de apoyo activas asociadas a este programa.",
      },
    ],
  },
// Antes era un módulo a medida por sus 3 flags booleanos
  "categorias-insumo": {
    slug: "categorias-insumo",
    prismaModel: "categoria_insumo",
    tableName: "categoria_insumo",
    tieneDescripcion: false,
    rolesLectura: LECTURA_CATALOGOS_REPORTE,
    dependencias: [
      {
        tablaDependiente: "insumo",
        columnaFk: "categoria_id",
        mensajeBloqueo:
          "No se puede desactivar: existen insumos activos asignados a esta categoría.",
      },
    ],
  },
// Tabla nueva del esquema
  "marcas-insumo": {
    slug: "marcas-insumo",
    prismaModel: "marca_insumo",
    tableName: "marca_insumo",
    tieneDescripcion: false,
    rolesLectura: OPERACION,
    dependencias: [
      {
        tablaDependiente: "detalle_inventario_lote",
        columnaFk: "marca_id",
        mensajeBloqueo:
          "No se puede desactivar: existen lotes de inventario activos registrados con esta marca.",
      },
    ],
  },
// Dos dependencias: la unidad puede estar en uso como unidad base de uninsumo o como unidad de una de sus presentaciones
  "unidades-medida": {
    slug: "unidades-medida",
    prismaModel: "unidad_medida",
    tableName: "unidad_medida",
    tieneDescripcion: false,
    rolesLectura: OPERACION,
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
    rolesLectura: OPERACION,
    dependencias: [
      {
        tablaDependiente: "recepcion_donacion_lote",
        columnaFk: "institucion_id",
        mensajeBloqueo:
          "No se puede desactivar: existen recepciones de donación activas registradas para esta institución.",
      },
    ],
    camposExtra: [
      { nombre: "telefono", tipo: "telefono", requerido: false },
      { nombre: "correo", tipo: "correo", requerido: false },
    ],
  },
};
