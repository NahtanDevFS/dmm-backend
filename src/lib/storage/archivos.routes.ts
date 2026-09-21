import type { Request, Response, NextFunction } from "express";
import path from "node:path";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { OPERACION } from "../../config/roles.js";

/** SIEMPRE resuelto a ruta absoluta con path */
const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads"),
);

/** Sirve un archivo ya guardado por su ruta relativa (la misma que sepersiste en documento_persona */
async function servirArchivoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const segmentos = req.params.rutaArchivo;
    const rutaRelativa = Array.isArray(segmentos)
      ? segmentos.join("/")
      : segmentos;
    const rutaAbsoluta = path.resolve(UPLOADS_DIR, rutaRelativa);

    if (!rutaAbsoluta.startsWith(UPLOADS_DIR)) {
      return res.status(400).json({ message: "Ruta de archivo inválida" });
    }

    return res.sendFile(rutaAbsoluta, (error) => {
      if (error) {
        if (!res.headersSent) {
          return res.status(404).json({ message: "Archivo no encontrado" });
        }
      }
    });
  } catch (error) {
    return next(error);
  }
}

const router = Router();

router.get(
  "/archivos/*rutaArchivo",
  requireAuth,
  requireRole(OPERACION),
  servirArchivoController,
);

export default router;
