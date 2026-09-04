import type { Request, Response, NextFunction } from "express";
import {
  crearSolicitudSchema,
  editarSolicitudSchema,
  agregarLineaSchema,
  editarLineaSchema,
  motivoSchema,
  rechazarSchema,
  listarSolicitudesQuerySchema,
  crearRecetaSchema,
  crearDocumentoSolicitudSchema,
} from "./solicitud.schema.js";
import {
  buscarSolicitudPorId,
  listarLineasDeSolicitud,
  buscarLineaPorId,
  listarSolicitudesActivas,
  listarListaEspera,
  existePersonaActiva,
  existeProgramaActivo,
  buscarInsumoActivo,
  existeRecetaDeSolicitud,
  crearSolicitudConLineas,
  editarSolicitud,
  agregarLinea,
  editarLinea,
  aprobarSolicitud,
  rechazarSolicitud,
  cancelarLinea,
  cancelarSolicitudCompleta,
} from "./solicitud.repository.js";
import {
  listarRecetasDeSolicitud,
  buscarRecetaPorId,
  crearRecetaMedica,
  eliminarRecetaMedica,
} from "./receta-medica.repository.js";
import { guardarArchivo } from "../../lib/storage/storage.service.js";
import { responderExpedientePdf } from "../../lib/reportes/expediente.js";
import {
  cabeceraExpediente,
  lineasExpediente,
  formulariosExpediente,
  documentosExpediente,
  entregasExpediente,
} from "./expediente.repository.js";
import {
  listarDocumentosDeSolicitud,
  buscarDocumentoSolicitudPorId,
  crearDocumentoSolicitud,
  eliminarDocumentoSolicitud,
} from "./documento-solicitud.repository.js";
import { paginar } from "../../lib/paginacion.js";
import {
  traducirErrorPostgres,
  type ContextoError,
} from "../../lib/errores/postgres.js";
import { tieneFormulariosPendientes } from "../formularios/formulario.repository.js";

/**
 * Traduce el error con el nombre del insumo, para que los mensajes de los
 * triggers no salgan con ids crudos. El resto de los errores los resuelve el
 * errorHandler global.
 */
function responderErrorConContexto(
  error: unknown,
  res: Response,
  next: NextFunction,
  contexto: ContextoError,
): Response | void {
  const traducido = traducirErrorPostgres(error, contexto);
  if (traducido) {
    return res.status(traducido.status).json({ message: traducido.message });
  }
  return next(error);
}

async function resolverSolicitud(
  req: Request,
): Promise<
  { ok: true; id: number } | { ok: false; status: number; message: string }
> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return { ok: false, status: 400, message: "Id inválido" };
  }
  const solicitud = await buscarSolicitudPorId(id);
  if (!solicitud) {
    return { ok: false, status: 404, message: "Solicitud no encontrada" };
  }
  return { ok: true, id };
}

/** Verifica además que la línea pertenezca a la solicitud de la URL. */
async function resolverLinea(
  req: Request,
): Promise<
  | { ok: true; solicitudId: number; lineaId: number }
  | { ok: false; status: number; message: string }
> {
  const base = await resolverSolicitud(req);
  if (!base.ok) return base;

  const lineaId = Number(req.params.lineaId);
  if (!Number.isInteger(lineaId)) {
    return { ok: false, status: 400, message: "Id de línea inválido" };
  }
  const linea = await buscarLineaPorId(lineaId);
  if (!linea) {
    return {
      ok: false,
      status: 404,
      message: "Línea de solicitud no encontrada",
    };
  }
  if (linea.solicitud_id !== base.id) {
    return {
      ok: false,
      status: 404,
      message: "La línea no pertenece a esta solicitud",
    };
  }
  return { ok: true, solicitudId: base.id, lineaId };
}

// ─────────────────────────────────────────────── listados

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = listarSolicitudesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de búsqueda inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const { total, filas } = await listarSolicitudesActivas({
      personaId: parsed.data.personaId,
      programaId: parsed.data.programaId,
      estadoLinea: parsed.data.estadoLinea,
      soloPendientesAprobacion: parsed.data.soloPendientesAprobacion,
      limite: parsed.data.limite,
      desplazamiento: parsed.data.desplazamiento,
    });
    return res.status(200).json(paginar(filas, total, parsed.data));
  } catch (error) {
    return next(error);
  }
}

export async function listaEsperaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const insumo =
      typeof req.query.insumo === "string" ? req.query.insumo : undefined;
    return res.status(200).json(await listarListaEspera(insumo));
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
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    // `recetas` se conserva por compatibilidad, pero el legajo real vive en
    // `documentos`: la tabla receta_medica nació cuando la medicina pasaba
    // por solicitud y con el flujo actual la receta va como evidencia de la
    // entrega directa.
    const [solicitud, lineas, recetas, documentos] = await Promise.all([
      buscarSolicitudPorId(ruta.id),
      listarLineasDeSolicitud(ruta.id, false),
      listarRecetasDeSolicitud(ruta.id),
      listarDocumentosDeSolicitud(ruta.id),
    ]);

    return res.status(200).json({ ...solicitud, lineas, recetas, documentos });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── cabecera

export async function crearController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = crearSolicitudSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (!(await existePersonaActiva(parsed.data.persona_id))) {
      return res.status(400).json({
        message: "La persona indicada no existe o no está activa",
      });
    }

    if (!(await existeProgramaActivo(parsed.data.programa_id))) {
      return res.status(400).json({
        message: "El programa indicado no existe o no está activo",
      });
    }

    // Insumo repetido dentro del propio payload: la restricción UNIQUE de la
    // tabla lo detectaría, pero el mensaje es más claro señalando el envío.
    const insumoIds = parsed.data.lineas.map((l) => l.insumo_id);
    if (new Set(insumoIds).size !== insumoIds.length) {
      return res.status(400).json({
        message: "La solicitud tiene el mismo insumo repetido en varias líneas",
      });
    }

    // Se valida solo que el insumo esté activo, que es lo que la FK no cubre.
    // Que haya stock o no lo decide trg_validar_stock_linea_solicitud.
    let contexto: ContextoError = {};
    for (const linea of parsed.data.lineas) {
      const insumo = await buscarInsumoActivo(linea.insumo_id);
      if (!insumo) {
        return res.status(400).json({
          message: `El insumo con id ${linea.insumo_id} no existe o no está activo`,
        });
      }
      contexto = { insumoNombre: insumo.nombre };
    }

    try {
      const creada = await crearSolicitudConLineas(
        req.usuario!.id,
        parsed.data,
      );
      return res.status(201).json(creada);
    } catch (error) {
      return responderErrorConContexto(error, res, next, contexto);
    }
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
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = editarSolicitudSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (
      parsed.data.programa_id !== undefined &&
      !(await existeProgramaActivo(parsed.data.programa_id))
    ) {
      return res.status(400).json({
        message: "El programa indicado no existe o no está activo",
      });
    }

    const actualizada = await editarSolicitud(
      req.usuario!.id,
      ruta.id,
      parsed.data,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── aprobación

export async function aprobarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const solicitud = (await buscarSolicitudPorId(ruta.id))!;
    if (!solicitud.activo) {
      return res.status(409).json({ message: "La solicitud está desactivada" });
    }
    if (!solicitud.requiere_aprobacion) {
      return res.status(409).json({
        message: "Esta solicitud no requiere aprobación",
      });
    }
    if (solicitud.aprobada) {
      return res.status(200).json(solicitud); // idempotente
    }

    // Formularios exigidos por la categoría de cada línea (equipo, típicamente):
    // ninguno puede quedar incompleto antes de aprobar. Ver migración 15 y
    // formulario.repository.ts. Las líneas de medicina/comida no tienen
    // categoria_insumo_formulario asociada, así que no las afecta este chequeo.
    const lineas = await listarLineasDeSolicitud(ruta.id, false);
    for (const linea of lineas) {
      if (await tieneFormulariosPendientes(linea.id)) {
        return res.status(409).json({
          message:
            "No se puede aprobar: hay al menos una línea con un formulario exigido todavía sin completar.",
        });
      }
    }

    const actualizada = await aprobarSolicitud(req.usuario!.id, ruta.id);
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}

export async function rechazarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = rechazarSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const solicitud = (await buscarSolicitudPorId(ruta.id))!;
    if (solicitud.aprobada) {
      return res.status(409).json({
        message: "No se puede rechazar una solicitud ya aprobada",
      });
    }

    const actualizada = await rechazarSolicitud(
      req.usuario!.id,
      ruta.id,
      parsed.data.motivo,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── líneas

export async function listarLineasController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    const lineas = await listarLineasDeSolicitud(
      ruta.id,
      req.query.incluirInactivas === "true",
    );
    return res.status(200).json(lineas);
  } catch (error) {
    return next(error);
  }
}

export async function agregarLineaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const solicitud = (await buscarSolicitudPorId(ruta.id))!;
    if (!solicitud.activo) {
      return res.status(409).json({
        message: "No se pueden agregar insumos a una solicitud desactivada",
      });
    }

    const parsed = agregarLineaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const insumo = await buscarInsumoActivo(parsed.data.insumo_id);
    if (!insumo) {
      return res
        .status(400)
        .json({ message: "El insumo indicado no existe o no está activo" });
    }

    try {
      const nueva = await agregarLinea(req.usuario!.id, ruta.id, parsed.data);
      return res.status(201).json(nueva);
    } catch (error) {
      return responderErrorConContexto(error, res, next, {
        insumoNombre: insumo.nombre,
      });
    }
  } catch (error) {
    return next(error);
  }
}

export async function editarLineaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverLinea(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = editarLineaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    // La receta debe pertenecer a la misma solicitud que la línea.
    if (
      parsed.data.receta_medica_id != null &&
      !(await existeRecetaDeSolicitud(
        parsed.data.receta_medica_id,
        ruta.solicitudId,
      ))
    ) {
      return res.status(400).json({
        message: "La receta indicada no existe o no pertenece a esta solicitud",
      });
    }

    const actualizada = await editarLinea(
      req.usuario!.id,
      ruta.lineaId,
      parsed.data,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}

export async function cancelarLineaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverLinea(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = motivoSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    // Las reglas de qué se puede cancelar (no entregada, no ya cancelada) están
    // en sp_cancelar_linea_solicitud; sus excepciones las traduce el errorHandler.
    await cancelarLinea(req.usuario!.id, ruta.lineaId, parsed.data.motivo);
    const linea = await buscarLineaPorId(ruta.lineaId);
    return res.status(200).json(linea);
  } catch (error) {
    return next(error);
  }
}

export async function cancelarSolicitudController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = motivoSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    await cancelarSolicitudCompleta(
      req.usuario!.id,
      ruta.id,
      parsed.data.motivo,
    );

    const [solicitud, lineas] = await Promise.all([
      buscarSolicitudPorId(ruta.id),
      listarLineasDeSolicitud(ruta.id, false),
    ]);
    return res.status(200).json({ ...solicitud, lineas });
  } catch (error) {
    return next(error);
  }
}

/**
 * El expediente completo en un PDF: la ficha de la persona, cada insumo con
 * sus formularios llenos, las entregas y los documentos adjuntos.
 *
 * Un solo archivo y no uno por formulario: separar obligaría a juntarlos a
 * mano para archivar, que es justo lo que el sistema debería evitar.
 */
export async function expedientePdfController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const cabecera = await cabeceraExpediente(ruta.id);
    if (!cabecera) {
      return res.status(404).json({ message: "La solicitud no existe" });
    }

    const [lineas, documentos, entregas] = await Promise.all([
      lineasExpediente(ruta.id),
      documentosExpediente(ruta.id),
      entregasExpediente(ruta.id),
    ]);

    // Una consulta por línea. Son pocas —lo habitual es una— y hacerlo en una
    // sola con todos los formularios de todas las líneas complicaría el
    // agrupado sin ganar nada perceptible.
    const formulariosPorLinea = new Map(
      await Promise.all(
        lineas.map(
          async (linea) =>
            [
              linea.detalle_solicitud_id,
              await formulariosExpediente(linea.detalle_solicitud_id),
            ] as const,
        ),
      ),
    );

    return responderExpedientePdf(res, {
      cabecera,
      lineas,
      formulariosPorLinea,
      documentos,
      entregas,
    });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── documentos del legajo

export async function listarDocumentosController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    return res.status(200).json(await listarDocumentosDeSolicitud(ruta.id));
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
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Debe adjuntar un archivo" });
    }

    const parsed = crearDocumentoSolicitudSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const guardado = await guardarArchivo(
      req.file.buffer,
      "documentos-solicitud",
    );

    const nuevo = await crearDocumentoSolicitud(req.usuario!.id, {
      solicitudId: ruta.id,
      formularioId: parsed.data.formulario_id,
      rutaArchivo: guardado.rutaRelativa,
      descripcion: parsed.data.descripcion,
      observaciones: parsed.data.observaciones,
    });
    return res.status(201).json(nuevo);
  } catch (error) {
    return next(error);
  }
}

export async function eliminarDocumentoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const documentoId = Number(req.params.documentoId);
    if (!Number.isInteger(documentoId)) {
      return res.status(400).json({ message: "Id de documento inválido" });
    }

    const documento = await buscarDocumentoSolicitudPorId(documentoId);
    if (!documento || documento.solicitud_id !== ruta.id) {
      return res.status(404).json({ message: "Documento no encontrado" });
    }

    await eliminarDocumentoSolicitud(req.usuario!.id, documentoId);
    return res.status(200).json(await listarDocumentosDeSolicitud(ruta.id));
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── recetas médicas

export async function listarRecetasController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    return res.status(200).json(await listarRecetasDeSolicitud(ruta.id));
  } catch (error) {
    return next(error);
  }
}

export async function subirRecetaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Debe adjuntar un archivo" });
    }

    const parsed = crearRecetaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const guardado = await guardarArchivo(req.file.buffer, "recetas-medicas");

    const nueva = await crearRecetaMedica(req.usuario!.id, {
      solicitudId: ruta.id,
      rutaArchivo: guardado.rutaRelativa,
      fechaEmision: parsed.data.fecha_emision,
      observaciones: parsed.data.observaciones,
    });
    return res.status(201).json(nueva);
  } catch (error) {
    return next(error);
  }
}

export async function eliminarRecetaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverSolicitud(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const recetaId = Number(req.params.recetaId);
    if (!Number.isInteger(recetaId)) {
      return res.status(400).json({ message: "Id de receta inválido" });
    }

    const receta = await buscarRecetaPorId(recetaId);
    if (!receta || receta.solicitud_id !== ruta.id) {
      return res.status(404).json({ message: "Receta no encontrada" });
    }

    await eliminarRecetaMedica(req.usuario!.id, recetaId);
    return res.status(200).json(await listarRecetasDeSolicitud(ruta.id));
  } catch (error) {
    return next(error);
  }
}
