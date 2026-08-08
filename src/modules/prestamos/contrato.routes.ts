import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
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
const ROLES_GESTION = ["EMPLEADO_DMM", "DIRECTORA", "ADMINISTRADOR"];
// Las multas son decisión económica: quedan con dirección.
const ROLES_MULTAS = ["DIRECTORA", "ADMINISTRADOR"];

const router = Router();

// Antes de "/:id" para que "vencidos" no se lea como un id.
router.get("/vencidos", requireAuth, vencidosController);
router.post(
  "/marcar-vencidos",
  requireAuth,
  requireRole(...ROLES_MULTAS),
  marcarVencidosController,
);

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
  "/:id/renovar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  renovarController,
);
router.post(
  "/:id/devolucion",
  requireAuth,
  requireRole(...ROLES_GESTION),
  devolucionController,
);
router.post(
  "/:id/documento",
  requireAuth,
  requireRole(...ROLES_GESTION),
  uploadMemoria.single("archivo"),
  subirDocumentoController,
);

router.get("/:id/multas", requireAuth, listarMultasController);
router.post(
  "/:id/multas",
  requireAuth,
  requireRole(...ROLES_MULTAS),
  aplicarMultaController,
);
router.patch(
  "/:id/multas/:multaId",
  requireAuth,
  requireRole(...ROLES_MULTAS),
  editarMultaController,
);
router.post(
  "/:id/multas/:multaId/pagar",
  requireAuth,
  requireRole(...ROLES_MULTAS),
  pagarMultaController,
);
router.post(
  "/:id/multas/:multaId/anular",
  requireAuth,
  requireRole(...ROLES_MULTAS),
  anularMultaController,
);

export default router;
