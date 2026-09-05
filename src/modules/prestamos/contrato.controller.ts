import type { Request, Response, NextFunction } from "express";
import { existePersonaActiva } from "../entregas/entrega.repository.js";
import { buscarInsumoActivo } from "../inventario/recepcion.repository.js";
import {
  crearContratoSchema,
  crearPrestamoDirectoSchema,
  cerrarContratoSchema,
  renovarContratoSchema,
  editarContratoSchema,
  listarContratosQuerySchema,
  aplicarMultaSchema,
  editarMultaSchema,
  pagarMultaSchema,
  crearEvidenciaContratoSchema,
} from "./contrato.schema.js";
import {
  buscarContratoPorId,
  buscarPersonaEInsumoDeContrato,
  listarContratos,
  listarContratosVencidos,
  listarCadenaDeRenovaciones,
  buscarContratoRaiz,
  existeRenovacionDe,
  existeContratoDeDetalleEntrega,
  buscarDetalleEntregaActivo,
  crearContrato,
  crearPrestamoDirecto,
  anularContratoPorError,
  cerrarContratoNoDevuelto,
  renovarContrato,
  editarContrato,
  registrarDevolucion,
  marcarContratosVencidos,
} from "./contrato.repository.js";
import {
  listarMultasDeContrato,
  buscarMultaPorId,
  buscarTipoMultaActivo,
  aplicarMulta,
  editarMulta,
  marcarMultaPagada,
  anularMulta,
} from "./multa.repository.js";
import {
  listarEvidenciasDeContrato,
  buscarEvidenciaContratoPorId,
  existeTipoEvidenciaContratoActivo,
  crearEvidenciaContrato,
  eliminarEvidenciaContrato,
} from "./evidencia-contrato.repository.js";
import { guardarArchivo } from "../../lib/storage/storage.service.js";
import { paginar } from "../../lib/paginacion.js";

async function resolverContrato(
  req: Request,
): Promise<
  { ok: true; id: number } | { ok: false; status: number; message: string }
> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return { ok: false, status: 400, message: "Id inválido" };
  }
  const contrato = await buscarContratoPorId(id);
  if (!contrato) {
    return { ok: false, status: 404, message: "Contrato no encontrado" };
  }
  return { ok: true, id };
}

async function resolverMulta(
  req: Request,
): Promise<
  | { ok: true; contratoId: number; multaId: number }
  | { ok: false; status: number; message: string }
> {
  const base = await resolverContrato(req);
  if (!base.ok) return base;

  const multaId = Number(req.params.multaId);
  if (!Number.isInteger(multaId)) {
    return { ok: false, status: 400, message: "Id de multa inválido" };
  }
  const multa = await buscarMultaPorId(multaId);
  if (!multa || multa.contrato_prestamo_id !== base.id) {
    return { ok: false, status: 404, message: "Multa no encontrada" };
  }
  return { ok: true, contratoId: base.id, multaId };
}

// ─────────────────────────────────────────────── lecturas

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = listarContratosQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de búsqueda inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const { total, filas } = await listarContratos({
      estado: parsed.data.estado,
      personaId: parsed.data.personaId,
      incluirInactivos: parsed.data.incluirInactivos,
      limite: parsed.data.limite,
      desplazamiento: parsed.data.desplazamiento,
    });
    return res.status(200).json(paginar(filas, total, parsed.data));
  } catch (error) {
    return next(error);
  }
}

export async function vencidosController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res.status(200).json(await listarContratosVencidos());
  } catch (error) {
    return next(error);
  }
}

export async function obtenerController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const [contrato, multas, cadena, referencia, evidencias] =
      await Promise.all([
        buscarContratoPorId(ruta.id),
        listarMultasDeContrato(ruta.id, false),
        listarCadenaDeRenovaciones(ruta.id),
        buscarPersonaEInsumoDeContrato(ruta.id),
        listarEvidenciasDeContrato(ruta.id),
      ]);

    return res
      .status(200)
      .json({ ...contrato, multas, cadena, ...referencia, evidencias });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── contratos

export async function crearController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = crearContratoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const detalle = await buscarDetalleEntregaActivo(
      parsed.data.detalle_entrega_id,
    );
    if (!detalle) {
      return res.status(400).json({
        message: "El renglón de entrega indicado no existe o está inactivo",
      });
    }
    if (!detalle.entrega_activa) {
      return res.status(409).json({
        message: "No se puede crear un contrato sobre una entrega anulada",
      });
    }

    // El UNIQUE de detalle_entrega_id ya lo impediría, pero el mensaje explícito
    // es más útil que el genérico del constraint.
    if (await existeContratoDeDetalleEntrega(parsed.data.detalle_entrega_id)) {
      return res.status(409).json({
        message: "Ese renglón de entrega ya tiene un contrato de préstamo",
      });
    }

    const nuevo = await crearContrato(req.usuario!.id, parsed.data);
    return res.status(201).json(nuevo);
  } catch (error) {
    return next(error);
  }
}

export async function renovarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = renovarContratoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const contrato = (await buscarContratoPorId(ruta.id))!;
    if (!contrato.activo) {
      return res.status(409).json({ message: "El contrato está desactivado" });
    }
    if (contrato.fecha_devolucion_real !== null) {
      return res.status(409).json({
        message: "No se puede renovar un contrato ya devuelto",
      });
    }
    // El UNIQUE de contrato_anterior_id solo permite una renovación por
    // contrato: la cadena es lineal, no un árbol.
    if (await existeRenovacionDe(ruta.id)) {
      return res.status(409).json({
        message:
          "Este contrato ya fue renovado. Renueve el último contrato de la cadena.",
      });
    }

    const nuevo = await renovarContrato(
      req.usuario!.id,
      ruta.id,
      parsed.data.fecha_devolucion_pactada,
    );
    return res.status(201).json(nuevo);
  } catch (error) {
    return next(error);
  }
}

export async function editarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = editarContratoSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.fecha_devolucion_pactada === undefined) {
      return res.status(400).json({
        message: "Debe indicar la nueva fecha de devolución pactada",
        errores: parsed.success
          ? undefined
          : parsed.error.flatten().fieldErrors,
      });
    }

    const contrato = (await buscarContratoPorId(ruta.id))!;
    if (contrato.fecha_devolucion_real !== null) {
      return res.status(409).json({
        message: "No se puede modificar un contrato ya devuelto",
      });
    }

    const actualizado = await editarContrato(
      req.usuario!.id,
      ruta.id,
      parsed.data.fecha_devolucion_pactada,
    );
    return res.status(200).json(actualizado);
  } catch (error) {
    return next(error);
  }
}

export async function devolucionController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const contrato = (await buscarContratoPorId(ruta.id))!;
    if (await existeRenovacionDe(ruta.id)) {
      return res.status(409).json({
        message:
          "Este contrato fue renovado. Registre la devolución sobre el último contrato de la cadena.",
      });
    }

    // sp_registrar_devolucion_prestamo devuelve el equipo al lote, pero solo
    // acepta el contrato que tiene la entrega física. En una cadena de
    // renovaciones ese es el contrato raíz.
    const raiz = await buscarContratoRaiz(ruta.id);
    if (!raiz) {
      return res.status(409).json({
        message:
          "No se encontró la entrega física asociada a este contrato; requiere revisión manual.",
      });
    }

    // Las validaciones de estado (contrato inactivo, devolución ya registrada)
    // están en el SP y su excepción la traduce el errorHandler a 409.
    await registrarDevolucion(req.usuario!.id, ruta.id, raiz.id);

    const [actualizado, multas] = await Promise.all([
      buscarContratoPorId(ruta.id),
      listarMultasDeContrato(ruta.id, false),
    ]);
    return res.status(200).json({ ...actualizado, multas });
  } catch (error) {
    return next(error);
  }
}

export async function marcarVencidosController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const { actualizados, multas } = await marcarContratosVencidos(
      req.usuario!.id,
    );
    return res.status(200).json({
      actualizados,
      multas,
      message:
        `${actualizados} contrato(s) marcados como VENCIDO` +
        (multas > 0
          ? ` y ${multas} multa(s) por atraso aplicadas automáticamente`
          : ""),
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Registra un préstamo de principio a fin: la entrega del equipo y su
 * contrato, en un solo acto.
 *
 * Es la puerta principal del módulo. El préstamo no pasa por solicitud —eso
 * es para decidir donaciones— así que aquí se hace todo: quién se lleva qué y
 * hasta cuándo. Las fotos del contrato firmado y del DPI se adjuntan después,
 * sobre el contrato ya creado.
 */
export async function crearPrestamoDirectoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = crearPrestamoDirectoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (!(await existePersonaActiva(parsed.data.persona_id))) {
      return res
        .status(400)
        .json({ message: "La persona indicada no existe o no está activa" });
    }

    const insumo = await buscarInsumoActivo(parsed.data.insumo_id);
    if (!insumo) {
      return res
        .status(400)
        .json({ message: "El equipo indicado no existe o no está activo" });
    }

    try {
      const { contrato, entrega_id } = await crearPrestamoDirecto(
        req.usuario!.id,
        parsed.data,
      );
      return res.status(201).json({ ...contrato, entrega_id });
    } catch (error) {
      // Incluye el rechazo por stock insuficiente de sp_agregar_insumo_entrega,
      // que ya viene redactado en español con las cantidades exactas.
      return next(error);
    }
  } catch (error) {
    return next(error);
  }
}

/**
 * Anula un préstamo registrado por error: deshace contrato y entrega, y el
 * equipo vuelve al inventario.
 */
export async function anularContratoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = cerrarContratoSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    await anularContratoPorError(req.usuario!.id, ruta.id, parsed.data.motivo);
    return res.status(200).json(await buscarContratoPorId(ruta.id));
  } catch (error) {
    return next(error);
  }
}

/**
 * Cierra un préstamo cuyo equipo no volvió. El stock NO se restituye: el
 * equipo efectivamente no está.
 */
export async function noDevueltoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = cerrarContratoSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    return res
      .status(200)
      .json(
        await cerrarContratoNoDevuelto(
          req.usuario!.id,
          ruta.id,
          parsed.data.motivo,
        ),
      );
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── multas

export async function listarMultasController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    return res
      .status(200)
      .json(
        await listarMultasDeContrato(
          ruta.id,
          req.query.incluirAnuladas === "true",
        ),
      );
  } catch (error) {
    return next(error);
  }
}

export async function aplicarMultaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = aplicarMultaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const tipo = await buscarTipoMultaActivo(parsed.data.tipo_multa_id);
    if (!tipo) {
      return res.status(400).json({
        message: "El tipo de multa indicado no existe o no está activo",
      });
    }

    // El monto es opcional: si no viene se toma el monto_sugerido del tipo.
    const monto =
      parsed.data.monto ??
      (tipo.monto_sugerido !== null ? Number(tipo.monto_sugerido) : null);
    if (monto === null) {
      return res.status(400).json({
        message: `El tipo de multa "${tipo.nombre}" no tiene monto sugerido: debe indicar el monto.`,
      });
    }

    const nueva = await aplicarMulta(req.usuario!.id, ruta.id, {
      tipo_multa_id: parsed.data.tipo_multa_id,
      monto,
      motivo: parsed.data.motivo,
      fecha_aplicacion: parsed.data.fecha_aplicacion,
    });
    return res.status(201).json(nueva);
  } catch (error) {
    return next(error);
  }
}

export async function editarMultaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverMulta(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = editarMultaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const multa = (await buscarMultaPorId(ruta.multaId))!;
    if (multa.pagada) {
      return res.status(409).json({
        message: "No se puede modificar una multa ya pagada",
      });
    }

    const actualizada = await editarMulta(
      req.usuario!.id,
      ruta.multaId,
      parsed.data,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}

export async function pagarMultaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverMulta(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = pagarMultaSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const multa = (await buscarMultaPorId(ruta.multaId))!;
    if (!multa.activo) {
      return res.status(409).json({ message: "La multa fue anulada" });
    }
    if (multa.pagada) {
      return res.status(200).json(multa); // idempotente
    }

    const actualizada = await marcarMultaPagada(
      req.usuario!.id,
      ruta.multaId,
      parsed.data.fecha_pago,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}

export async function anularMultaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverMulta(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const multa = (await buscarMultaPorId(ruta.multaId))!;
    if (multa.pagada) {
      return res.status(409).json({
        message: "No se puede anular una multa ya pagada",
      });
    }
    if (!multa.activo) {
      return res.status(200).json(multa); // idempotente
    }

    return res
      .status(200)
      .json(await anularMulta(req.usuario!.id, ruta.multaId));
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── evidencias

/**
 * Evidencias del contrato: el documento firmado (tipo CONTRATO_FIRMADO), el
 * DPI de quien firma (frontal y reverso), y la foto de recepción del
 * equipo -- todo vive aquí, ya no hay una columna dedicada solo para el
 * documento firmado. Un préstamo no exige formularios de estudio
 * socioeconómico -- eso es solo para donación definitiva -- así que estas
 * evidencias son todo lo que un préstamo necesita.
 */
export async function listarEvidenciasContratoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    return res.status(200).json(await listarEvidenciasDeContrato(ruta.id));
  } catch (error) {
    return next(error);
  }
}

export async function subirEvidenciaContratoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Debe adjuntar un archivo" });
    }

    const parsed = crearEvidenciaContratoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (
      !(await existeTipoEvidenciaContratoActivo(parsed.data.tipo_evidencia_id))
    ) {
      return res.status(400).json({
        message: "El tipo de evidencia indicado no existe o no está activo",
      });
    }

    const guardado = await guardarArchivo(
      req.file.buffer,
      "evidencia-contrato-prestamo",
    );

    const nueva = await crearEvidenciaContrato(req.usuario!.id, {
      contratoId: ruta.id,
      tipoEvidenciaId: parsed.data.tipo_evidencia_id,
      rutaArchivo: guardado.rutaRelativa,
      observaciones: parsed.data.observaciones,
    });
    return res.status(201).json(nueva);
  } catch (error) {
    return next(error);
  }
}

export async function eliminarEvidenciaContratoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverContrato(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const evidenciaId = Number(req.params.evidenciaId);
    if (!Number.isInteger(evidenciaId)) {
      return res.status(400).json({ message: "Id de evidencia inválido" });
    }

    const evidencia = await buscarEvidenciaContratoPorId(evidenciaId);
    if (!evidencia || evidencia.contrato_prestamo_id !== ruta.id) {
      return res.status(404).json({ message: "Evidencia no encontrada" });
    }

    await eliminarEvidenciaContrato(req.usuario!.id, evidenciaId);
    return res.status(200).json(await listarEvidenciasDeContrato(ruta.id));
  } catch (error) {
    return next(error);
  }
}
