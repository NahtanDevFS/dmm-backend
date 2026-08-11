import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import {
  personasAtendidasController,
  stockPorCategoriaController,
  poblacionBeneficiadaController,
} from "./reporte.controller.js";

/**
 * Único módulo donde ALCALDE tiene acceso: la entrevista con el cliente confirmó
 * que solo consulta reportes, y aquí no hay ningún endpoint de escritura, así que
 * su acceso es de lectura por construcción.
 *
 * EMPLEADO_DMM queda fuera a propósito: la matriz de roles reserva los reportes
 * para dirección, alcaldía y administración.
 */
const ROLES_REPORTES = ["DIRECTORA", "ALCALDE", "ADMINISTRADOR"];

const router = Router();

router.get(
  "/personas-atendidas",
  requireAuth,
  requireRole(...ROLES_REPORTES),
  personasAtendidasController,
);
router.get(
  "/stock-por-categoria",
  requireAuth,
  requireRole(...ROLES_REPORTES),
  stockPorCategoriaController,
);
router.get(
  "/poblacion-beneficiada",
  requireAuth,
  requireRole(...ROLES_REPORTES),
  poblacionBeneficiadaController,
);

export default router;
