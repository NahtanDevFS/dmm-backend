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
  crearPrestamoDirectoController,
  anularContratoController,
  noDevueltoController,
  listarMultasController,
  aplicarMultaController,
  editarMultaController,
  pagarMultaController,
  anularMultaController,
  listarEvidenciasContratoController,
  subirEvidenciaContratoController,
  eliminarEvidenciaContratoController,
} from "./contrato.controller.js";

// Prestar y recibir equipo es operación diaria.
// Las multas son decisión económica: quedan con dirección.
const router = Router();

// La puerta principal del módulo: registra la entrega del equipo y su
// contrato de una vez. Antes de "/:id" no hace falta —"/" no colisiona— pero
// se deja arriba por ser la acción principal.
router.post(
  "/directo",
  requireAuth,
  requireRole(OPERACION),
  crearPrestamoDirectoController,
  anularContratoController,
  noDevueltoController,
);

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
  crearPrestamoDirectoController,
  anularContratoController,
  noDevueltoController,
);

router.get("/", requireAuth, requireRole(OPERACION), listarController);
router.get("/:id", requireAuth, requireRole(OPERACION), obtenerController);
router.post("/", requireAuth, requireRole(OPERACION), crearController);
router.patch("/:id", requireAuth, requireRole(OPERACION), editarController);
// Dos finales distintos que no hay que confundir: anular deshace el registro
// y devuelve el stock; no-devuelto cierra el contrato SIN restituirlo, porque
// el equipo no está. Ambos son de DIRECCION: uno revierte inventario y el
// otro asume una pérdida.
router.post(
  "/:id/anular",
  requireAuth,
  requireRole(DIRECCION),
  anularContratoController,
);
router.post(
  "/:id/no-devuelto",
  requireAuth,
  requireRole(DIRECCION),
  noDevueltoController,
);

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

router.get(
  "/:id/evidencias",
  requireAuth,
  requireRole(OPERACION),
  listarEvidenciasContratoController,
);
router.post(
  "/:id/evidencias",
  requireAuth,
  requireRole(OPERACION),
  uploadMemoria.single("archivo"),
  subirEvidenciaContratoController,
);
router.delete(
  "/:id/evidencias/:evidenciaId",
  requireAuth,
  requireRole(OPERACION),
  eliminarEvidenciaContratoController,
);

export default router;
