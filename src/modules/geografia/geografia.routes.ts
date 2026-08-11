import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { LECTURA_CATALOGOS_REPORTE } from "../../config/roles.js";
import {
  listarDepartamentosController,
  listarMunicipiosController,
} from "./geografia.controller.js";

const router = Router();

// Jerarquizan `comunidad`, que es filtro de reportes: ALCALDE las necesita.
router.get(
  "/departamentos",
  requireAuth,
  requireRole(LECTURA_CATALOGOS_REPORTE),
  listarDepartamentosController,
);
router.get(
  "/municipios",
  requireAuth,
  requireRole(LECTURA_CATALOGOS_REPORTE),
  listarMunicipiosController,
);

export default router;
