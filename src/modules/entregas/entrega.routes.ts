import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { DIRECCION, OPERACION } from "../../config/roles.js";
import { uploadMemoria } from "../../lib/storage/upload.middleware.js";
import {
  listarController,
  obtenerController,
  lotesFifoController,
  registrarController,
  anularController,
  listarEvidenciasController,
  subirEvidenciaController,
  eliminarEvidenciaController,
} from "./entrega.controller.js";

// Despachar es la operación diaria del personal de la DMM.
// Anular una entrega revierte inventario: queda con dirección.
const router = Router();

// Antes de "/:id" para que "lotes-fifo" no se lea como un id.
router.get(
  "/lotes-fifo",
  requireAuth,
  requireRole(OPERACION),
  lotesFifoController,
);

router.get("/", requireAuth, requireRole(OPERACION), listarController);
router.get("/:id", requireAuth, requireRole(OPERACION), obtenerController);
router.post("/", requireAuth, requireRole(OPERACION), registrarController);

// POST y no PATCH: no edita la entrega, la anula y devuelve el stock a los lotes.
router.post(
  "/:id/anular",
  requireAuth,
  requireRole(DIRECCION),
  anularController,
);

router.get(
  "/:id/evidencias",
  requireAuth,
  requireRole(OPERACION),
  listarEvidenciasController,
);
router.post(
  "/:id/evidencias",
  requireAuth,
  requireRole(OPERACION),
  uploadMemoria.single("archivo"),
  subirEvidenciaController,
);
router.delete(
  "/:id/evidencias/:evidenciaId",
  requireAuth,
  requireRole(OPERACION),
  eliminarEvidenciaController,
);

export default router;
