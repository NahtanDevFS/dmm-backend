import type { Request, Response, NextFunction } from "express";
import { listarAuditoriaQuerySchema } from "./auditoria.schema.js";
import {
  listarAuditoria,
  listarTablasAuditadas,
  historialDeRegistro,
} from "./auditoria.repository.js";
import { paginar } from "../../lib/paginacion.js";
import { ROL } from "../../config/roles.js";

/* La Directora no ve lo técnico: lo que toca a los administradores ni lo que
   no tiene autor (ver ES_TECNICO en el repositorio). Un administrador lo ve
   todo. */
const ocultaAdministradores = (req: Request) =>
  req.usuario!.rol !== ROL.ADMINISTRADOR;

export async function listarController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = listarAuditoriaQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Parámetros de búsqueda inválidos",
        errores: parsed.error.flatten().fieldErrors,
      });
    }
    const d = parsed.data;

    if (d.desde && d.hasta && d.desde > d.hasta) {
      return res.status(400).json({
        message: "La fecha 'desde' no puede ser posterior a la fecha 'hasta'",
      });
    }

    const { total, filas } = await listarAuditoria({
      ...d,
      ocultarAdministradores: ocultaAdministradores(req),
    });
    return res.status(200).json(paginar(filas, total, d));
  } catch (error) {
    return next(error);
  }
}

export async function tablasController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    return res
      .status(200)
      .json(await listarTablasAuditadas(ocultaAdministradores(req)));
  } catch (error) {
    return next(error);
  }
}

/** Historial de un registro concreto: útil para "¿quién cambió esta ficha?" */
export async function historialController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const tabla = String(req.params.tabla ?? "");
    const registroId = Number(req.params.registroId);

    if (!/^[a-z_]{1,50}$/.test(tabla)) {
      return res.status(400).json({ message: "Nombre de tabla inválido" });
    }
    if (!Number.isInteger(registroId) || registroId <= 0) {
      return res.status(400).json({ message: "Id de registro inválido" });
    }

    const filas = await historialDeRegistro(
      tabla,
      registroId,
      ocultaAdministradores(req),
    );
    return res.status(200).json({ total: filas.length, datos: filas });
  } catch (error) {
    return next(error);
  }
}
