import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import {
  listarTiposGeneroController,
  listarTiposParentescoController,
  listarTiposDocumentoPersonaController,
  listarTiposEvidenciaEntregaController,
} from "./catalogos-lectura.controller.js";

const router = Router();

router.get("/tipos-genero", requireAuth, listarTiposGeneroController);
router.get("/tipos-parentesco", requireAuth, listarTiposParentescoController);
router.get(
  "/tipos-documento-persona",
  requireAuth,
  listarTiposDocumentoPersonaController,
);
router.get(
  "/tipos-evidencia-entrega",
  requireAuth,
  listarTiposEvidenciaEntregaController,
);

export default router;
