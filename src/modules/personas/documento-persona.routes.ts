import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { uploadMemoria } from "../../lib/storage/upload.middleware.js";
import {
  listarDocumentosController,
  subirDocumentoController,
  eliminarDocumentoController,
} from "./documento-persona.controller.js";

const ROLES_GESTION = ["EMPLEADO_DMM", "DIRECTORA", "ADMINISTRADOR"];

const router = Router();

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
