import type { Request, Response, NextFunction } from "express";
import {
  registrarEntregaSchema,
  anularEntregaSchema,
  listarEntregasQuerySchema,
  crearEvidenciaSchema,
  fifoQuerySchema,
} from "./entrega.schema.js";
import {
  buscarEntregaPorId,
  listarEntregas,
  listarDetallesDeEntrega,
  listarLotesFifo,
  existePersonaActiva,
  buscarInsumoActivo,
  existeTipoParentescoActivo,
  existeTipoEvidenciaActivo,
  buscarLineaParaEntrega,
  registrarEntrega,
  anularEntrega,
} from "./entrega.repository.js";
import {
  listarEvidenciasDeEntrega,
  buscarEvidenciaPorId,
  crearEvidenciaEntrega,
  eliminarEvidenciaEntrega,
} from "./evidencia-entrega.repository.js";
import { guardarArchivo } from "../../lib/storage/storage.service.js";
import { paginar } from "../../lib/paginacion.js";
import {
  traducirErrorPostgres,
  type ContextoError,
} from "../../lib/errores/postgres.js";

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

async function resolverEntrega(
  req: Request,
): Promise<
  { ok: true; id: number } | { ok: false; status: number; message: string }
> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return { ok: false, status: 400, message: "Id inválido" };
  }
  const entrega = await buscarEntregaPorId(id);
  if (!entrega) {
    return { ok: false, status: 404, message: "Entrega no encontrada" };
  }
  return { ok: true, id };
}

// ─────────────────────────────────────────────── lecturas

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = listarEntregasQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de búsqueda inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const { total, filas } = await listarEntregas({
      personaId: parsed.data.personaId,
      insumoId: parsed.data.insumoId,
      desde: parsed.data.desde,
      hasta: parsed.data.hasta,
      incluirAnuladas: parsed.data.incluirAnuladas,
      limite: parsed.data.limite,
      desplazamiento: parsed.data.desplazamiento,
    });
    return res.status(200).json(paginar(filas, total, parsed.data));
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
    const ruta = await resolverEntrega(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const [entrega, detalles, evidencias] = await Promise.all([
      buscarEntregaPorId(ruta.id),
      listarDetallesDeEntrega(ruta.id),
      listarEvidenciasDeEntrega(ruta.id),
    ]);

    return res.status(200).json({ ...entrega, detalles, evidencias });
  } catch (error) {
    return next(error);
  }
}

/**
 * Vista previa del orden FEFO/FIFO: de qué lotes va a salir el despacho. Solo
 * lee la vista, sin reordenar ni decidir nada: la selección real la hace
 * sp_registrar_entrega recorriendo la misma vista.
 */
export async function lotesFifoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = fifoQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de búsqueda inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const insumo = await buscarInsumoActivo(parsed.data.insumoId);
    if (!insumo) {
      return res
        .status(404)
        .json({ message: "El insumo indicado no existe o no está activo" });
    }

    return res.status(200).json(await listarLotesFifo(parsed.data.insumoId));
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── registro

export async function registrarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = registrarEntregaSchema.safeParse(req.body);
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
        .json({ message: "El insumo indicado no existe o no está activo" });
    }

    if (parsed.data.persona_receptor_id != null) {
      if (!(await existePersonaActiva(parsed.data.persona_receptor_id))) {
        return res.status(400).json({
          message: "La persona receptora indicada no existe o no está activa",
        });
      }
      if (
        !(await existeTipoParentescoActivo(
          parsed.data.tipo_parentesco_receptor_id!,
        ))
      ) {
        return res.status(400).json({
          message: "El parentesco indicado no existe o no está activo",
        });
      }
    }

    // Reglas que la base de datos NO cubre para el despacho contra una línea de
    // solicitud. sp_registrar_entrega valida existencia y coherencia del insumo,
    // y el CHECK de detalle_solicitud_apoyo impide exceder lo requerido, pero
    // nada impide entregar contra una línea cancelada o una solicitud que
    // todavía espera aprobación.
    if (parsed.data.detalle_solicitud_id != null) {
      const linea = await buscarLineaParaEntrega(
        parsed.data.detalle_solicitud_id,
      );
      if (!linea) {
        return res.status(400).json({
          message: "La línea de solicitud indicada no existe o está inactiva",
        });
      }
      if (linea.estado_nombre === "CANCELADA") {
        return res.status(409).json({
          message: "No se puede entregar: la línea de solicitud fue cancelada.",
        });
      }
      if (linea.estado_nombre === "ENTREGADA") {
        return res.status(409).json({
          message:
            "No se puede entregar: la línea de solicitud ya fue entregada por completo.",
        });
      }
      if (linea.requiere_aprobacion && !linea.aprobada) {
        return res.status(409).json({
          message:
            "No se puede entregar: la solicitud requiere aprobación y todavía no ha sido aprobada.",
        });
      }
      if (linea.persona_id !== parsed.data.persona_id) {
        return res.status(400).json({
          message:
            "La persona indicada no es el beneficiario de esa solicitud.",
        });
      }
      const pendiente = linea.cantidad_requerida - linea.cantidad_entregada;
      if (parsed.data.cantidad > pendiente) {
        return res.status(409).json({
          message: `La cantidad excede lo pendiente de esa línea. Pendiente: ${pendiente}.`,
        });
      }
    }

    const contexto: ContextoError = { insumoNombre: insumo.nombre };

    try {
      const entregaId = await registrarEntrega(req.usuario!.id, parsed.data);
      const [entrega, detalles] = await Promise.all([
        buscarEntregaPorId(entregaId),
        listarDetallesDeEntrega(entregaId),
      ]);
      return res.status(201).json({ ...entrega, detalles });
    } catch (error) {
      return responderErrorConContexto(error, res, next, contexto);
    }
  } catch (error) {
    return next(error);
  }
}

export async function anularController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverEntrega(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = anularEntregaSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    // Que la entrega exista y esté activa lo valida sp_desactivar_entrega; su
    // excepción la traduce el errorHandler a 409.
    await anularEntrega(req.usuario!.id, ruta.id, parsed.data.motivo);

    const [entrega, detalles] = await Promise.all([
      buscarEntregaPorId(ruta.id),
      listarDetallesDeEntrega(ruta.id),
    ]);
    return res.status(200).json({ ...entrega, detalles });
  } catch (error) {
    return next(error);
  }
}

// ─────────────────────────────────────────────── evidencias

export async function listarEvidenciasController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverEntrega(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }
    return res.status(200).json(await listarEvidenciasDeEntrega(ruta.id));
  } catch (error) {
    return next(error);
  }
}

export async function subirEvidenciaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverEntrega(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Debe adjuntar un archivo" });
    }

    const parsed = crearEvidenciaSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (!(await existeTipoEvidenciaActivo(parsed.data.tipo_evidencia_id))) {
      return res.status(400).json({
        message: "El tipo de evidencia indicado no existe o no está activo",
      });
    }

    const guardado = await guardarArchivo(req.file.buffer, "evidencia-entrega");

    const nueva = await crearEvidenciaEntrega(req.usuario!.id, {
      entregaId: ruta.id,
      tipoEvidenciaId: parsed.data.tipo_evidencia_id,
      rutaArchivo: guardado.rutaRelativa,
      observaciones: parsed.data.observaciones,
    });
    return res.status(201).json(nueva);
  } catch (error) {
    return next(error);
  }
}

export async function eliminarEvidenciaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverEntrega(req);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const evidenciaId = Number(req.params.evidenciaId);
    if (!Number.isInteger(evidenciaId)) {
      return res.status(400).json({ message: "Id de evidencia inválido" });
    }

    const evidencia = await buscarEvidenciaPorId(evidenciaId);
    if (!evidencia || evidencia.entrega_id !== ruta.id) {
      return res.status(404).json({ message: "Evidencia no encontrada" });
    }

    await eliminarEvidenciaEntrega(req.usuario!.id, evidenciaId);
    return res.status(200).json(await listarEvidenciasDeEntrega(ruta.id));
  } catch (error) {
    return next(error);
  }
}
