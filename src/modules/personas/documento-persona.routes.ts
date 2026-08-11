import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { OPERACION } from "../../config/roles.js";
import { uploadMemoria } from "../../lib/storage/upload.middleware.js";
import {
  listarDocumentosController,
  subirDocumentoController,
  eliminarDocumentoController,
} from "./documento-persona.controller.js";

const router = Router();

// Documentos de identificacion: lectura restringida a OPERACION, no a cualquier autenticado
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
