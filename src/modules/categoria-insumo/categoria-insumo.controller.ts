import type { Request, Response, NextFunction } from "express";
import {
  crearCategoriaInsumoSchema,
  editarCategoriaInsumoSchema,
} from "./categoria-insumo.schema.js";
import {
  listarCategoriasInsumo,
  buscarCategoriaInsumoPorId,
  existeNombreDuplicado,
  tieneInsumosActivos,
  crearCategoriaInsumo,
  editarCategoriaInsumo,
  cambiarEstadoCategoriaInsumo,
  withReadClient,
} from "./categoria-insumo.repository.js";

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const incluirInactivas = req.query.incluirInactivos === "true";
    const categorias = await listarCategoriasInsumo(incluirInactivas);
    return res.status(200).json(categorias);
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

    const categoria = await buscarCategoriaInsumoPorId(id);
    if (!categoria) {
      return res.status(404).json({ message: "Categoría no encontrada" });
    }

    return res.status(200).json(categoria);
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
    const parsed = crearCategoriaInsumoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (await existeNombreDuplicado(parsed.data.nombre)) {
      return res.status(409).json({
        message: `Ya existe una categoría de insumo llamada "${parsed.data.nombre}"`,
      });
    }

    const nueva = await crearCategoriaInsumo(req.usuario!.id, parsed.data);
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const parsed = editarCategoriaInsumoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const existente = await buscarCategoriaInsumoPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Categoría no encontrada" });
    }

    if (
      parsed.data.nombre &&
      (await existeNombreDuplicado(parsed.data.nombre, id))
    ) {
      return res.status(409).json({
        message: `Ya existe una categoría de insumo llamada "${parsed.data.nombre}"`,
      });
    }

    const actualizada = await editarCategoriaInsumo(
      req.usuario!.id,
      id,
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const existente = await buscarCategoriaInsumoPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Categoría no encontrada" });
    }

    if (!existente.activo) {
      return res.status(200).json(existente); // idempotente
    }

    const bloqueado = await withReadClient((client) =>
      tieneInsumosActivos(id, client),
    );
    if (bloqueado) {
      return res.status(409).json({
        message:
          "No se puede desactivar: existen insumos activos asignados a esta categoría.",
      });
    }

    const actualizada = await cambiarEstadoCategoriaInsumo(
      req.usuario!.id,
      id,
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const existente = await buscarCategoriaInsumoPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Categoría no encontrada" });
    }

    const actualizada = await cambiarEstadoCategoriaInsumo(
      req.usuario!.id,
      id,
      true,
    );
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}
