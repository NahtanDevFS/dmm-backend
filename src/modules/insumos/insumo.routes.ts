import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { DIRECCION, OPERACION } from "../../config/roles.js";
import {
  listarController,
  obtenerController,
  crearController,
  editarController,
  desactivarController,
  reactivarController,
  obtenerStockController,
  listarStockController,
  listarUnidadesController,
} from "./insumo.controller.js";
import presentacionRoutes from "./presentacion-insumo.routes.js";

// El insumo es dato maestro del catálogo de inventario (RF-CAT-05), no
// operación diaria: la gestión queda con los mismos roles que el resto de
// catálogos. Lo operativo (recepción de donaciones, entregas) sí incluirá a
// EMPLEADO_DMM.
const router = Router();

// Antes de "/:id" para que "stock" no se lea como un id.
router.get(
  "/stock",
  requireAuth,
  requireRole(OPERACION),
  listarStockController,
  listarUnidadesController,
);

router.get("/", requireAuth, requireRole(OPERACION), listarController);
router.get("/:id", requireAuth, requireRole(OPERACION), obtenerController);
router.get(
  "/:id/unidades",
  requireAuth,
  requireRole(OPERACION),
  listarUnidadesController,
);
router.get(
  "/:id/stock",
  requireAuth,
  requireRole(OPERACION),
  obtenerStockController,
  listarStockController,
  listarUnidadesController,
);
router.post("/", requireAuth, requireRole(DIRECCION), crearController);
router.patch("/:id", requireAuth, requireRole(DIRECCION), editarController);
router.patch(
  "/:id/desactivar",
  requireAuth,
  requireRole(DIRECCION),
  desactivarController,
);
router.patch(
  "/:id/reactivar",
  requireAuth,
  requireRole(DIRECCION),
  reactivarController,
);

// Sub-router de presentaciones, con su propio requireAuth/requireRole por endpoint
router.use("/", presentacionRoutes);

export default router;
