import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { DIRECCION, LECTURA_CATALOGOS_REPORTE } from "../../config/roles.js";
import {
  listarController,
  obtenerController,
  crearController,
  editarController,
  desactivarController,
  reactivarController,
} from "./comunidad.controller.js";

const router = Router();

// Alimenta el filtro `comunidadId` de los reportes, por eso ALCALDE la lee.
router.get(
  "/",
  requireAuth,
  requireRole(LECTURA_CATALOGOS_REPORTE),
  listarController,
);
router.get(
  "/:id",
  requireAuth,
  requireRole(LECTURA_CATALOGOS_REPORTE),
  obtenerController,
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

export default router;
