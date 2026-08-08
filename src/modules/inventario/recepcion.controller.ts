import type { Request, Response, NextFunction } from "express";
import {
  crearRecepcionSchema,
  editarRecepcionSchema,
  listarRecepcionesQuerySchema,
  crearLoteSchema,
  darBajaLoteSchema,
  semaforoQuerySchema,
  crearDocumentoRecepcionSchema,
} from "./recepcion.schema.js";
import {
  listarRecepciones,
  buscarRecepcionPorId,
  existeInstitucionActiva,
  buscarInsumoActivo,
  existeMarcaActiva,
  buscarPresentacionActiva,
  crearRecepcion,
  editarRecepcion,
  cambiarEstadoRecepcion,
  listarLotesDeRecepcion,
  buscarLotePorId,
  crearLoteYProcesarPendientes,
  darBajaLote,
  listarSemaforoInventario,
  tieneLotesActivos,
  withReadClient,
} from "./recepcion.repository.js";
import {
  listarDocumentosDeRecepcion,
  buscarDocumentoRecepcionPorId,
  crearDocumentoRecepcion,
  eliminarDocumentoRecepcion,
} from "./documento-recepcion.repository.js";
import {
  traducirErrorPostgres,
  type ContextoError,
} from "./errores-postgres.js";
import {
  guardarArchivo,
  ArchivoInvalidoError,
} from "../../lib/storage/storage.service.js";

/** Centraliza el manejo de errores de escritura del módulo. */
function responderError(
  error: unknown,
  res: Response,
  next: NextFunction,
  contexto?: ContextoError,
): Response | void {
  if (error instanceof ArchivoInvalidoError) {
    return res.status(400).json({ message: error.message });
  }
  const traducido = traducirErrorPostgres(error, contexto);
  if (traducido) {
    return res.status(traducido.status).json({ message: traducido.message });
  }
  return next(error);
}

async function resolverRecepcion(
  req: Request,
): Promise<
  { ok: true; id: number } | { ok: false; status: number; message: string }
> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return { ok: false, status: 400, message: "Id inválido" };
  }
  const recepcion = await buscarRecepcionPorId(id);
  if (!recepcion) {
    return { ok: false, status: 404, message: "Recepción no encontrada" };
  }
  return { ok: true, id };
}

// ---------------------------------------------------------------- cabecera

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = listarRecepcionesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de búsqueda inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const recepciones = await listarRecepciones({
      institucionId: parsed.data.institucionId,
      incluirInactivas: parsed.data.incluirInactivas,
    });
    return res.status(200).json(recepciones);
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const recepcion = await buscarRecepcionPorId(id);
    if (!recepcion) {
      return res.status(404).json({ message: "Recepción no encontrada" });
    }

    const [lotes, documentos] = await Promise.all([
      listarLotesDeRecepcion(id, false),
      listarDocumentosDeRecepcion(id),
    ]);

    return res.status(200).json({ ...recepcion, lotes, documentos });
  } catch (error) {
    return next(error);
  }
}

export async function crearController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = crearRecepcionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (!(await existeInstitucionActiva(parsed.data.institucion_id))) {
      return res.status(400).json({
        message: "La institución donante indicada no existe o no está activa",
      });
    }

    const nueva = await crearRecepcion(req.usuario!.id, parsed.data);
    return res.status(201).json(nueva);
  } catch (error) {
    return responderError(error, res, next);
  }
}

export async function editarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverRecepcion(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = editarRecepcionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (
      parsed.data.institucion_id !== undefined &&
      !(await existeInstitucionActiva(parsed.data.institucion_id))
    ) {
      return res.status(400).json({
        message: "La institución donante indicada no existe o no está activa",
      });
    }

    const actualizada = await editarRecepcion(
      req.usuario!.id,
      ruta.id,
      parsed.data,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return responderError(error, res, next);
  }
}

export async function desactivarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverRecepcion(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const existente = (await buscarRecepcionPorId(ruta.id))!;
    if (!existente.activo) {
      return res.status(200).json(existente); // idempotente
    }

    // Desactivar la cabecera dejaría lotes con existencias colgando de una
    // recepción inactiva: primero hay que dar de baja cada lote.
    const bloqueada = await withReadClient((client) =>
      tieneLotesActivos(ruta.id, client),
    );
    if (bloqueada) {
      return res.status(409).json({
        message:
          "No se puede desactivar: la recepción tiene lotes de inventario activos. Dé de baja los lotes primero.",
      });
    }

    const actualizada = await cambiarEstadoRecepcion(
      req.usuario!.id,
      ruta.id,
      false,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return responderError(error, res, next);
  }
}

export async function reactivarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverRecepcion(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    const actualizada = await cambiarEstadoRecepcion(
      req.usuario!.id,
      ruta.id,
      true,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return responderError(error, res, next);
  }
}

// ------------------------------------------------------- lotes de inventario

export async function listarLotesController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverRecepcion(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    const lotes = await listarLotesDeRecepcion(
      ruta.id,
      req.query.incluirInactivos === "true",
    );
    return res.status(200).json(lotes);
  } catch (error) {
    return next(error);
  }
}

export async function crearLoteController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverRecepcion(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const recepcion = (await buscarRecepcionPorId(ruta.id))!;
    if (!recepcion.activo) {
      return res.status(409).json({
        message: "No se pueden agregar lotes a una recepción desactivada",
      });
    }

    const parsed = crearLoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    // Solo se valida lo que las FK no cubren: que los registros estén activos.
    // La coherencia presentación↔insumo, la caducidad y el código de fabricante
    // obligatorios los valida trg_calcular_recepcion_lote y no se reimplementan
    // aquí; sus excepciones se traducen en responderError.
    const insumo = await buscarInsumoActivo(parsed.data.insumo_id);
    if (!insumo) {
      return res
        .status(400)
        .json({ message: "El insumo indicado no existe o no está activo" });
    }

    const presentacion = await buscarPresentacionActiva(
      parsed.data.presentacion_recepcion_id,
    );
    if (!presentacion) {
      return res.status(400).json({
        message: "La presentación indicada no existe o no está activa",
      });
    }

    if (
      parsed.data.marca_id != null &&
      !(await existeMarcaActiva(parsed.data.marca_id))
    ) {
      return res
        .status(400)
        .json({ message: "La marca indicada no existe o no está activa" });
    }

    // Nombres para que el traductor pueda reemplazar los ids crudos que los
    // mensajes de los triggers interpolan.
    const contexto: ContextoError = {
      insumoNombre: insumo.nombre,
      presentacionNombre: presentacion.unidad_nombre,
    };

    try {
      const nuevo = await crearLoteYProcesarPendientes(
        req.usuario!.id,
        ruta.id,
        parsed.data,
      );
      return res.status(201).json(nuevo);
    } catch (error) {
      return responderError(error, res, next, contexto);
    }
  } catch (error) {
    return responderError(error, res, next);
  }
}

export async function darBajaLoteController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const loteId = Number(req.params.loteId);
    if (!Number.isInteger(loteId)) {
      return res.status(400).json({ message: "Id de lote inválido" });
    }

    const parsed = darBajaLoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const lote = await buscarLotePorId(loteId);
    if (!lote) {
      return res.status(404).json({ message: "Lote de inventario no encontrado" });
    }
    if (!lote.activo) {
      return res
        .status(409)
        .json({ message: "El lote ya fue dado de baja anteriormente" });
    }

    await darBajaLote(req.usuario!.id, loteId, parsed.data.motivo);
    const actualizado = await buscarLotePorId(loteId);
    return res.status(200).json(actualizado);
  } catch (error) {
    return responderError(error, res, next);
  }
}

export async function semaforoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = semaforoQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de búsqueda inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const lotes = await listarSemaforoInventario({
      insumoId: parsed.data.insumoId,
      semaforo: parsed.data.semaforo,
    });
    return res.status(200).json(lotes);
  } catch (error) {
    return next(error);
  }
}

// --------------------------------------------------- documentos de recepción

export async function listarDocumentosController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverRecepcion(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    const documentos = await listarDocumentosDeRecepcion(ruta.id);
    return res.status(200).json(documentos);
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
    const ruta = await resolverRecepcion(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Debe adjuntar un archivo" });
    }

    const parsed = crearDocumentoRecepcionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const guardado = await guardarArchivo(
      req.file.buffer,
      "documentos-recepcion",
    );

    const nuevo = await crearDocumentoRecepcion(req.usuario!.id, {
      recepcionId: ruta.id,
      rutaArchivo: guardado.rutaRelativa,
      descripcion: parsed.data.descripcion,
    });

    return res.status(201).json(nuevo);
  } catch (error) {
    return responderError(error, res, next);
  }
}

export async function eliminarDocumentoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverRecepcion(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const documentoId = Number(req.params.documentoId);
    if (!Number.isInteger(documentoId)) {
      return res.status(400).json({ message: "Id de documento inválido" });
    }

    const documento = await buscarDocumentoRecepcionPorId(documentoId);
    if (!documento || documento.recepcion_lote_id !== ruta.id) {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    await eliminarDocumentoRecepcion(req.usuario!.id, documentoId);
    const documentos = await listarDocumentosDeRecepcion(ruta.id);
    return res.status(200).json(documentos);
  } catch (error) {
    return next(error);
  }
}
