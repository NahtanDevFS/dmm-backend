import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import {
  semaforoController,
  darBajaLoteController,
} from "./recepcion.controller.js";

const ROLES_GESTION = ["EMPLEADO_DMM", "DIRECTORA", "ADMINISTRADOR"];

const router = Router();

// Vista transversal del inventario: no cuelga de una recepción concreta.
router.get("/semaforo", requireAuth, semaforoController);

// Baja por vencimiento o daño (sp_dar_baja_insumo_vencido). Es POST y no PATCH
// porque no es una edición del lote: descarta las existencias y deja constancia
// del motivo en las observaciones.
router.post(
  "/lotes/:loteId/baja",
  requireAuth,
  requireRole(...ROLES_GESTION),
  darBajaLoteController,
);

export default router;
