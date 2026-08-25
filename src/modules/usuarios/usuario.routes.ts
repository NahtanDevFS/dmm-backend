import { Router } from "express";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import {
  requireRole,
  permitirSinRol,
} from "../../middlewares/role.middleware.js";
import { ADMINISTRACION } from "../../config/roles.js";
import {
  listarController,
  obtenerController,
  crearController,
  editarController,
  desactivarController,
  reactivarController,
  resetearPasswordController,
  cambiarPasswordPropiaController,
} from "./usuario.controller.js";

// Gestionar usuarios es exclusivo de ADMINISTRADOR (matriz de roles): incluye
// crear cuentas y cambiar el rol de otros, que es control de acceso puro.
const router = Router();

// Cambiar la propia contraseña no es administrar usuarios: lo hace cualquiera
// con sesión, y va antes de "/:id" para que "mi-password" no se lea como un id.
router.patch(
  "/mi-password",
  requireAuth,
  permitirSinRol(
    "Cambiar la propia contraseña no es administrar usuarios: exige la contraseña actual y solo afecta a quien la pide.",
  ),
  cambiarPasswordPropiaController,
);

router.get("/", requireAuth, requireRole(ADMINISTRACION), listarController);
router.get("/:id", requireAuth, requireRole(ADMINISTRACION), obtenerController);
router.post("/", requireAuth, requireRole(ADMINISTRACION), crearController);
router.patch("/:id", requireAuth, requireRole(ADMINISTRACION), editarController);
router.patch(
  "/:id/desactivar",
  requireAuth,
  requireRole(ADMINISTRACION),
  desactivarController,
);
router.patch(
  "/:id/reactivar",
  requireAuth,
  requireRole(ADMINISTRACION),
  reactivarController,
);
router.patch(
  "/:id/password",
  requireAuth,
  requireRole(ADMINISTRACION),
  resetearPasswordController,
);

export default router;
