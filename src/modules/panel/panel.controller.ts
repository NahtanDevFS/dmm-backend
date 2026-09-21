import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  entregasPorMes,
  stockPorCategoria,
  poblacionPorPrograma,
  poblacionPorGenero,
} from "./panel.repository.js";

const entregasPorMesQuery = z.object({
  meses: z.coerce.number().int().min(1).max(24).optional().default(6),
});

export async function entregasPorMesController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = entregasPorMesQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const datos = await entregasPorMes(parsed.data.meses);
    return res.status(200).json({ datos });
  } catch (error) {
    return next(error);
  }
}

export async function stockPorCategoriaController(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const datos = await stockPorCategoria();
    return res.status(200).json({ datos });
  } catch (error) {
    return next(error);
  }
}

const fecha = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha inválida");

const poblacionPorProgramaQuery = z.object({
  desde: fecha,
  hasta: fecha,
});

export async function poblacionPorProgramaController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = poblacionPorProgramaQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const { desde, hasta } = parsed.data;
    if (desde > hasta) {
      return res.status(400).json({
        message: "La fecha 'desde' no puede ser posterior a la fecha 'hasta'",
      });
    }
    const datos = await poblacionPorPrograma(desde, hasta);
    return res.status(200).json({ datos });
  } catch (error) {
    return next(error);
  }
}

// Mismo esquema de query que poblacionPorPrograma: no vale la pena declararotro par desde/hasta para el mismo par de campos
export async function poblacionPorGeneroController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = poblacionPorProgramaQuery.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const { desde, hasta } = parsed.data;
    if (desde > hasta) {
      return res.status(400).json({
        message: "La fecha 'desde' no puede ser posterior a la fecha 'hasta'",
      });
    }
    const datos = await poblacionPorGenero(desde, hasta);
    return res.status(200).json({ datos });
  } catch (error) {
    return next(error);
  }
}
