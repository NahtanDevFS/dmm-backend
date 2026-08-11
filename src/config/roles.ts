/*
Única fuente de verdad de la matriz de autorización.
Antes cada archivo de rutas declaraba su propio `ROLES_GESTION`, y el mismo
identificador significaba dos cosas distintas según el archivo: en `insumo` y
`catalogo-simple` era [DIRECTORA, ADMINISTRADOR], y en `persona`, `entregas`,
`solicitudes` y `prestamos` era [EMPLEADO_DMM, DIRECTORA, ADMINISTRADOR].
Nadie leyendo un archivo suelto podía saber cuál le tocaba.
Los conjuntos se nombran por INTENCIÓN (qué permiten), no por quién los
compone, para que agregar o quitar un rol de un conjunto sea una decisión
consciente en un solo lugar.
*/

export const ROL = {
  EMPLEADO_DMM: "EMPLEADO_DMM",
  DIRECTORA: "DIRECTORA",
  ALCALDE: "ALCALDE",
  ADMINISTRADOR: "ADMINISTRADOR",
} as const;

export type Rol = (typeof ROL)[keyof typeof ROL];

/*
Cualquier usuario autenticado, incluido ALCALDE. Reservado para lo que no
expone datos de negocio: la propia sesión y la propia contraseña
 */
export const TODOS: Rol[] = [
  ROL.EMPLEADO_DMM,
  ROL.DIRECTORA,
  ROL.ALCALDE,
  ROL.ADMINISTRADOR,
];

/**
Operación diaria de la DMM: beneficiarios, inventario, solicitudes, entregas,
préstamos. Excluye a alcalde por decisión de negocio confirmada con el
cliente — su acceso es exclusivamente al módulo de reportes.
 */
export const OPERACION: Rol[] = [
  ROL.EMPLEADO_DMM,
  ROL.DIRECTORA,
  ROL.ADMINISTRADOR,
];

/*
Decisiones que quedan con dirección: gestión de catálogos, aprobación y
rechazo de solicitudes, anulación de entregas, aplicación y anulación de
multas, y el marcado masivo de contratos vencidos
*/
export const DIRECCION: Rol[] = [ROL.DIRECTORA, ROL.ADMINISTRADOR];

/*
Único módulo donde entra alcalde, y no tiene ningún endpoint de escritura:
su acceso es de solo lectura por construcción, no por convención.
EMPLEADO_DMM queda fuera
*/
export const REPORTES: Rol[] = [ROL.DIRECTORA, ROL.ALCALDE, ROL.ADMINISTRADOR];

/*
Catálogos que alimentan los filtros de los reportes y que por tanto alcalde
sí necesita leer para poder usar su único módulo: comunidad (y la geografía
que la jerarquiza), discapacidad, programa y categoría de insumo.
El resto de catálogos (marcas, unidades de medida, instituciones donantes,
tipos de parentesco/documento/evidencia/multa, estados) NO alimentan ningún
filtro de reporte y usan operacion.
 */
export const LECTURA_CATALOGOS_REPORTE: Rol[] = [
  ROL.EMPLEADO_DMM,
  ROL.DIRECTORA,
  ROL.ALCALDE,
  ROL.ADMINISTRADOR,
];

//Gestión de usuarios y consulta de la bitácora de auditoría
export const SOLO_ADMIN: Rol[] = [ROL.ADMINISTRADOR];
