/**
 * Interceptor genérico de errores de Postgres (RNF-USA-02: mensajes no
 * técnicos). Resuelve la decisión pendiente #5 del documento maestro.
 *
 * La lógica de negocio del sistema vive en la base de datos (triggers, checks y
 * stored procedures) y el backend no la reimplementa. La contrapartida es que
 * las violaciones de esas reglas llegan como errores de Postgres, y sin traducir
 * terminan en un 500 con un mensaje ilegible del tipo
 * "el nuevo registro para la relación «x» viola la restricción «check» «y»".
 *
 * Este módulo convierte esos errores en respuestas HTTP con mensaje útil. Lo usa
 * el errorHandler para toda la aplicación, y los módulos que tienen contexto
 * extra (nombres en vez de ids) pueden invocarlo directamente pasándolo.
 */

export interface ErrorTraducido {
  status: number;
  message: string;
}

/**
 * Datos que el controller ya conoce y sirven para reemplazar los ids crudos que
 * los mensajes de los triggers interpolan ("El insumo 8 exige...").
 */
export interface ContextoError {
  insumoNombre?: string;
  presentacionNombre?: string;
}

interface ErrorPostgres {
  code?: string;
  constraint?: string;
  message?: string;
}

/**
 * Mensajes por nombre de constraint. Cubre CHECK y UNIQUE de todas las tablas
 * con reglas que el usuario puede violar desde la interfaz. Agregar una entrada
 * aquí es más barato que replicar la validación en TypeScript.
 */
const MENSAJES_POR_CONSTRAINT: Record<string, ErrorTraducido> = {
  // ── inventario / recepción de donaciones
  recepcion_donacion_lote_fecha_valida_check: {
    status: 400,
    message: "La fecha de recepción no puede ser futura.",
  },
  recepcion_donacion_lote_codigo_lote_key: {
    status: 409,
    message: "Ya existe una recepción registrada con ese código de lote.",
  },
  detalle_inventario_lote_cantidad_recepcion_check: {
    status: 400,
    message: "La cantidad recibida debe ser mayor que cero.",
  },
  detalle_inventario_lote_unidades_presentacion_check: {
    status: 400,
    message:
      "Las unidades por presentación del lote deben ser mayores que cero.",
  },
  detalle_inventario_lote_cantidad_inicial_check: {
    status: 400,
    message:
      "La cantidad resultante en unidades base es inválida. Revise la cantidad recibida y las unidades por presentación.",
  },
  detalle_inventario_lote_cantidad_disponible_check: {
    status: 409,
    message: "La operación dejaría el inventario en negativo.",
  },
  detalle_inventario_lote_cantidad_coherente_check: {
    status: 409,
    message:
      "La cantidad disponible no puede superar la cantidad inicial del lote.",
  },

  // ── solicitudes de apoyo
  solicitud_apoyo_fecha_valida_check: {
    status: 400,
    message: "La fecha de la solicitud no puede ser futura.",
  },
  solicitud_apoyo_aprobacion_coherente_check: {
    status: 400,
    message:
      "Los datos de aprobación son incoherentes: una solicitud aprobada requiere fecha y usuario que la aprobó.",
  },
  detalle_solicitud_insumo_unico_key: {
    status: 409,
    message: "Ese insumo ya está incluido en esta solicitud.",
  },
  detalle_solicitud_cantidad_requerida_check: {
    status: 400,
    message: "La cantidad requerida debe ser mayor que cero.",
  },
  detalle_solicitud_cantidad_entregada_check: {
    status: 409,
    message:
      "La cantidad entregada no puede ser negativa ni superar la cantidad requerida.",
  },
  receta_medica_fecha_valida_check: {
    status: 400,
    message: "La fecha de emisión de la receta no puede ser futura.",
  },

  // ── catálogos
  institucion_donante_correo_valido_check: {
    status: 400,
    message: "El correo electrónico no tiene un formato válido.",
  },
  idx_presentacion_default_unica: {
    status: 409,
    message:
      "El insumo ya tiene una presentación por defecto. Marque la nueva como predeterminada para reemplazarla.",
  },
};

/**
 * Excepciones de trigger (P0001) que en realidad son datos mal enviados y no un
 * conflicto con el estado actual. El resto de los P0001 se responde 409: son
 * reglas de negocio que dependen del estado de la base (sin stock, línea ya
 * entregada, lote ya inactivo), no del formato de la petición.
 */
const PATRONES_400: RegExp[] = [
  /no corresponde al insumo declarado/i,
  /no pertenece al insumo/i,
  /exige fecha de caducidad/i,
  /exige c[óo]digo de lote del fabricante/i,
  /cantidad recibida resultante es inv[áa]lida/i,
  /Debe indicar el motivo/i,
];

function humanizarMensajeTrigger(
  mensaje: string,
  contexto?: ContextoError,
): string {
  if (!contexto?.insumoNombre) return mensaje;

  // "El insumo 8 exige fecha de caducidad." -> 'El insumo "Amoxicilina" exige...'
  let salida = mensaje.replace(
    /El insumo \d+/g,
    `El insumo "${contexto.insumoNombre}"`,
  );

  // La incoherencia presentación↔insumo llega con los dos ids numéricos, que no
  // le dicen nada al usuario: se reescribe por completo.
  if (/no corresponde al insumo declarado/.test(mensaje)) {
    salida = contexto.presentacionNombre
      ? `La presentación "${contexto.presentacionNombre}" no pertenece al insumo "${contexto.insumoNombre}". Elija una presentación registrada para ese insumo.`
      : `La presentación seleccionada no pertenece al insumo "${contexto.insumoNombre}". Elija una presentación registrada para ese insumo.`;
  }

  return salida;
}

export function traducirErrorPostgres(
  error: unknown,
  contexto?: ContextoError,
): ErrorTraducido | null {
  const err = error as ErrorPostgres;
  if (!err || typeof err !== "object" || !err.code) return null;

  // check_violation / unique_violation / exclusion_violation
  if (err.code === "23514" || err.code === "23505" || err.code === "23P01") {
    const conocido = err.constraint
      ? MENSAJES_POR_CONSTRAINT[err.constraint]
      : undefined;
    if (conocido) return conocido;
    return {
      status: err.code === "23505" ? 409 : 400,
      message: "Los datos enviados no cumplen una regla de la base de datos.",
    };
  }

  // foreign_key_violation: se referencia un registro que no existe
  if (err.code === "23503") {
    return {
      status: 400,
      message:
        "Alguno de los registros referenciados no existe. Verifique los datos seleccionados.",
    };
  }

  // not_null_violation
  if (err.code === "23502") {
    return { status: 400, message: "Falta un dato obligatorio." };
  }

  // raise_exception: las excepciones de los triggers y stored procedures ya
  // están redactadas en español para el usuario final, así que se devuelven tal
  // cual (con los ids sustituidos por nombres si hay contexto).
  if (err.code === "P0001" && err.message) {
    const message = humanizarMensajeTrigger(err.message, contexto);
    const esDatoInvalido = PATRONES_400.some((re) => re.test(err.message!));
    return { status: esDatoInvalido ? 400 : 409, message };
  }

  return null;
}
