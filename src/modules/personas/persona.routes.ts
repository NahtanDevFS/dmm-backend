import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
import { OPERACION } from "../../config/roles.js";
import {
  listarController,
  obtenerController,
  crearController,
  editarController,
  desactivarController,
  reactivarController,
  agregarDiscapacidadController,
  quitarDiscapacidadController,
  vincularEncargadoController,
  desvincularEncargadoController,
  agregarContactoController,
  editarContactoController,
  eliminarContactoController,
} from "./persona.controller.js";
import documentoPersonaRoutes from "./documento-persona.routes.js";

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

router.post(
  "/:id/discapacidades",
  requireAuth,
  requireRole(OPERACION),
  agregarDiscapacidadController,
);
router.delete(
  "/:id/discapacidades/:discapacidadId",
  requireAuth,
  requireRole(OPERACION),
  quitarDiscapacidadController,
);

router.post(
  "/:id/encargados",
  requireAuth,
  requireRole(OPERACION),
  vincularEncargadoController,
);
router.delete(
  "/:id/encargados/:encargadoId",
  requireAuth,
  requireRole(OPERACION),
  desvincularEncargadoController,
);

router.post(
  "/:id/contactos",
  requireAuth,
  requireRole(OPERACION),
  agregarContactoController,
);
router.patch(
  "/:id/contactos/:contactoId",
  requireAuth,
  requireRole(OPERACION),
  editarContactoController,
);
router.delete(
  "/:id/contactos/:contactoId",
  requireAuth,
  requireRole(OPERACION),
  eliminarContactoController,
);

// Sub-router de documentos (con subida de archivo), ya trae su propio requireAuth/requireRole por endpoint
router.use("/", documentoPersonaRoutes);

export default router;
