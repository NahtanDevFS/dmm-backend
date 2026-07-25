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
} from "./comunidad.controller.js";

const ROLES_GESTION = ["DIRECTORA", "ADMINISTRADOR"];

const router = Router();

router.get("/", requireAuth, listarController);
router.get("/:id", requireAuth, obtenerController);
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

export default router;
