import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { SOLO_ADMIN } from "../../config/roles.js";
import {
  listarController,
  tablasController,
  historialController,
} from "./auditoria.controller.js";

/**
 * Solo lectura: los triggers de la base de datos son los únicos que escriben en
 * auditoria_log, y no hay ni debe haber endpoint para modificarla o borrarla —
 * una bitácora que el sistema puede alterar no sirve como bitácora.
 *
 * Reservado a ADMINISTRADOR: el log contiene el contenido completo de cada fila
 * modificada de todo el sistema.
 */
const router = Router();

// Antes de las rutas con parámetros para que "tablas" no se lea como una tabla.
router.get("/tablas", requireAuth, requireRole(SOLO_ADMIN), tablasController);

router.get("/", requireAuth, requireRole(SOLO_ADMIN), listarController);
router.get(
  "/:tabla/:registroId",
  requireAuth,
  requireRole(SOLO_ADMIN),
  historialController,
);

export default router;
