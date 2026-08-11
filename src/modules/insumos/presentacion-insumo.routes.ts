import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { DIRECCION, OPERACION } from "../../config/roles.js";
import {
  listarController,
  crearController,
  editarController,
  desactivarController,
  reactivarController,
} from "./presentacion-insumo.controller.js";

const router = Router();

router.get(
  "/:id/presentaciones",
  requireAuth,
  requireRole(OPERACION),
  listarController,
);
router.post(
  "/:id/presentaciones",
  requireAuth,
  requireRole(DIRECCION),
  crearController,
);
router.patch(
  "/:id/presentaciones/:presentacionId",
  requireAuth,
  requireRole(DIRECCION),
  editarController,
);
router.patch(
  "/:id/presentaciones/:presentacionId/desactivar",
  requireAuth,
  requireRole(DIRECCION),
  desactivarController,
);
router.patch(
  "/:id/presentaciones/:presentacionId/reactivar",
  requireAuth,
  requireRole(DIRECCION),
  reactivarController,
);

export default router;
