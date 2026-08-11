import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { DIRECCION, OPERACION } from "../../config/roles.js";
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
// Aprobar o rechazar es decisión de dirección (RF-PRO).
const router = Router();

// Antes de "/:id" para que "lista-espera" no se interprete como un id.
router.get(
  "/lista-espera",
  requireAuth,
  requireRole(OPERACION),
  listaEsperaController,
);

router.get("/", requireAuth, requireRole(OPERACION), listarController);
router.get("/:id", requireAuth, requireRole(OPERACION), obtenerController);
router.post("/", requireAuth, requireRole(OPERACION), crearController);
router.patch("/:id", requireAuth, requireRole(OPERACION), editarController);

router.post(
  "/:id/aprobar",
  requireAuth,
  requireRole(DIRECCION),
  aprobarController,
);
router.post(
  "/:id/rechazar",
  requireAuth,
  requireRole(DIRECCION),
  rechazarController,
);
router.post(
  "/:id/cancelar",
  requireAuth,
  requireRole(OPERACION),
  cancelarSolicitudController,
);

router.get(
  "/:id/lineas",
  requireAuth,
  requireRole(OPERACION),
  listarLineasController,
);
router.post(
  "/:id/lineas",
  requireAuth,
  requireRole(OPERACION),
  agregarLineaController,
);
router.patch(
  "/:id/lineas/:lineaId",
  requireAuth,
  requireRole(OPERACION),
  editarLineaController,
);
router.post(
  "/:id/lineas/:lineaId/cancelar",
  requireAuth,
  requireRole(OPERACION),
  cancelarLineaController,
);

router.get(
  "/:id/recetas",
  requireAuth,
  requireRole(OPERACION),
  listarRecetasController,
);
router.post(
  "/:id/recetas",
  requireAuth,
  requireRole(OPERACION),
  uploadMemoria.single("archivo"),
  subirRecetaController,
);
router.delete(
  "/:id/recetas/:recetaId",
  requireAuth,
  requireRole(OPERACION),
  eliminarRecetaController,
);

export default router;
