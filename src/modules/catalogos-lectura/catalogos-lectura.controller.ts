import type { Request, Response, NextFunction } from "express";
import {
  listarTiposGenero,
  listarModalidadesSolicitud,
  listarEstadosCiviles,
  listarTiposParentesco,
  listarTiposDocumentoPersona,
  listarTiposEvidenciaEntrega,
  listarTiposEvidenciaContrato,
  listarEstadosSolicitud,
  listarEstadosContrato,
  listarTiposMulta,
} from "./catalogos-lectura.repository.js";

export async function listarModalidadesSolicitudController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res.status(200).json(await listarModalidadesSolicitud());
  } catch (error) {
    return next(error);
  }
}

export async function listarEstadosCivilesController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res.status(200).json(await listarEstadosCiviles());
  } catch (error) {
    return next(error);
  }
}

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

export async function listarTiposEvidenciaContratoController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tipos = await listarTiposEvidenciaContrato();
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

export async function listarEstadosContratoController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res.status(200).json(await listarEstadosContrato());
  } catch (error) {
    return next(error);
  }
}

export async function listarTiposMultaController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res.status(200).json(await listarTiposMulta());
  } catch (error) {
    return next(error);
  }
}
