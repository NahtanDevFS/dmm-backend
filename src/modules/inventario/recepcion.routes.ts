import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { OPERACION } from "../../config/roles.js";
import { uploadMemoria } from "../../lib/storage/upload.middleware.js";
import {
  listarController,
  obtenerController,
  crearController,
  editarController,
  desactivarController,
  reactivarController,
  listarLotesController,
  crearLoteController,
  listarDocumentosController,
  subirDocumentoController,
  eliminarDocumentoController,
} from "./recepcion.controller.js";

// Recibir donaciones es operación diaria, a diferencia de los catálogos:
// EMPLEADO_DMM entra aquí (matriz de roles, módulo INV).
const router = Router();

router.get("/", requireAuth, requireRole(OPERACION), listarController);
router.get("/:id", requireAuth, requireRole(OPERACION), obtenerController);
router.post("/", requireAuth, requireRole(OPERACION), crearController);
router.patch("/:id", requireAuth, requireRole(OPERACION), editarController);
router.patch(
  "/:id/desactivar",
  requireAuth,
  requireRole(OPERACION),
  desactivarController,
);
router.patch(
  "/:id/reactivar",
  requireAuth,
  requireRole(OPERACION),
  reactivarController,
);

router.get(
  "/:id/lotes",
  requireAuth,
  requireRole(OPERACION),
  listarLotesController,
);
router.post(
  "/:id/lotes",
  requireAuth,
  requireRole(OPERACION),
  crearLoteController,
);

router.get(
  "/:id/documentos",
  requireAuth,
  requireRole(OPERACION),
  listarDocumentosController,
);
router.post(
  "/:id/documentos",
  requireAuth,
  requireRole(OPERACION),
  uploadMemoria.single("archivo"),
  subirDocumentoController,
);
router.delete(
  "/:id/documentos/:documentoId",
  requireAuth,
  requireRole(OPERACION),
  eliminarDocumentoController,
);

export default router;
