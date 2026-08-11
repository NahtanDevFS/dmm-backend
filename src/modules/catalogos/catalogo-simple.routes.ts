import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { DIRECCION } from "../../config/roles.js";
import type { CatalogoSimpleConfig } from "./catalogo-simple.config.js";
import { createCatalogoSimpleController } from "./catalogo-simple.controller.js";

export function createCatalogoSimpleRouter(
  config: CatalogoSimpleConfig,
): Router {
  const router = Router();
  const controller = createCatalogoSimpleController(config);

  router.get(
    "/",
    requireAuth,
    requireRole(config.rolesLectura),
    controller.listar,
  );
  router.get(
    "/:id",
    requireAuth,
    requireRole(config.rolesLectura),
    controller.obtener,
  );
  router.post("/", requireAuth, requireRole(DIRECCION), controller.crear);
  router.patch("/:id", requireAuth, requireRole(DIRECCION), controller.editar);
  router.patch(
    "/:id/desactivar",
    requireAuth,
    requireRole(DIRECCION),
    controller.desactivar,
  );
  router.patch(
    "/:id/reactivar",
    requireAuth,
    requireRole(DIRECCION),
    controller.reactivar,
  );

  return router;
}
