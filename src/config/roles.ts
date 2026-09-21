/** Única fuente de verdad de la matriz de autorización */

export const ROL = {
  EMPLEADO_DMM: "EMPLEADO_DMM",
  DIRECTORA: "DIRECTORA",
  ALCALDE: "ALCALDE",
  ADMINISTRADOR: "ADMINISTRADOR",
} as const;

export type Rol = (typeof ROL)[keyof typeof ROL];

/** Cualquier usuario autenticado, incluido ALCALDE */
export const TODOS: Rol[] = [
  ROL.EMPLEADO_DMM,
  ROL.DIRECTORA,
  ROL.ALCALDE,
  ROL.ADMINISTRADOR,
];

/** Operación diaria de la DMM: beneficiarios, inventario, solicitudes, entregas, préstamos */
export const OPERACION: Rol[] = [
  ROL.EMPLEADO_DMM,
  ROL.DIRECTORA,
  ROL.ADMINISTRADOR,
];

/** Decisiones que quedan con dirección: gestión de catálogos, aprobación y */
export const DIRECCION: Rol[] = [ROL.DIRECTORA, ROL.ADMINISTRADOR];

/** Único módulo donde entra alcalde, y no tiene ningún endpoint de escritura: su acceso es de solo lectura por construcción, no por convención */
export const REPORTES: Rol[] = [ROL.DIRECTORA, ROL.ALCALDE, ROL.ADMINISTRADOR];

/** Catálogos que alimentan los filtros de los reportes y que por tanto alcalde sí necesita leer para poder usar su único módulo: comunidad (y la geografía que la jerarquiza), discapacidad, programa y categoría de insumo */
export const LECTURA_CATALOGOS_REPORTE: Rol[] = [
  ROL.EMPLEADO_DMM,
  ROL.DIRECTORA,
  ROL.ALCALDE,
  ROL.ADMINISTRADOR,
];

/** Administración del sistema: gestión de usuarios, catálogo de roles y consulta de la bitácora de auditoría */
export const ADMINISTRACION: Rol[] = [ROL.DIRECTORA, ROL.ADMINISTRADOR];
