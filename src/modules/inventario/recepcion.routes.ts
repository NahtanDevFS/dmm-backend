import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
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
const ROLES_GESTION = ["EMPLEADO_DMM", "DIRECTORA", "ADMINISTRADOR"];

const router = Router();

router.get("/", requireAuth, listarController);
router.get("/:id", requireAuth, obtenerController);
router.post("/", requireAuth, requireRole(...ROLES_GESTION), crearController);
router.patch(
  "/:id",
  requireAuth,
  requireRole(...ROLES_GESTION),
  editarController,
);
router.patch(
  "/:id/desactivar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  desactivarController,
);
router.patch(
  "/:id/reactivar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  reactivarController,
);

router.get("/:id/lotes", requireAuth, listarLotesController);
router.post(
  "/:id/lotes",
  requireAuth,
  requireRole(...ROLES_GESTION),
  crearLoteController,
);

router.get("/:id/documentos", requireAuth, listarDocumentosController);
router.post(
  "/:id/documentos",
  requireAuth,
  requireRole(...ROLES_GESTION),
  uploadMemoria.single("archivo"),
  subirDocumentoController,
);
router.delete(
  "/:id/documentos/:documentoId",
  requireAuth,
  requireRole(...ROLES_GESTION),
  eliminarDocumentoController,
);

export default router;
