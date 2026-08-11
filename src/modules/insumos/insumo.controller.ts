import type { Request, Response, NextFunction } from "express";
import { paginar } from "../../lib/paginacion.js";
import {
  crearInsumoSchema,
  editarInsumoSchema,
  listarInsumosQuerySchema,
} from "./insumo.schema.js";
import {
  listarInsumos,
  buscarInsumoPorId,
  existeNombreDuplicadoEnCategoria,
  existeCategoriaInsumoActiva,
  existeUnidadMedidaActiva,
  tieneLineasDeSolicitudActivas,
  tieneStockDisponible,
  crearInsumo,
  editarInsumo,
  cambiarEstadoInsumo,
  obtenerStockInsumo,
  obtenerStockTotalInsumo,
  obtenerStockPorPresentacion,
  withReadClient,
} from "./insumo.repository.js";

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = listarInsumosQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de búsqueda inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const { total, filas } = await listarInsumos({
      categoriaId: parsed.data.categoriaId,
      busqueda: parsed.data.busqueda,
      incluirInactivos: parsed.data.incluirInactivos,
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const insumo = await buscarInsumoPorId(id);
    if (!insumo) {
      return res.status(404).json({ message: "Insumo no encontrado" });
    }

    return res.status(200).json(insumo);
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
    const parsed = crearInsumoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (!(await existeCategoriaInsumoActiva(parsed.data.categoria_id))) {
      return res.status(400).json({
        message: "La categoría indicada no existe o no está activa",
      });
    }

    if (!(await existeUnidadMedidaActiva(parsed.data.unidad_medida_base_id))) {
      return res.status(400).json({
        message: "La unidad de medida base indicada no existe o no está activa",
      });
    }

    if (
      await existeNombreDuplicadoEnCategoria(
        parsed.data.nombre,
        parsed.data.categoria_id,
      )
    ) {
      return res.status(409).json({
        message: `Ya existe un insumo llamado "${parsed.data.nombre}" en esa categoría`,
      });
    }

    const nuevo = await crearInsumo(req.usuario!.id, parsed.data);
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const parsed = editarInsumoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const existente = await buscarInsumoPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Insumo no encontrado" });
    }

    if (
      parsed.data.categoria_id !== undefined &&
      !(await existeCategoriaInsumoActiva(parsed.data.categoria_id))
    ) {
      return res.status(400).json({
        message: "La categoría indicada no existe o no está activa",
      });
    }

    if (
      parsed.data.unidad_medida_base_id !== undefined &&
      !(await existeUnidadMedidaActiva(parsed.data.unidad_medida_base_id))
    ) {
      return res.status(400).json({
        message: "La unidad de medida base indicada no existe o no está activa",
      });
    }

    // Unicidad compuesta: si cambia el nombre y/o la categoría, hay que validar
    // contra la categoría resultante (la nueva si se envió, o la actual si no)
    const nombreAValidar = parsed.data.nombre ?? existente.nombre;
    const categoriaAValidar =
      parsed.data.categoria_id ?? existente.categoria_id;
    if (
      (parsed.data.nombre !== undefined ||
        parsed.data.categoria_id !== undefined) &&
      (await existeNombreDuplicadoEnCategoria(
        nombreAValidar,
        categoriaAValidar,
        id,
      ))
    ) {
      return res.status(409).json({
        message: `Ya existe un insumo llamado "${nombreAValidar}" en esa categoría`,
      });
    }

    const actualizado = await editarInsumo(req.usuario!.id, id, parsed.data);
    return res.status(200).json(actualizado);
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

    const existente = await buscarInsumoPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Insumo no encontrado" });
    }

    if (!existente.activo) {
      return res.status(200).json(existente); // idempotente
    }

    const bloqueo = await withReadClient(async (client) => {
      if (await tieneLineasDeSolicitudActivas(id, client)) {
        return "No se puede desactivar: existen solicitudes de apoyo activas que incluyen este insumo.";
      }
      if (await tieneStockDisponible(id, client)) {
        return "No se puede desactivar: el insumo todavía tiene existencias disponibles en inventario.";
      }
      return null;
    });

    if (bloqueo) {
      return res.status(409).json({ message: bloqueo });
    }

    const actualizado = await cambiarEstadoInsumo(req.usuario!.id, id, false);
    return res.status(200).json(actualizado);
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

    const existente = await buscarInsumoPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Insumo no encontrado" });
    }

    const actualizado = await cambiarEstadoInsumo(req.usuario!.id, id, true);
    return res.status(200).json(actualizado);
  } catch (error) {
    return next(error);
  }
}

export async function obtenerStockController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ message: "Id inválido" });
    }

    const insumo = await buscarInsumoPorId(id);
    if (!insumo) {
      return res.status(404).json({ message: "Insumo no encontrado" });
    }

    const [stock, presentaciones] = await Promise.all([
      obtenerStockInsumo(id),
      obtenerStockPorPresentacion(id),
    ]);

    // Insumo desactivado: no está en v_stock_insumo, pero puede conservar
    // existencias. Se reporta el total y se deja explícito que no hay
    // información de caducidad disponible.
    if (!stock) {
      return res.status(200).json({
        insumo_id: id,
        insumo_nombre: insumo.nombre,
        stock_total: await obtenerStockTotalInsumo(id),
        proxima_caducidad: null,
        semaforo: null,
        insumo_activo: false,
        presentaciones,
      });
    }

    return res
      .status(200)
      .json({ ...stock, insumo_activo: true, presentaciones });
  } catch (error) {
    return next(error);
  }
}
