import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { DIRECCION, OPERACION } from "../../config/roles.js";
import { uploadMemoria } from "../../lib/storage/upload.middleware.js";
import {
  listarController,
  vencidosController,
  obtenerController,
  crearController,
  renovarController,
  editarController,
  devolucionController,
  marcarVencidosController,
  subirDocumentoController,
  listarMultasController,
  aplicarMultaController,
  editarMultaController,
  pagarMultaController,
  anularMultaController,
} from "./contrato.controller.js";

// Prestar y recibir equipo es operación diaria.
// Las multas son decisión económica: quedan con dirección.
const router = Router();

// Antes de "/:id" para que "vencidos" no se lea como un id.
router.get(
  "/vencidos",
  requireAuth,
  requireRole(OPERACION),
  vencidosController,
);
router.post(
  "/marcar-vencidos",
  requireAuth,
  requireRole(DIRECCION),
  marcarVencidosController,
);

router.get("/", requireAuth, requireRole(OPERACION), listarController);
router.get("/:id", requireAuth, requireRole(OPERACION), obtenerController);
router.post("/", requireAuth, requireRole(OPERACION), crearController);
router.patch("/:id", requireAuth, requireRole(OPERACION), editarController);
router.post(
  "/:id/renovar",
  requireAuth,
  requireRole(OPERACION),
  renovarController,
);
router.post(
  "/:id/devolucion",
  requireAuth,
  requireRole(OPERACION),
  devolucionController,
);
router.post(
  "/:id/documento",
  requireAuth,
  requireRole(OPERACION),
  uploadMemoria.single("archivo"),
  subirDocumentoController,
);

router.get(
  "/:id/multas",
  requireAuth,
  requireRole(OPERACION),
  listarMultasController,
);
router.post(
  "/:id/multas",
  requireAuth,
  requireRole(DIRECCION),
  aplicarMultaController,
);
router.patch(
  "/:id/multas/:multaId",
  requireAuth,
  requireRole(DIRECCION),
  editarMultaController,
);
router.post(
  "/:id/multas/:multaId/pagar",
  requireAuth,
  requireRole(DIRECCION),
  pagarMultaController,
);
router.post(
  "/:id/multas/:multaId/anular",
  requireAuth,
  requireRole(DIRECCION),
  anularMultaController,
);

export default router;
