import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { uploadMemoria } from "../../lib/storage/upload.middleware.js";
import {
  listarController,
  listaEsperaController,
  obtenerController,
  crearController,
  editarController,
  aprobarController,
  rechazarController,
  listarLineasController,
  agregarLineaController,
  editarLineaController,
  cancelarLineaController,
  cancelarSolicitudController,
  listarRecetasController,
  subirRecetaController,
  eliminarRecetaController,
} from "./solicitud.controller.js";

// Registrar y dar seguimiento a solicitudes es operación diaria.
const ROLES_GESTION = ["EMPLEADO_DMM", "DIRECTORA", "ADMINISTRADOR"];
// Aprobar o rechazar es decisión de dirección (RF-PRO).
const ROLES_APROBACION = ["DIRECTORA", "ADMINISTRADOR"];

const router = Router();

// Antes de "/:id" para que "lista-espera" no se interprete como un id.
router.get("/lista-espera", requireAuth, listaEsperaController);

router.get("/", requireAuth, listarController);
router.get("/:id", requireAuth, obtenerController);
router.post("/", requireAuth, requireRole(...ROLES_GESTION), crearController);
router.patch(
  "/:id",
  requireAuth,
  requireRole(...ROLES_GESTION),
  editarController,
);

router.post(
  "/:id/aprobar",
  requireAuth,
  requireRole(...ROLES_APROBACION),
  aprobarController,
);
router.post(
  "/:id/rechazar",
  requireAuth,
  requireRole(...ROLES_APROBACION),
  rechazarController,
);
router.post(
  "/:id/cancelar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  cancelarSolicitudController,
);

router.get("/:id/lineas", requireAuth, listarLineasController);
router.post(
  "/:id/lineas",
  requireAuth,
  requireRole(...ROLES_GESTION),
  agregarLineaController,
);
router.patch(
  "/:id/lineas/:lineaId",
  requireAuth,
  requireRole(...ROLES_GESTION),
  editarLineaController,
);
router.post(
  "/:id/lineas/:lineaId/cancelar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  cancelarLineaController,
);

router.get("/:id/recetas", requireAuth, listarRecetasController);
router.post(
  "/:id/recetas",
  requireAuth,
  requireRole(...ROLES_GESTION),
  uploadMemoria.single("archivo"),
  subirRecetaController,
);
router.delete(
  "/:id/recetas/:recetaId",
  requireAuth,
  requireRole(...ROLES_GESTION),
  eliminarRecetaController,
);

export default router;
