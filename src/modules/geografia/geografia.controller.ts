import type { Request, Response, NextFunction } from "express";
import {
  listarDepartamentos,
  listarMunicipios,
} from "./geografia.repository.js";

export async function listarDepartamentosController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const departamentos = await listarDepartamentos();
    return res.status(200).json(departamentos);
  } catch (error) {
    return next(error);
  }
}

export async function listarMunicipiosController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const departamentoIdRaw = req.query.departamentoId;
    let departamentoId: number | undefined;

    if (departamentoIdRaw !== undefined) {
      departamentoId = Number(departamentoIdRaw);
      if (!Number.isInteger(departamentoId)) {
        return res.status(400).json({ message: "departamentoId inválido" });
      }
    }

    const municipios = await listarMunicipios(departamentoId);
    return res.status(200).json(municipios);
  } catch (error) {
    return next(error);
  }
}
