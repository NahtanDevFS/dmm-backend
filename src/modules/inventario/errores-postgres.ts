/**
 * Traduce errores de Postgres del módulo de inventario a respuestas HTTP con
 * mensaje legible (RNF-USA-02).
 *
 * Las validaciones de negocio del inventario viven en la base de datos y el
 * backend no las reimplementa (regla dura del proyecto): `fn_calcular_recepcion_lote`
 * es quien decide si la presentación corresponde al insumo, si falta la fecha de
 * caducidad o el código de fabricante, y si la cantidad resultante es válida.
 * Este módulo se limita a convertir esas excepciones en 400/409 en vez de dejar
 * que lleguen al errorHandler genérico como 500.
 *
 * Nota: el interceptor genérico para toda la aplicación es trabajo posterior
 * (decisión pendiente del documento maestro). Esto cubre solo inventario.
 */

/** Mensajes por nombre de constraint CHECK/UNIQUE. */
const MENSAJES_POR_CONSTRAINT: Record<string, { status: number; message: string }> = {
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
};

export interface ErrorTraducido {
  status: number;
  message: string;
}

interface ErrorPostgres {
  code?: string;
  constraint?: string;
  message?: string;
}

/**
 * Datos que el controller ya conoce y sirven para reemplazar los ids crudos
 * que los mensajes de los triggers interpolan ("El insumo 8 exige...").
 */
export interface ContextoError {
  insumoNombre?: string;
  presentacionNombre?: string;
}

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

  // check_violation / unique_violation con constraint conocido
  if (err.code === "23514" || err.code === "23505") {
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
        "Alguno de los registros referenciados no existe (insumo, presentación, marca o institución).",
    };
  }

  // raise_exception: los mensajes de los triggers ya están redactados en
  // español para el usuario final, así que se devuelven tal cual.
  if (err.code === "P0001" && err.message) {
    return {
      status: 400,
      message: humanizarMensajeTrigger(err.message, contexto),
    };
  }

  return null;
}
