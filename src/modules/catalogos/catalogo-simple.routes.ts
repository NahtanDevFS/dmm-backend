import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import type { CatalogoSimpleConfig } from "./catalogo-simple.config.js";
import { createCatalogoSimpleController } from "./catalogo-simple.controller.js";

const ROLES_GESTION = ["DIRECTORA", "ADMINISTRADOR"];

export function createCatalogoSimpleRouter(
  config: CatalogoSimpleConfig,
): Router {
  const router = Router();
  const controller = createCatalogoSimpleController(config);

  router.get("/", requireAuth, controller.listar);
  router.get("/:id", requireAuth, controller.obtener);
  router.post(
    "/",
    requireAuth,
    requireRole(...ROLES_GESTION),
    controller.crear,
  );
  router.patch(
    "/:id",
    requireAuth,
    requireRole(...ROLES_GESTION),
    controller.editar,
  );
  router.patch(
    "/:id/desactivar",
    requireAuth,
    requireRole(...ROLES_GESTION),
    controller.desactivar,
  );
  router.patch(
    "/:id/reactivar",
    requireAuth,
    requireRole(...ROLES_GESTION),
    controller.reactivar,
  );

  return router;
}
