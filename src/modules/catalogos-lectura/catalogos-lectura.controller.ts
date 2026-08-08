import type { Request, Response, NextFunction } from "express";
import {
  listarTiposGenero,
  listarTiposParentesco,
  listarTiposDocumentoPersona,
  listarTiposEvidenciaEntrega,
  listarEstadosSolicitud,
} from "./catalogos-lectura.repository.js";

export async function listarTiposGeneroController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tipos = await listarTiposGenero();
    return res.status(200).json(tipos);
  } catch (error) {
    return next(error);
  }
}

export async function listarTiposParentescoController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tipos = await listarTiposParentesco();
    return res.status(200).json(tipos);
  } catch (error) {
    return next(error);
  }
}

export async function listarTiposDocumentoPersonaController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tipos = await listarTiposDocumentoPersona();
    return res.status(200).json(tipos);
  } catch (error) {
    return next(error);
  }
}

export async function listarTiposEvidenciaEntregaController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tipos = await listarTiposEvidenciaEntrega();
    return res.status(200).json(tipos);
  } catch (error) {
    return next(error);
  }
}

export async function listarEstadosSolicitudController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const estados = await listarEstadosSolicitud();
    return res.status(200).json(estados);
  } catch (error) {
    return next(error);
  }
}
