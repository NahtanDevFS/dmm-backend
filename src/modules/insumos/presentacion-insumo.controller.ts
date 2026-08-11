import type { Request, Response, NextFunction } from "express";
import {
  crearPresentacionSchema,
  editarPresentacionSchema,
} from "./presentacion-insumo.schema.js";
import {
  buscarInsumoPorId,
  existeUnidadMedidaActiva,
  withReadClient,
} from "./insumo.repository.js";
import {
  listarPresentacionesDeInsumo,
  buscarPresentacionPorId,
  existeUnidadEnInsumo,
  contarPresentacionesActivas,
  tieneLotesActivos,
  crearPresentacion,
  editarPresentacion,
  cambiarEstadoPresentacion,
} from "./presentacion-insumo.repository.js";

/**
 * Resuelve y valida los ids de la ruta anidada. Devuelve el mensaje de error y
 * su status cuando algo no cuadra, para que cada controller no repita las
 * mismas cuatro comprobaciones.
 */
async function resolverRuta(
  req: Request,
  conPresentacion: boolean,
): Promise<
  | { ok: true; insumoId: number; presentacionId: number }
  | { ok: false; status: number; message: string }
> {
  const insumoId = Number(req.params.id);
  if (!Number.isInteger(insumoId)) {
    return { ok: false, status: 400, message: "Id de insumo inválido" };
  }

  const insumo = await buscarInsumoPorId(insumoId);
  if (!insumo) {
    return { ok: false, status: 404, message: "Insumo no encontrado" };
  }

  if (!conPresentacion) {
    return { ok: true, insumoId, presentacionId: 0 };
  }

  const presentacionId = Number(req.params.presentacionId);
  if (!Number.isInteger(presentacionId)) {
    return { ok: false, status: 400, message: "Id de presentación inválido" };
  }

  const presentacion = await buscarPresentacionPorId(presentacionId);
  if (!presentacion) {
    return { ok: false, status: 404, message: "Presentación no encontrada" };
  }

  // Evita que /insumos/1/presentaciones/99 opere sobre la presentación de otro insumo
  if (presentacion.insumo_id !== insumoId) {
    return {
      ok: false,
      status: 404,
      message: "La presentación no pertenece a este insumo",
    };
  }

  return { ok: true, insumoId, presentacionId };
}

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverRuta(req, false);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const presentaciones = await listarPresentacionesDeInsumo({
      insumoId: ruta.insumoId,
      incluirInactivas: req.query.incluirInactivos === "true",
    });
    return res.status(200).json(presentaciones);
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
    const ruta = await resolverRuta(req, false);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = crearPresentacionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (!(await existeUnidadMedidaActiva(parsed.data.unidad_medida_id))) {
      return res.status(400).json({
        message: "La unidad de medida indicada no existe o no está activa",
      });
    }

    if (
      await existeUnidadEnInsumo(ruta.insumoId, parsed.data.unidad_medida_id)
    ) {
      return res.status(409).json({
        message:
          "Ya existe una presentación de este insumo con esa unidad de medida",
      });
    }

    // La primera presentación de un insumo se marca default aunque no se pida:
    // así ningún insumo queda sin presentación por defecto.
    const esPrimera = (await contarPresentacionesActivas(ruta.insumoId)) === 0;
    const es_default = esPrimera ? true : (parsed.data.es_default ?? false);

    const nueva = await crearPresentacion(req.usuario!.id, ruta.insumoId, {
      unidad_medida_id: parsed.data.unidad_medida_id,
      es_default,
    });
    return res.status(201).json(nueva);
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
    const ruta = await resolverRuta(req, true);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const parsed = editarPresentacionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const existente = (await buscarPresentacionPorId(ruta.presentacionId))!;

    if (
      parsed.data.unidad_medida_id !== undefined &&
      !(await existeUnidadMedidaActiva(parsed.data.unidad_medida_id))
    ) {
      return res.status(400).json({
        message: "La unidad de medida indicada no existe o no está activa",
      });
    }

    if (
      parsed.data.unidad_medida_id !== undefined &&
      (await existeUnidadEnInsumo(
        ruta.insumoId,
        parsed.data.unidad_medida_id,
        ruta.presentacionId,
      ))
    ) {
      return res.status(409).json({
        message:
          "Ya existe una presentación de este insumo con esa unidad de medida",
      });
    }

    // Quitar el flag directamente dejaría al insumo sin default. La forma
    // correcta de cambiarlo es marcar otra presentación como default, lo que
    // desmarca esta automáticamente.
    if (parsed.data.es_default === false && existente.es_default) {
      return res.status(409).json({
        message:
          "No se puede quitar la presentación por defecto: marque otra presentación como predeterminada en su lugar.",
      });
    }

    const actualizada = await editarPresentacion(
      req.usuario!.id,
      ruta.presentacionId,
      ruta.insumoId,
      parsed.data,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}

export async function desactivarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverRuta(req, true);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const existente = (await buscarPresentacionPorId(ruta.presentacionId))!;
    if (!existente.activo) {
      return res.status(200).json(existente); // idempotente
    }

    const bloqueada = await withReadClient((client) =>
      tieneLotesActivos(ruta.presentacionId, client),
    );
    if (bloqueada) {
      return res.status(409).json({
        message:
          "No se puede desactivar: existen lotes de inventario activos recibidos en esta presentación.",
      });
    }

    // Si es la default y quedan otras activas, el insumo se quedaría sin
    // presentación por defecto.
    if (
      existente.es_default &&
      (await contarPresentacionesActivas(ruta.insumoId)) > 1
    ) {
      return res.status(409).json({
        message:
          "No se puede desactivar la presentación por defecto: marque otra presentación como predeterminada primero.",
      });
    }

    const actualizada = await cambiarEstadoPresentacion(
      req.usuario!.id,
      ruta.presentacionId,
      false,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}

export async function reactivarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ruta = await resolverRuta(req, true);
    if (!ruta.ok) {
      return res.status(ruta.status).json({ message: ruta.message });
    }

    const actualizada = await cambiarEstadoPresentacion(
      req.usuario!.id,
      ruta.presentacionId,
      true,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}
