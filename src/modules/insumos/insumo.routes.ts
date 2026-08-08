import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import {
  listarController,
  obtenerController,
  crearController,
  editarController,
  desactivarController,
  reactivarController,
  obtenerStockController,
} from "./insumo.controller.js";
import presentacionRoutes from "./presentacion-insumo.routes.js";

// El insumo es dato maestro del catálogo de inventario (RF-CAT-05), no
// operación diaria: la gestión queda con los mismos roles que el resto de
// catálogos. Lo operativo (recepción de donaciones, entregas) sí incluirá a
// EMPLEADO_DMM.
const ROLES_GESTION = ["DIRECTORA", "ADMINISTRADOR"];

const router = Router();

router.get("/", requireAuth, listarController);
router.get("/:id", requireAuth, obtenerController);
router.get("/:id/stock", requireAuth, obtenerStockController);
router.post("/", requireAuth, requireRole(...ROLES_GESTION), crearController);
router.patch(
  "/:id",
  requireAuth,
  requireRole(...ROLES_GESTION),
  editarController,
);
router.patch(
  "/:id/desactivar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  desactivarController,
);
router.patch(
  "/:id/reactivar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  reactivarController,
);

// Sub-router de presentaciones, con su propio requireAuth/requireRole por endpoint
router.use("/", presentacionRoutes);

export default router;
