import { Request, Response, NextFunction } from "express";
import { traducirErrorPostgres } from "../lib/errores/postgres.js";
import { ArchivoInvalidoError } from "../lib/storage/file-validation.js";

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  console.error(err);

  if (err instanceof ArchivoInvalidoError) {
    return res.status(400).json({ message: err.message });
  }

  // Reglas de negocio que viven en la base de datos: triggers, checks y stored
  // procedures. Sin esto llegarían como 500 con un mensaje técnico en la cara
  // del usuario (RNF-USA-02).
  const traducido = traducirErrorPostgres(err);
  if (traducido) {
    return res.status(traducido.status).json({ message: traducido.message });
  }

  // Errores con status explícito puesto por la aplicación
  if (typeof err?.status === "number") {
    return res
      .status(err.status)
      .json({ message: err.message || "Error en la solicitud" });
  }

  // Cualquier otra cosa es un fallo no previsto: no se expone el detalle al
  // cliente, ya quedó en el log del servidor.
  return res.status(500).json({ message: "Error interno del servidor" });
}
