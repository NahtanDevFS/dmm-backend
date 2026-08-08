import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import {
  listarController,
  crearController,
  editarController,
  desactivarController,
  reactivarController,
} from "./presentacion-insumo.controller.js";

const ROLES_GESTION = ["DIRECTORA", "ADMINISTRADOR"];

const router = Router();

router.get("/:id/presentaciones", requireAuth, listarController);
router.post(
  "/:id/presentaciones",
  requireAuth,
  requireRole(...ROLES_GESTION),
  crearController,
);
router.patch(
  "/:id/presentaciones/:presentacionId",
  requireAuth,
  requireRole(...ROLES_GESTION),
  editarController,
);
router.patch(
  "/:id/presentaciones/:presentacionId/desactivar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  desactivarController,
);
router.patch(
  "/:id/presentaciones/:presentacionId/reactivar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  reactivarController,
);

export default router;
