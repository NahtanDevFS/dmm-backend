import { Request, Response, NextFunction } from "express";
import multer from "multer";
import { traducirErrorPostgres } from "../lib/errores/postgres.js";
import {
  ArchivoInvalidoError,
  TAMANO_MAXIMO_BYTES,
} from "../lib/storage/file-validation.js";

const MB_MAXIMOS = TAMANO_MAXIMO_BYTES / (1024 * 1024);

/** Errores de express.json / urlencoded (body-parser): su `message` es técnico y en inglés, así que se reemplaza por uno estable para el usuario */
const MENSAJES_PARSER: Record<string, { status: number; message: string }> = {
  "entity.parse.failed": {
    status: 400,
    message: "El cuerpo de la solicitud no es un JSON válido.",
  },
  "entity.too.large": {
    status: 413,
    message: "La solicitud es demasiado grande.",
  },
  "encoding.unsupported": {
    status: 415,
    message: "La codificación de la solicitud no es compatible.",
  },
  "charset.unsupported": {
    status: 415,
    message: "El juego de caracteres de la solicitud no es compatible.",
  },
  "request.aborted": {
    status: 400,
    message: "La solicitud se interrumpió antes de completarse.",
  },
};

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

// Multer corta la subida antes de llegar al controlador: sin esta rama un archivo demasiado grande terminaba en el 500 genérico
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        message: `El archivo supera el tamaño máximo permitido de ${MB_MAXIMOS} MB.`,
      });
    }
    if (err.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({
        message: `Campo de archivo inesperado: "${err.field}". Envíe el archivo en el campo "archivo".`,
      });
    }
    return res.status(400).json({ message: "La carga del archivo no es válida." });
  }

  if (typeof err?.type === "string" && err.type in MENSAJES_PARSER) {
    const { status, message } = MENSAJES_PARSER[err.type];
    return res.status(status).json({ message });
  }

// Reglas de negocio que viven en la base de datos: triggers, checks y storedprocedures
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

// Cualquier otra cosa es un fallo no previsto: no se expone el detalle alcliente, ya quedó en el log del servidor
  return res.status(500).json({ message: "Error interno del servidor" });
}
