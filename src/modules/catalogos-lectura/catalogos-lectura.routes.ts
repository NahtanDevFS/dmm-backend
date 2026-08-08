import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import {
  listarTiposGeneroController,
  listarTiposParentescoController,
  listarTiposDocumentoPersonaController,
  listarTiposEvidenciaEntregaController,
  listarEstadosSolicitudController,
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
router.get(
  "/estados-solicitud",
  requireAuth,
  listarEstadosSolicitudController,
);

export default router;
