import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/role.middleware.js";
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

const ROLES_GESTION = ["EMPLEADO_DMM", "DIRECTORA", "ADMINISTRADOR"];
const ROLES_LECTURA = ["EMPLEADO_DMM", "DIRECTORA", "ADMINISTRADOR"];

const router = Router();

router.get("/", requireAuth, requireRole(...ROLES_LECTURA), listarController);
router.get(
  "/:id",
  requireAuth,
  requireRole(...ROLES_LECTURA),
  obtenerController,
);
router.post("/", requireAuth, requireRole(...ROLES_GESTION), crearController);
router.patch(
  "/:id",
  requireAuth,
  requireRole(...ROLES_GESTION),
  editarController,
);
router.patch(
  "/:id/desactivar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  desactivarController,
);
router.patch(
  "/:id/reactivar",
  requireAuth,
  requireRole(...ROLES_GESTION),
  reactivarController,
);

router.post(
  "/:id/discapacidades",
  requireAuth,
  requireRole(...ROLES_GESTION),
  agregarDiscapacidadController,
);
router.delete(
  "/:id/discapacidades/:discapacidadId",
  requireAuth,
  requireRole(...ROLES_GESTION),
  quitarDiscapacidadController,
);

router.post(
  "/:id/encargados",
  requireAuth,
  requireRole(...ROLES_GESTION),
  vincularEncargadoController,
);
router.delete(
  "/:id/encargados/:encargadoId",
  requireAuth,
  requireRole(...ROLES_GESTION),
  desvincularEncargadoController,
);

router.post(
  "/:id/contactos",
  requireAuth,
  requireRole(...ROLES_GESTION),
  agregarContactoController,
);
router.patch(
  "/:id/contactos/:contactoId",
  requireAuth,
  requireRole(...ROLES_GESTION),
  editarContactoController,
);
router.delete(
  "/:id/contactos/:contactoId",
  requireAuth,
  requireRole(...ROLES_GESTION),
  eliminarContactoController,
);

export default router;
