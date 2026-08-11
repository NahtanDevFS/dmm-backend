import type { Request, Response, NextFunction } from "express";
import path from "node:path";
import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { OPERACION } from "../../config/roles.js";

/**
 * SIEMPRE resuelto a ruta absoluta con path.resolve, aunque
 * UPLOADS_DIR venga como relativa desde .env (ej. "./uploads"). Esto
 * es necesario porque path.join() normaliza y elimina el "./" al
 * construir rutas, así que comparar "uploads/x/y".startsWith("./uploads")
 * da false aunque ambas apunten exactamente al mismo lugar en disco
 * — bug real encontrado en pruebas: toda descarga (no solo los
 * intentos de path traversal) fallaba con 400 por este motivo.
 */
const UPLOADS_DIR = path.resolve(
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads"),
);

/**
 * Sirve un archivo ya guardado por su ruta relativa (la misma que se
 * persiste en documento_persona.ruta_archivo, etc.).
 *
 * Protegido por requireAuth + requireRole(OPERACION): estos archivos
 * incluyen documentos de identificación de beneficiarios y evidencias
 * fotográficas de entrega. No deben ser accesibles sin autenticación
 * aunque alguien adivine o filtre la ruta, y ALCALDE queda fuera igual
 * que del resto de los módulos de negocio.
 *
 * Express 5 (path-to-regexp v8) exige que los wildcards tengan
 * nombre (`*nombre`), ya no acepta un `*` anónimo como en Express 4.
 * Además, a diferencia de Express 4 (donde req.params[0] era un
 * string con la ruta completa), en Express 5 un wildcard nombrado
 * devuelve un ARRAY con cada segmento de la ruta por separado (ej.
 * ["documentos-persona", "uuid.jpg"]) — hay que volver a unirlos con
 * "/" antes de usarlos como ruta de archivo.
 *
 * path.resolve (no solo path.join) + comparación de prefijo sobre dos
 * rutas absolutas evita path traversal: si el valor decodificado
 * intentara escapar del directorio de uploads (ej.
 * "../../../etc/passwd"), la ruta resuelta ya no empezaría con
 * UPLOADS_DIR y se rechaza con 400 en vez de servir el archivo.
 */
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
