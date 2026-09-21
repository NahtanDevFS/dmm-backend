import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { REPORTES } from "../../config/roles.js";
import {
  personasAtendidasController,
  stockPorCategoriaController,
  poblacionBeneficiadaController,
} from "./reporte.controller.js";

/** Único módulo donde ALCALDE tiene acceso: la entrevista con el cliente confirmóque solo consulta reportes, y aquí no hay ningún endpoint de escritura, así quesu acceso es de lectura por construcción */
const router = Router();

router.get(
  "/personas-atendidas",
  requireAuth,
  requireRole(REPORTES),
  personasAtendidasController,
);
router.get(
  "/stock-por-categoria",
  requireAuth,
  requireRole(REPORTES),
  stockPorCategoriaController,
);
router.get(
  "/poblacion-beneficiada",
  requireAuth,
  requireRole(REPORTES),
  poblacionBeneficiadaController,
);

export default router;
