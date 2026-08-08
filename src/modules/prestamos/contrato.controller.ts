import type { Request, Response, NextFunction } from "express";
import {
  crearContratoSchema,
  renovarContratoSchema,
  editarContratoSchema,
  listarContratosQuerySchema,
  aplicarMultaSchema,
  editarMultaSchema,
  pagarMultaSchema,
} from "./contrato.schema.js";
import {
  buscarContratoPorId,
  listarContratos,
  listarContratosVencidos,
  listarCadenaDeRenovaciones,
  buscarContratoRaiz,
  existeRenovacionDe,
  existeContratoDeDetalleEntrega,
  buscarDetalleEntregaActivo,
  crearContrato,
  renovarContrato,
  editarContrato,
  guardarDocumentoFirmado,
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
import { guardarArchivo } from "../../lib/storage/storage.service.js";

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
    return res.status(200).json(
      await listarContratos({
        estado: parsed.data.estado,
        personaId: parsed.data.personaId,
        incluirInactivos: parsed.data.incluirInactivos,
      }),
    );
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

    const [contrato, multas, cadena] = await Promise.all([
      buscarContratoPorId(ruta.id),
      listarMultasDeContrato(ruta.id, false),
      listarCadenaDeRenovaciones(ruta.id),
    ]);

    return res.status(200).json({ ...contrato, multas, cadena });
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
      return res
        .status(409)
        .json({ message: "El contrato está desactivado" });
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
    const actualizados = await marcarContratosVencidos(req.usuario!.id);
    return res.status(200).json({
      actualizados,
      message: `${actualizados} contrato(s) marcados como VENCIDO`,
    });
  } catch (error) {
    return next(error);
  }
}

export async function subirDocumentoController(
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

    const guardado = await guardarArchivo(
      req.file.buffer,
      "contratos-prestamo",
    );
    const actualizado = await guardarDocumentoFirmado(
      req.usuario!.id,
      ruta.id,
      guardado.rutaRelativa,
    );
    return res.status(201).json(actualizado);
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
      return res
        .status(409)
        .json({ message: "La multa fue anulada" });
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
