import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { OPERACION } from "../../config/roles.js";
import { uploadMemoria } from "../../lib/storage/upload.middleware.js";
import {
  listarController,
  obtenerController,
  crearController,
  editarController,
  desactivarController,
  reactivarController,
  listarLotesController,
  crearLoteController,
  crearUnidadesController,
  listarDocumentosController,
  subirDocumentoController,
  eliminarDocumentoController,
} from "./recepcion.controller.js";

// Recibir donaciones es operación diaria, a diferencia de los catálogos:
// EMPLEADO_DMM entra aquí (matriz de roles, módulo INV).
const router = Router();

router.get("/", requireAuth, requireRole(OPERACION), listarController);
router.get("/:id", requireAuth, requireRole(OPERACION), obtenerController);
router.post("/", requireAuth, requireRole(OPERACION), crearController);
router.patch("/:id", requireAuth, requireRole(OPERACION), editarController);
router.patch(
  "/:id/desactivar",
  requireAuth,
  requireRole(OPERACION),
  desactivarController,
);
router.patch(
  "/:id/reactivar",
  requireAuth,
  requireRole(OPERACION),
  reactivarController,
);

router.get(
  "/:id/lotes",
  requireAuth,
  requireRole(OPERACION),
  listarLotesController,
);
router.post(
  "/:id/lotes",
  requireAuth,
  requireRole(OPERACION),
  crearLoteController,
);

// Ingreso de equipo con número de serie: una unidad por serie, en vez de un
// lote con cantidad. Recurso aparte porque lo que se pregunta es distinto —no
// cuánto llegó sino cuáles llegaron— y mezclarlos en el mismo endpoint
// obligaría a adivinar cuál de las dos formas quiso usar quien llama.
router.post(
  "/:id/unidades",
  requireAuth,
  requireRole(OPERACION),
  crearUnidadesController,
);

router.get(
  "/:id/documentos",
  requireAuth,
  requireRole(OPERACION),
  listarDocumentosController,
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

export default router;
