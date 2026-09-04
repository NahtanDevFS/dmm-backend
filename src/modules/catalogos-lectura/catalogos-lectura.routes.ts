import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { OPERACION } from "../../config/roles.js";
import {
  listarTiposGeneroController,
  listarModalidadesSolicitudController,
  listarEstadosCivilesController,
  listarTiposParentescoController,
  listarTiposDocumentoPersonaController,
  listarTiposEvidenciaEntregaController,
  listarTiposEvidenciaContratoController,
  listarEstadosSolicitudController,
  listarEstadosContratoController,
  listarTiposMultaController,
} from "./catalogos-lectura.controller.js";

const router = Router();

// Ninguno de estos catalogos alimenta un filtro de reportes, asi que ALCALDE no
// los necesita: todos van con OPERACION.

router.get(
  "/estados-civiles",
  requireAuth,
  requireRole(OPERACION),
  listarEstadosCivilesController,
);
router.get(
  "/modalidades-solicitud",
  requireAuth,
  requireRole(OPERACION),
  listarModalidadesSolicitudController,
  listarEstadosCivilesController,
);
router.get(
  "/tipos-genero",
  requireAuth,
  requireRole(OPERACION),
  listarTiposGeneroController,
  listarModalidadesSolicitudController,
  listarEstadosCivilesController,
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
  "/tipos-evidencia-contrato",
  requireAuth,
  requireRole(OPERACION),
  listarTiposEvidenciaContratoController,
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
