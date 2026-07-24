import type { Request, Response, NextFunction } from "express";
import { pool } from "../../db/pool.js";
import type { CatalogoSimpleConfig } from "./catalogo-simple.config.js";
import {
  buildCrearSchema,
  buildEditarSchema,
} from "./catalogo-simple.schema.js";
import {
  listarCatalogoSimple,
  buscarCatalogoSimplePorId,
  existeNombreDuplicado,
  tieneDependenciasActivas,
  crearCatalogoSimple,
  editarCatalogoSimple,
  cambiarEstadoCatalogoSimple,
} from "./catalogo-simple.repository.js";

export function createCatalogoSimpleController(config: CatalogoSimpleConfig) {
  async function listar(req: Request, res: Response, next: NextFunction) {
    try {
      const incluirInactivos = req.query.incluirInactivos === "true";
      const registros = await listarCatalogoSimple(config, incluirInactivos);
      return res.status(200).json(registros);
    } catch (error) {
      return next(error);
    }
  }

  async function obtener(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ message: "Id inválido" });
      }

      const registro = await buscarCatalogoSimplePorId(config, id);
      if (!registro) {
        return res.status(404).json({ message: "Registro no encontrado" });
      }

      return res.status(200).json(registro);
    } catch (error) {
      return next(error);
    }
  }

  async function crear(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = buildCrearSchema(config).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Datos inválidos",
          errores: parsed.error.flatten().fieldErrors,
        });
      }

      if (await existeNombreDuplicado(config, parsed.data.nombre)) {
        return res.status(409).json({
          message: `Ya existe un registro con el nombre "${parsed.data.nombre}"`,
        });
      }

      const nuevo = await crearCatalogoSimple(
        config,
        req.usuario!.id,
        parsed.data,
      );
      return res.status(201).json(nuevo);
    } catch (error) {
      return next(error);
    }
  }

  async function editar(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ message: "Id inválido" });
      }

      const parsed = buildEditarSchema(config).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          message: "Datos inválidos",
          errores: parsed.error.flatten().fieldErrors,
        });
      }

      const existente = await buscarCatalogoSimplePorId(config, id);
      if (!existente) {
        return res.status(404).json({ message: "Registro no encontrado" });
      }

      if (
        parsed.data.nombre &&
        (await existeNombreDuplicado(config, parsed.data.nombre, id))
      ) {
        return res.status(409).json({
          message: `Ya existe un registro con el nombre "${parsed.data.nombre}"`,
        });
      }

      const actualizado = await editarCatalogoSimple(
        config,
        req.usuario!.id,
        id,
        parsed.data,
      );
      return res.status(200).json(actualizado);
    } catch (error) {
      return next(error);
    }
  }

  async function desactivar(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ message: "Id inválido" });
      }

      const existente = await buscarCatalogoSimplePorId(config, id);
      if (!existente) {
        return res.status(404).json({ message: "Registro no encontrado" });
      }

      if (!existente.activo) {
        return res.status(200).json(existente); // ya estaba desactivado, idempotente
      }

      //bloquear si hay dependientes activos, indicando la causa
      const client = await pool.connect();
      try {
        const bloqueado = await tieneDependenciasActivas(config, id, client);
        if (bloqueado) {
          return res.status(409).json({
            message: config.dependencia?.mensajeBloqueo,
          });
        }
      } finally {
        client.release();
      }

      const actualizado = await cambiarEstadoCatalogoSimple(
        config,
        req.usuario!.id,
        id,
        false,
      );
      return res.status(200).json(actualizado);
    } catch (error) {
      return next(error);
    }
  }

  async function reactivar(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ message: "Id inválido" });
      }

      const existente = await buscarCatalogoSimplePorId(config, id);
      if (!existente) {
        return res.status(404).json({ message: "Registro no encontrado" });
      }

      const actualizado = await cambiarEstadoCatalogoSimple(
        config,
        req.usuario!.id,
        id,
        true,
      );
      return res.status(200).json(actualizado);
    } catch (error) {
      return next(error);
    }
  }

  return { listar, obtener, crear, editar, desactivar, reactivar };
}
