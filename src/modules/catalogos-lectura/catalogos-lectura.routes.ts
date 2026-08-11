import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { OPERACION } from "../../config/roles.js";
import {
  listarTiposGeneroController,
  listarTiposParentescoController,
  listarTiposDocumentoPersonaController,
  listarTiposEvidenciaEntregaController,
  listarEstadosSolicitudController,
  listarEstadosContratoController,
  listarTiposMultaController,
} from "./catalogos-lectura.controller.js";

const router = Router();

// Ninguno de estos catalogos alimenta un filtro de reportes, asi que ALCALDE no
// los necesita: todos van con OPERACION.

router.get(
  "/tipos-genero",
  requireAuth,
  requireRole(OPERACION),
  listarTiposGeneroController,
);
router.get(
  "/tipos-parentesco",
  requireAuth,
  requireRole(OPERACION),
  listarTiposParentescoController,
);
router.get(
  "/tipos-documento-persona",
  requireAuth,
  requireRole(OPERACION),
  listarTiposDocumentoPersonaController,
);
router.get(
  "/tipos-evidencia-entrega",
  requireAuth,
  requireRole(OPERACION),
  listarTiposEvidenciaEntregaController,
);
router.get(
  "/estados-solicitud",
  requireAuth,
  requireRole(OPERACION),
  listarEstadosSolicitudController,
);
router.get(
  "/estados-contrato-prestamo",
  requireAuth,
  requireRole(OPERACION),
  listarEstadosContratoController,
);
router.get(
  "/tipos-multa-prestamo",
  requireAuth,
  requireRole(OPERACION),
  listarTiposMultaController,
);

export default router;
