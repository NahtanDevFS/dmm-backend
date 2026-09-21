import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { OPERACION } from "../../config/roles.js";
import {
  entregasPorMesController,
  stockPorCategoriaController,
  poblacionPorProgramaController,
  poblacionPorGeneroController,
} from "./panel.controller.js";

/** Datos agregados para las gráficas de Inicio */
const router = Router();

router.get(
  "/entregas-por-mes",
  requireAuth,
  requireRole(OPERACION),
  entregasPorMesController,
);
router.get(
  "/stock-por-categoria",
  requireAuth,
  requireRole(OPERACION),
  stockPorCategoriaController,
);
router.get(
  "/poblacion-por-programa",
  requireAuth,
  requireRole(OPERACION),
  poblacionPorProgramaController,
);
router.get(
  "/poblacion-por-genero",
  requireAuth,
  requireRole(OPERACION),
  poblacionPorGeneroController,
);

export default router;
