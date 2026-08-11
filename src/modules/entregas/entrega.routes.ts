import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
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
const ROLES_GESTION = ["EMPLEADO_DMM", "DIRECTORA", "ADMINISTRADOR"];
// Anular una entrega revierte inventario: queda con dirección.
const ROLES_ANULACION = ["DIRECTORA", "ADMINISTRADOR"];

const router = Router();

// Antes de "/:id" para que "lotes-fifo" no se lea como un id.
router.get("/lotes-fifo", requireAuth, lotesFifoController);

router.get("/", requireAuth, listarController);
router.get("/:id", requireAuth, obtenerController);
router.post(
  "/",
  requireAuth,
  requireRole(...ROLES_GESTION),
  registrarController,
);

// POST y no PATCH: no edita la entrega, la anula y devuelve el stock a los lotes.
router.post(
  "/:id/anular",
  requireAuth,
  requireRole(...ROLES_ANULACION),
  anularController,
);

router.get("/:id/evidencias", requireAuth, listarEvidenciasController);
router.post(
  "/:id/evidencias",
  requireAuth,
  requireRole(...ROLES_GESTION),
  uploadMemoria.single("archivo"),
  subirEvidenciaController,
);
router.delete(
  "/:id/evidencias/:evidenciaId",
  requireAuth,
  requireRole(...ROLES_GESTION),
  eliminarEvidenciaController,
);

export default router;
