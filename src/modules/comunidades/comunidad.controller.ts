import type { Request, Response, NextFunction } from "express";
import { existeMunicipioActivo } from "../geografia/geografia.repository.js";
import {
  crearComunidadSchema,
  editarComunidadSchema,
} from "./comunidad.schema.js";
import {
  listarComunidades,
  buscarComunidadPorId,
  existeNombreDuplicadoEnMunicipio,
  tienePersonasActivas,
  crearComunidad,
  editarComunidad,
  cambiarEstadoComunidad,
  withReadClient,
} from "./comunidad.repository.js";

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const municipioIdRaw = req.query.municipioId;
    let municipioId: number | undefined;
    if (municipioIdRaw !== undefined) {
      municipioId = Number(municipioIdRaw);
      if (!Number.isInteger(municipioId)) {
        return res.status(400).json({ message: "municipioId inválido" });
      }
    }

    const incluirInactivas = req.query.incluirInactivos === "true";
    const comunidades = await listarComunidades({
      municipioId,
      incluirInactivas,
    });
    return res.status(200).json(comunidades);
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

    const comunidad = await buscarComunidadPorId(id);
    if (!comunidad) {
      return res.status(404).json({ message: "Comunidad no encontrada" });
    }

    return res.status(200).json(comunidad);
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
    const parsed = crearComunidadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    if (!(await existeMunicipioActivo(parsed.data.municipio_id))) {
      return res.status(400).json({
        message: "El municipio indicado no existe o no está activo",
      });
    }

    if (
      await existeNombreDuplicadoEnMunicipio(
        parsed.data.nombre,
        parsed.data.municipio_id,
      )
    ) {
      return res.status(409).json({
        message: `Ya existe una comunidad llamada "${parsed.data.nombre}" en ese municipio`,
      });
    }

    const nueva = await crearComunidad(req.usuario!.id, parsed.data);
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

    const parsed = editarComunidadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Datos inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }

    const existente = await buscarComunidadPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Comunidad no encontrada" });
    }

    if (
      parsed.data.municipio_id !== undefined &&
      !(await existeMunicipioActivo(parsed.data.municipio_id))
    ) {
      return res.status(400).json({
        message: "El municipio indicado no existe o no está activo",
      });
    }

    // Unicidad compuesta: si cambia el nombre y/o el municipio, hay que validar contra el municipio resultante (el nuevo si se envió, o el actual si no)
    const nombreAValidar = parsed.data.nombre ?? existente.nombre;
    const municipioAValidar =
      parsed.data.municipio_id ?? existente.municipio_id;
    if (
      (parsed.data.nombre !== undefined ||
        parsed.data.municipio_id !== undefined) &&
      (await existeNombreDuplicadoEnMunicipio(
        nombreAValidar,
        municipioAValidar,
        id,
      ))
    ) {
      return res.status(409).json({
        message: `Ya existe una comunidad llamada "${nombreAValidar}" en ese municipio`,
      });
    }

    const actualizada = await editarComunidad(req.usuario!.id, id, parsed.data);
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

    const existente = await buscarComunidadPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Comunidad no encontrada" });
    }

    if (!existente.activo) {
      return res.status(200).json(existente); // idempotente
    }

    const bloqueado = await withReadClient((client) =>
      tienePersonasActivas(id, client),
    );
    if (bloqueado) {
      return res.status(409).json({
        message:
          "No se puede desactivar: hay personas activas registradas en esta comunidad.",
      });
    }

    const actualizada = await cambiarEstadoComunidad(
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

    const existente = await buscarComunidadPorId(id);
    if (!existente) {
      return res.status(404).json({ message: "Comunidad no encontrada" });
    }

    const actualizada = await cambiarEstadoComunidad(req.usuario!.id, id, true);
    return res.status(200).json(actualizada);
  } catch (error) {
    return next(error);
  }
}
