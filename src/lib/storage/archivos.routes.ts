import type { Request, Response, NextFunction } from "express";
import path from "node:path";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";

const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads");

async function servirArchivoController(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const rutaRelativa = req.params[0];
    const rutaAbsoluta = path.join(UPLOADS_DIR, rutaRelativa);

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

router.get("/archivos/*", requireAuth, servirArchivoController);

export default router;
