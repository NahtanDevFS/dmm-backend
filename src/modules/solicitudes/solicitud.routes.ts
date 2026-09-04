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
  listarDocumentosController,
  expedientePdfController,
  subirDocumentoController,
  eliminarDocumentoController,
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

// Legajo escaneado de la solicitud: formularios firmados, recetas,
// constancias. Reemplaza en la práctica a /recetas, que nació cuando la
// medicina pasaba por solicitud.
// El expediente completo en PDF. GET y no POST: no cambia nada, solo arma un
// documento con lo que ya está registrado.
router.get(
  "/:id/expediente.pdf",
  requireAuth,
  requireRole(OPERACION),
  expedientePdfController,
);

router.get(
  "/:id/documentos",
  requireAuth,
  requireRole(OPERACION),
  listarDocumentosController,
  expedientePdfController,
);
router.post(
  "/:id/documentos",
  requireAuth,
  requireRole(OPERACION),
  uploadMemoria.single("archivo"),
  subirDocumentoController,
);
router.delete(
  "/:id/documentos/:documentoId",
  requireAuth,
  requireRole(OPERACION),
  eliminarDocumentoController,
);

router.get(
  "/:id/recetas",
  requireAuth,
  requireRole(OPERACION),
  listarRecetasController,
  listarDocumentosController,
  expedientePdfController,
  subirDocumentoController,
  eliminarDocumentoController,
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
